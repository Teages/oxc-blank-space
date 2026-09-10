# petrea

[![pkg.pr.new](https://pkg.pr.new/badge/Teages/petrea)](https://pkg.pr.new/~/Teages/petrea)

A small, fast type-stripper that blanks TypeScript-only syntax using the [oxc parser](https://oxc.rs), leaving valid JavaScript with identical line and column positions. A drop-in reimplementation of [ts-blank-space](https://github.com/bloomberg/ts-blank-space) on the oxc parser instead of the TypeScript compiler.

## Install

```bash
npm install petrea
```

## Getting Started

```ts
import { transpile } from 'petrea'

console.log(await transpile(`const a: number = 1`))
// result: `const a         = 1`
```

`transpileSync` offers the same behavior synchronously. `transpile` works in
Node and in browsers. In Node it runs on a native binding for the current
platform; when bundled for the browser, bundlers resolve the same import to
a WebAssembly build through the standard `browser` condition — no
configuration needed. To force the WebAssembly build explicitly (e.g. in
tooling without a `browser` condition), use the `petrea/wasm` entry:

```ts
import { transpile } from 'petrea/wasm'

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
