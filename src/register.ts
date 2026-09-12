import type { LoadFnOutput, ResolveFnOutput } from 'node:module'
import * as nodeModule from 'node:module'
import { loadTypeScript, resolveTypeScript } from './register-core'

/**
 * `petrea/register` — run TypeScript directly in Node:
 *
 * ```
 * node --import petrea/register ./app.ts
 * ```
 *
 * On Node ≥ 22.15 the hooks register in-thread and intercept both `import`
 * and `require()` of `.ts`/`.tsx`/`.mts`/`.cts` files (explicit extensions
 * required, like Node's own type stripping). Older Node (≥ 20.6) falls back
 * to threaded customization hooks, which cover ESM imports only. The hooks
 * strip types with petrea itself, so constructs Node's built-in stripping
 * rejects — enums, kept-verbatim namespaces — keep working everywhere.
 */
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({
    // the cores only return a promise when they delegate to a promise-returning
    // next hook; on this synchronous path they never do
    load: (url, context, nextLoad) =>
      loadTypeScript(url, context, nextLoad) as LoadFnOutput,
    resolve: (specifier, context, nextResolve) =>
      resolveTypeScript(specifier, context, nextResolve) as ResolveFnOutput,
  })
}
else {
  // the threaded hooks module ships compiled next to this file; the
  // source-tree copy only ever runs on Node versions that took the
  // registerHooks branch above
  nodeModule.register('./register-hooks.mjs', import.meta.url)
}
