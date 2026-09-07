import type { NativeBinding } from './api'
import type { TranspileOptions } from './types'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createApi } from './api'

export type { OnError, TranspileOptions, UnsupportedSyntax } from './types'

// '../dist' resolves correctly both from the bundled `dist/index.mjs`
// (dist/../dist) and from `src/index.ts` when vitest runs the sources
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')

/**
 * The napi artifact for the running platform, e.g.
 * `oxc-blank-space-native.darwin-arm64.node`, `...-linux-x64-gnu.node` (the
 * libc variant matched against the runtime) or `...-win32-x64-msvc.node`.
 * Returns undefined when no matching binary exists — loading a binary built
 * for another platform or libc would fail anyway, just with a confusing
 * dynamic-linking error.
 */
function platformBinary(): string | undefined {
  const base = `oxc-blank-space-native.${process.platform}-${process.arch}`
  const binaries = readdirSync(distDir).filter(file => file.endsWith('.node')).sort()
  const candidates = (() => {
    switch (process.platform) {
      case 'linux': {
        // process.report carries the glibc version only when linked against
        // glibc; the other libc variant is not a fallback — it cannot load.
        const report = process.report as
          | { getReport?: () => { header?: { glibcVersionRuntime?: string } } }
          | undefined
        const musl = report?.getReport?.().header?.glibcVersionRuntime === undefined
        return musl ? [`${base}-musl.node`] : [`${base}-gnu.node`]
      }
      case 'win32':
        return [`${base}-msvc.node`]
      default:
        return [`${base}.node`]
    }
  })()
  return candidates.find(name => binaries.includes(name))
}

function loadNodeBinding(): NativeBinding | undefined {
  const binary = platformBinary()
  if (!binary) {
    return undefined
  }
  return createRequire(import.meta.url)(join(distDir, binary))
}

const api = createApi(loadNodeBinding)

/**
 * Whether a native binary matching this platform was shipped with the
 * package. When false, {@link transpile} and {@link transpileSync} throw on
 * use and the browser entry (`@teages/oxc-blank-space/browser`) is the
 * alternative.
 */
export const nativeBindingAvailable = api.isAvailable

export const transpile: (input: string, options?: TranspileOptions) => Promise<string>
  = api.transpile

export const transpileSync: (input: string, options?: TranspileOptions) => string
  = api.transpileSync
