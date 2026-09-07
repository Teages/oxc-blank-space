# @teages/oxc-blank-space

[![pkg.pr.new](https://pkg.pr.new/badge/Teages/oxc-blank-space)](https://pkg.pr.new/~/Teages/oxc-blank-space)

A small, fast type-stripper that blanks TypeScript-only syntax using the [oxc parser](https://oxc.rs), leaving valid JavaScript with identical line and column positions. A drop-in reimplementation of [ts-blank-space](https://github.com/bloomberg/ts-blank-space) on the oxc parser instead of the TypeScript compiler.

## Install

```bash
npm install @teages/oxc-blank-space
```

## Getting Started

```ts
import { transpile } from '@teages/oxc-blank-space'

console.log(await transpile(`const a: number = 1`))
// result: `const a         = 1`
```

`transpileSync` offers the same behavior synchronously, and
`@teages/oxc-blank-space/browser` exposes the identical API for browsers via a
WebAssembly build:

```ts
import { transpile } from '@teages/oxc-blank-space/browser'

await transpile(`const a: number = 1`)
// 'const a         = 1'
```

## License

[MIT](./LICENSE) — © 2025-present Teages.

Published binaries embed [oxc](https://github.com/oxc-project/oxc) and
[napi-rs](https://napi.rs) (both MIT); bundled JavaScript dependencies are
listed in `dist/THIRD-PARTY-LICENSES.md` at build time.

The test suite's fixture corpus in `test/fixture` is derived from
[ts-blank-space](https://github.com/bloomberg/ts-blank-space)
(© 2024 Bloomberg Finance L.P.) and remains under the
[Apache License 2.0](./test/fixture/LICENSE).
