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

## Unsupported (runtime) TypeScript

Constructs with runtime behavior cannot be blanked. They are kept verbatim and reported through `onError`, mirroring ts-blank-space:

- `enum` / `const enum` (unless `declare`)
- namespaces containing runtime code; legacy `module X {}` declarations
- constructor parameter properties (`constructor(private a: string)`)
- `export = ...` and `import x = require(...)`
- legacy prefix type assertions (`<T>expr`)
- `as`/`satisfies` erasures that would change operator grouping (e.g. `1 + 1 as T / 2`)

```ts
transpile(`enum Color { Red }`, {
    onError: (node) => {
        // node.type === 'TSEnumDeclaration', node.start / node.end offsets
    },
})
```

Inputs oxc cannot parse at all (e.g. some operator-grouping edge cases) are returned unchanged.

## API

```ts
function transpile(input: string, options?: TranspileOptions): string;

interface TranspileOptions {
    /** Called once per unsupported construct. */
    onError?: (node: { type: string; start: number; end: number }) => void;
    /** Parse as plain `ts` (default) or `tsx`. */
    lang?: 'ts' | 'tsx';
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
pnpm test        # bun test — unit tests + ts-blank-space fixture corpus
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome
pnpm build       # tsup → dist (ESM + CJS + types)
```

The test suite includes the upstream fixture corpus (`test/fixture`) and asserts that every output matches `ts-blank-space` byte for byte.

## License

Apache-2.0. Derived from [ts-blank-space](https://github.com/bloomberg/ts-blank-space) (© Bloomberg Finance L.P., Apache-2.0).
