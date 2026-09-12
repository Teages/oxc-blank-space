import type { LoadHook, ResolveHook } from 'node:module'
import { loadTypeScript, resolveTypeScript } from './register-core'

/**
 * Threaded customization hooks for Node versions without
 * `module.registerHooks` (20.6–22.14). Loaded in a dedicated thread by
 * `petrea/register`; never imported directly. The async signatures flatten
 * whatever the shared synchronous core delegates to.
 */
export const resolve: ResolveHook = (specifier, context, nextResolve) =>
  resolveTypeScript(specifier, context, nextResolve)

export const load: LoadHook = (url, context, nextLoad) =>
  loadTypeScript(url, context, nextLoad)
