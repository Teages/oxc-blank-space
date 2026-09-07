# @teages/oxc-blank-space

A small, fast type-stripper that blanks TypeScript-only syntax using the [oxc parser](https://oxc.rs), leaving valid JavaScript with identical line and column positions. A drop-in reimplementation of [ts-blank-space](https://github.com/bloomberg/ts-blank-space) on the oxc parser instead of the TypeScript compiler.

```ts
import { transpile } from '@teages/oxc-blank-space'

console.log(await transpile(`const a: number = 1`))
// result: `const a         = 1`
```

The library is a Rust implementation delivered as a native Node addon
(`napi-rs`), with a WebAssembly build for browsers — there is no JavaScript
fallback.

## What it does

- Type annotations, `interface`s, type aliases, generics, `as`/`satisfies`, `!` and `?` markers, type-only imports/exports, `declare` statements, index signatures, overload signatures, type-only namespaces and more are replaced with whitespace.
- Newlines inside erased ranges are preserved, so **line and column numbers of the remaining code never change** — stack traces and source maps keep pointing at the original positions.
- The output is always equal in length to the input.

## Runtime TypeScript

### Enums are expanded

Enums are expanded in place into the same IIFE shape the TypeScript compiler emits, so runtime behavior (including reverse numeric mappings and member references) is preserved exactly:

```ts
await transpile(`enum Color { Red, Green = 5 }`)
// 'var  Color; (function (Color) { Color[Color["Red"] = 0] = "Red";
//   Color[Color["Green"] = 5] = "Green" })(Color || (Color = {}));'
```

`const enum` is expanded the same way: the tool never rewrites use sites, so the enum object must exist at runtime for `CE.A` to keep resolving. Note that enum expansion is the one transformation that may change the output length (and therefore the positions of code after the enum).

### Unerasable assertions

TypeScript now rejects `as`/`satisfies` assertions whose erasure would change operator grouping — `1 + 1 as T / 2` parses as `(1 + 1 as T) / 2`, but erasing the assertion yields `1 + 1 / 2` (see [TypeScript#63527](https://github.com/microsoft/TypeScript/issues/63527), enforced by oxc 0.135+). Inputs containing such assertions cannot be parsed: `transpile` rejects and `transpileSync` throws a `SyntaxError` carrying the parser's diagnostics.

Assertions inside unparenthesized `??`/`&&`/`||` mixes (`a && b as T ?? c`) are kept verbatim and reported through `onError`, mirroring ts-blank-space.

### Unsupported constructs

Truly unsupported constructs are kept verbatim and reported through `onError`:

- constructor parameter properties (`constructor(private a: string)`)
- namespaces containing runtime code; legacy `module X {}` declarations
- `export = ...` and `import x = require(...)`
- legacy prefix type assertions (`<T>expr`)

```ts
await transpile(`class C { constructor(private a: string) {} }`, {
  onError: (node) => {
    // node.type === 'TSParameterProperty', node.start / node.end offsets
  },
})
```

Inputs oxc cannot parse at all are rejected: a `SyntaxError` carrying the parser's diagnostics — invalid TypeScript is never silently passed through as if it were JavaScript.

## API

```ts
function transpile(input: string, options?: TranspileOptions): Promise<string>
function transpileSync(input: string, options?: TranspileOptions): string

interface TranspileOptions {
  /** Called once per unsupported construct. */
  onError?: (node: { type: string, start: number, end: number }) => void
  /** Parse as plain `ts` (default) or `tsx`. */
  lang?: 'ts' | 'tsx'
  /** Source path quoted in parse diagnostics; a `.tsx` extension enables JSX. */
  filename?: string
}
```

`transpile` runs the pipeline off the calling thread; `transpileSync` runs it
inline. Both produce byte-for-byte identical output. `onError` is invoked
after transpilation with the kept-verbatim constructs; parse failures
surface as `SyntaxError`s whose message carries the parser's codeframe.

## Implementation & platforms

The transpiler is written in Rust (`native/`), driven through napi. The
published package bundles a prebuilt binary for every platform the loader
matches — darwin-x64/arm64, linux-x64/arm64 in glibc and musl variants, and
win32-x64/arm64 (~1.3 MB each; the loader picks strictly by
`process.platform`, `process.arch` and libc, so a mismatched binary is never
loaded). The `native build` workflow builds all of them — six by
cross-compilation — and smoke-loads each on matching hardware.

### Browser entry

`@teages/oxc-blank-space/browser` exposes the identical `transpile`/
`transpileSync` pair from the same Rust code compiled to `wasm32-wasip1`:

```ts
import { transpile } from '@teages/oxc-blank-space/browser'

await transpile(`const a: number = 1`)
// 'const a         = 1'
```

The wasm runtime (`@napi-rs/wasm-runtime`, emnapi) is bundled into the entry,
so the package carries zero runtime dependencies; only the `.wasm` module is
loaded as an asset. It needs `fetch` and WebAssembly (no SharedArrayBuffer,
no cross-origin isolation). The wasm module is fetched and instantiated when
the entry is imported — if that fails, the import itself rejects. The async
entry runs on emnapi's async workers; on the main thread of a browser page
it behaves like the sync call between microtasks.

### Behavior parity

Raw lone surrogates cannot survive the UTF-8 boundary into Rust, so inputs
containing one are routed to dedicated UTF-16 entry points internally: the
parser sees a lossy copy while the output is assembled from the original code
units, preserving raw lone surrogates losslessly. Enum member keys decoded
from such escapes re-escape as `\udXXX` rather than collapsing to U+FFFD, so
runtime property access on the transpiled output keeps resolving.

The behavior suites (`test/*.test.ts`) run every test against the synchronous
API and cross-check each call against the async API — output, `onError`
reports and rejection messages byte for byte — against the `ts-blank-space`
reference fixtures. Separate suites exercise the wasm binding and load the
published browser entry (`dist/browser.mjs`) through a `fetch` shim; the
`native build` workflow smoke-loads every shipped binary on matching
hardware — including Windows ARM64 and wasm — and a 3,000-value seeded
double sweep (plus structured edge cases) pins the enum-expansion number
formatting to `Number.prototype.toString` (round-half-to-even ties
included).

## Benchmark

`pnpm bench` runs `bench/transpile.bench.ts` (vitest bench) over the two
entry points plus the reference and the fastest known Rust competitor,
[oxidase](https://github.com/branchseer/oxidase). Measured on an Apple
M-series laptop, Node 24, normalized to oxidase's time:

| input | oxidase | ts-blank-space | transpileSync | transpile (async) |
| --- | --- | --- | --- | --- |
| inline snippet | **1.00x** (543k ops/s) | 2.4x | 1.04x | 3.9x |
| fixture corpus (~15KB) | **1.00x** (7.2k ops/s) | 2.9x | **0.96x** | 1.06x |
| large (~100KB) | **1.00x** (780 ops/s) | 2.7x | **0.89x** | 0.91x |
| enum heavy | **1.00x** (7.4k ops/s) | 0.74x\* | 1.53x | 1.61x |

\* on the enum sample ts-blank-space cannot transform enums and, with a
no-op `onError`, keeps them verbatim — it does strictly less work there.

In words: on multi-KB real-world inputs this library matches or slightly
beats oxidase (whose pipeline runs at the speed of a bare oxc parse), and
both are ~2.7–2.9x ahead of ts-blank-space there. On tiny inputs the two
Rust pipelines tie at the napi call overhead (~2µs), 2.4x ahead of
ts-blank-space. Enum expansion is the one scenario oxidase wins clearly: its
rewrite keeps member source positions but emits a cheaper `this`-based
initialization, while this library implements the exact TypeScript emitter
shape with ECMAScript number formatting — pick it if that scenario dominates.

Sync vs async carries its own constant gap (the napi thread-pool hop, ~5µs
per call): on the tiny inline input `transpileSync` is ~3.8x faster than
`transpile`; from the ~15KB corpus upward the two converge to within ~10%.
Rule of thumb: use `transpileSync` for small, frequent inputs; `transpile`
once inputs are non-trivial or concurrency matters.

`native/src/lib.rs` contains an `#[ignore]`d measurement harness for the
Rust-side numbers — run it with
`cargo test --release perf_bench -- --ignored --nocapture` from `native/`.

## Comparison with ts-blank-space

| | ts-blank-space | @teages/oxc-blank-space |
| --- | --- | --- |
| Parser | TypeScript compiler | oxc (Rust, native addon + wasm) |
| Output contract | whitespace, positions preserved | identical |
| Semantics | — | differential-tested byte-for-byte against ts-blank-space fixtures |

## Development

```bash
pnpm install
pnpm test        # eslint + tsc --noEmit + vitest run --coverage
pnpm lint        # eslint (antfu config), lint:fix to auto-fix
pnpm build       # native binary + wasm module + obundle → dist
pnpm build:native  # only the local platform binary
pnpm build:wasm    # only the wasm32-wasip1 module
pnpm bench       # vitest bench: sync vs async entries
pnpm play        # run the playground against a stub build
pnpm release     # changelogen release + publish
```

The test suite includes the upstream fixture corpus (`test/fixture`) and asserts that every output matches `ts-blank-space` byte for byte. CI (`.github/workflows`) runs lint, typecheck, build and coverage on every PR, and the `native build` workflow builds and smoke-tests all nine artifacts (eight platform binaries plus wasm) on every `native/**` change.

## License

Apache-2.0. Derived from [ts-blank-space](https://github.com/bloomberg/ts-blank-space) (© Bloomberg Finance L.P., Apache-2.0).
