# @teages/oxc-blank-space

A small, fast type-stripper that blanks TypeScript-only syntax using the [oxc parser](https://oxc.rs), leaving valid JavaScript with identical line and column positions. A drop-in reimplementation of [ts-blank-space](https://github.com/bloomberg/ts-blank-space) on the oxc parser instead of the TypeScript compiler.

```ts
import { transpile } from '@teages/oxc-blank-space'

console.log(transpile(`const a: number = 1`))
// result: `const a         = 1`
```

## What it does

- Type annotations, `interface`s, type aliases, generics, `as`/`satisfies`, `!` and `?` markers, type-only imports/exports, `declare` statements, index signatures, overload signatures, type-only namespaces and more are replaced with whitespace.
- Newlines inside erased ranges are preserved, so **line and column numbers of the remaining code never change** — stack traces and source maps keep pointing at the original positions.
- The output is always equal in length to the input.

## Runtime TypeScript

### Enums are expanded

Enums are expanded in place into the same IIFE shape the TypeScript compiler emits, so runtime behavior (including reverse numeric mappings and member references) is preserved exactly:

```ts
transpile(`enum Color { Red, Green = 5 }`)
// 'var  Color; (function (Color) { Color[Color["Red"] = 0] = "Red";
//   Color[Color["Green"] = 5] = "Green" })(Color || (Color = {}));'
```

`const enum` is expanded the same way: the tool never rewrites use sites, so the enum object must exist at runtime for `CE.A` to keep resolving. Note that enum expansion is the one transformation that may change the output length (and therefore the positions of code after the enum).

### Unerasable assertions

TypeScript now rejects `as`/`satisfies` assertions whose erasure would change operator grouping — `1 + 1 as T / 2` parses as `(1 + 1 as T) / 2`, but erasing the assertion yields `1 + 1 / 2` (see [TypeScript#63527](https://github.com/microsoft/TypeScript/issues/63527), enforced by oxc 0.135+). Inputs containing such assertions cannot be parsed: `transpile()` throws a `SyntaxError` carrying the parser's diagnostics.

Assertions inside unparenthesized `??`/`&&`/`||` mixes (`a && b as T ?? c`) are kept verbatim and reported through `onError`, mirroring ts-blank-space.

### Unsupported constructs

Truly unsupported constructs are kept verbatim and reported through `onError`:

- constructor parameter properties (`constructor(private a: string)`)
- namespaces containing runtime code; legacy `module X {}` declarations
- `export = ...` and `import x = require(...)`
- legacy prefix type assertions (`<T>expr`)

```ts
transpile(`class C { constructor(private a: string) {} }`, {
  onError: (node) => {
    // node.type === 'TSParameterProperty', node.start / node.end offsets
  },
})
```

Inputs oxc cannot parse at all throw a `SyntaxError` carrying the parser's diagnostics — invalid TypeScript is never silently passed through as if it were JavaScript.

## API

```ts
function transpile(input: string, options?: TranspileOptions): string

interface TranspileOptions {
  /** Called once per unsupported construct. */
  onError?: (node: { type: string, start: number, end: number }) => void
  /** Parse as plain `ts` (default) or `tsx`. */
  lang?: 'ts' | 'tsx'
  /** Source path quoted in parse diagnostics; a `.tsx` extension enables JSX. */
  filename?: string
}
```

## Experimental native entry point

`@teages/oxc-blank-space/experimental-native` exposes the same transpilation as
a Rust implementation (this repo rewritten in Rust, living under `native/`),
as a synchronous/async pair — `transpileSync` runs the pipeline on the calling
thread, `transpileAsync` runs it on a background thread. Either way the oxc AST
never crosses into JavaScript:

```ts
import { transpileAsync, transpileSync } from '@teages/oxc-blank-space/experimental-native'

transpileSync(`const a: number = 1`)
// 'const a         = 1'
await transpileAsync(`const a: number = 1`)
// 'const a         = 1'
```

Both accept the same `TranspileOptions` as `transpile` (including `onError`,
which is invoked with the kept-verbatim unsupported constructs after
transpilation) and throw a `SyntaxError` when the input cannot be parsed — the
async entry rejects. `nativeBindingAvailable` reports whether the binary has
been built; the entry throws on use otherwise. The output is byte-for-byte
identical to the JS implementation; `test/native.test.ts` asserts this against
the fixture corpus and inline cases.

> [!NOTE]
> Experimental: both entries report `onError` after transpilation rather than
> during it, and the binary must be built per-platform (`pnpm build:native`).

## Benchmark

`pnpm bench` runs `bench/transpile.bench.ts` (vitest bench) comparing the JS
implementation against both native entries. Measured on an Apple M-series
laptop, Node 24:

| input | js | native transpileSync | native transpileAsync |
| --- | --- | --- | --- |
| inline snippet | 84.3k ops/s | 483.2k ops/s (5.7x) | 129.1k ops/s (1.5x) |
| fixture corpus (~15KB) | 1.1k ops/s | 7.3k ops/s (6.6x) | 6.8k ops/s (6.2x) |
| large (~100KB) | 115 ops/s | 805 ops/s (7.0x) | 817 ops/s (7.1x) |
| enum heavy | 2.6k ops/s | 8.4k ops/s (3.2x) | 7.6k ops/s (2.9x) |

The gap against the JS implementation comes from keeping the whole
parse-and-blank pipeline in Rust: the JS implementation pays for transferring
the oxc AST into JavaScript objects and walking it dynamically, while the
native entries walk the typed AST in place.

Sync vs async has its own gap, driven by the per-call fixed cost of the napi
thread-pool hop (dispatch + promise plumbing, roughly 5µs here): on the tiny
inline input `transpileSync` is ~3.6x faster than `transpileAsync`; from the
~15KB fixture corpus upward the two converge to within a few percent
(1.0–1.1x), and at ~100KB the async entry is fully on par while keeping the
main thread free. Rule of thumb: use `transpileSync` for small, frequent
inputs; `transpileAsync` once inputs are non-trivial or concurrency matters.

## Comparison with ts-blank-space

| | ts-blank-space | @teages/oxc-blank-space |
| --- | --- | --- |
| Parser | TypeScript compiler | oxc (Rust, via napi) |
| Output contract | whitespace, positions preserved | identical |
| Semantics | — | differential-tested byte-for-byte against ts-blank-space fixtures |

## Development

```bash
pnpm install
pnpm test        # eslint + tsc --noEmit + vitest run --coverage
pnpm lint        # eslint (antfu config), lint:fix to auto-fix
pnpm build       # obuild → dist (ESM + types) + napi release build
pnpm build:native  # napi build --release → dist/*.node (required for tests/bench)
pnpm bench       # vitest bench: js vs native implementations
pnpm play        # run the playground against a stub build
pnpm release     # changelogen release + publish
```

The test suite includes the upstream fixture corpus (`test/fixture`) and asserts that every output matches `ts-blank-space` byte for byte. CI (`.github/workflows`) runs lint, typecheck, build and coverage on every PR.

## License

Apache-2.0. Derived from [ts-blank-space](https://github.com/bloomberg/ts-blank-space) (© Bloomberg Finance L.P., Apache-2.0).
