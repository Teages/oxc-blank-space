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

TypeScript now rejects `as`/`satisfies` assertions whose erasure would change operator grouping — `1 + 1 as T / 2` parses as `(1 + 1 as T) / 2`, but erasing the assertion yields `1 + 1 / 2` (see [TypeScript#63527](https://github.com/microsoft/TypeScript/issues/63527), enforced by oxc 0.135+). Inputs containing such assertions cannot be parsed and are returned unchanged.

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

Inputs oxc cannot parse at all are returned unchanged.

## API

```ts
function transpile(input: string, options?: TranspileOptions): string

interface TranspileOptions {
  /** Called once per unsupported construct. */
  onError?: (node: { type: string, start: number, end: number }) => void
  /** Parse as plain `ts` (default) or `tsx`. */
  lang?: 'ts' | 'tsx'
}
```

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
pnpm build       # obuild → dist (ESM + types)
pnpm play        # run the playground against a stub build
pnpm release     # changelogen release + publish
```

The test suite includes the upstream fixture corpus (`test/fixture`) and asserts that every output matches `ts-blank-space` byte for byte. CI (`.github/workflows`) runs lint, typecheck, build and coverage on every PR.

## License

Apache-2.0. Derived from [ts-blank-space](https://github.com/bloomberg/ts-blank-space) (© Bloomberg Finance L.P., Apache-2.0).
