import type { TranspileOptions } from './types'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export type { OnError, TranspileOptions, UnsupportedSyntax } from './types'

interface NativeOptions {
  lang?: string
  filename?: string
}

interface NativeUnsupported {
  nodeType: string
  start: number
  end: number
}

interface NativeResult {
  code: string
  unsupported: NativeUnsupported[]
}

interface NativeUnitsResult {
  code: Uint16Array
  unsupported: NativeUnsupported[]
}

interface NativeBinding {
  transpileAsync: (input: string, options?: NativeOptions) => Promise<NativeResult>
  transpileNativeSync: (input: string, options?: NativeOptions) => NativeResult
  transpileUtf16Async: (units: Uint16Array, options?: NativeOptions) => Promise<NativeUnitsResult>
  transpileUtf16Sync: (units: Uint16Array, options?: NativeOptions) => NativeUnitsResult
}
const nativeDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')

/**
 * Raw lone surrogates cannot survive the UTF-8 boundary into Rust, so inputs
 * containing one are routed to the UTF-16 entry points, which round-trip the
 * original code units losslessly. Paired surrogates (astral characters) are
 * unaffected.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** UTF-16 code units of a JS string (lossless, unlike `String` → UTF-8). */
export function toUtf16Units(input: string): Uint16Array {
  const units = new Uint16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    units[i] = input.charCodeAt(i)
  }
  return units
}

/** JS string from UTF-16 code units (lossless, unlike UTF-8 decoding). */
export function fromUtf16Units(units: Uint16Array): string {
  let out = ''
  for (let i = 0; i < units.length; i += 0x8000) {
    out += String.fromCharCode(...units.subarray(i, i + 0x8000))
  }
  return out
}

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
  const binaries = readdirSync(nativeDir).filter(file => file.endsWith('.node')).sort()
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

/**
 * Whether the native binary has been built (`pnpm build:native`). The
 * experimental-native entry point throws on use when it is not.
 */
export const nativeBindingAvailable: boolean = (() => {
  try {
    const binary = platformBinary()
    if (!binary) {
      return false
    }
    return createRequire(import.meta.url)(join(nativeDir, binary)) != null
  }
  catch {
    return false
  }
})()

const binding: NativeBinding | undefined = nativeBindingAvailable
  ? (() => {
      const binary = platformBinary()!
      return createRequire(import.meta.url)(join(nativeDir, binary))
    })()
  : undefined

/** Direct access to the loaded binding (used by tests). */
export function nativeRequire(): NativeBinding {
  return requireBinding()
}

function requireBinding(): NativeBinding {
  if (!binding) {
    throw new Error(
      '@teages/oxc-blank-space/experimental-native: native module is not built. Run `pnpm build:native` first.',
    )
  }
  return binding
}

function toNativeOptions(options: TranspileOptions): NativeOptions {
  return {
    lang: options.lang,
    filename: options.filename,
  }
}

function dispatchReports(
  reports: NativeUnsupported[],
  options: TranspileOptions,
): void {
  for (const report of reports) {
    options.onError?.({
      type: report.nodeType,
      start: report.start,
      end: report.end,
    })
  }
}

/**
 * Experimental native entry point: transpile with the Rust implementation,
 * parsing and blanking on a background thread. Resolves with the blanked
 * JavaScript; `options.onError` is invoked with the kept-verbatim unsupported
 * constructs before the promise settles. Rejects with a `SyntaxError` when the
 * input cannot be parsed.
 *
 * ```
 * import { transpileAsync } from '@teages/oxc-blank-space/experimental-native'
 *
 * await transpileAsync(`const a: number = 1`)
 * // 'const a         = 1'
 * ```
 */
export async function transpileAsync(
  input: string,
  options: TranspileOptions = {},
): Promise<string> {
  if (LONE_SURROGATE.test(input)) {
    const result = await requireBinding()
      .transpileUtf16Async(toUtf16Units(input), toNativeOptions(options))
      .catch((error: unknown) => {
        throw new SyntaxError(error instanceof Error ? error.message : String(error))
      })
    dispatchReports(result.unsupported, options)
    return fromUtf16Units(result.code)
  }
  const result = await requireBinding()
    .transpileAsync(input, toNativeOptions(options))
    .catch((error: unknown) => {
      throw new SyntaxError(error instanceof Error ? error.message : String(error))
    })
  dispatchReports(result.unsupported, options)
  return result.code
}

/**
 * Direct UTF-16 access to the native pipeline: `input` is converted to code
 * units, handed to the binding, and the result is converted back — no option
 * handling and no fallback logic in between. Exported for tests and callers
 * that need to verify the native path itself.
 */
export function transpileUtf16Direct(input: string): string {
  const result = requireBinding().transpileUtf16Sync(toUtf16Units(input))
  return fromUtf16Units(result.code)
}

/**
 * Synchronous counterpart of {@link transpileAsync}: the same Rust pipeline,
 * running entirely on the calling thread. Produces byte-for-byte identical
 * output; prefer it when no other work needs to run concurrently, and use
 * {@link transpileAsync} to keep the main thread free.
 */
export function transpileSync(
  input: string,
  options: TranspileOptions = {},
): string {
  if (LONE_SURROGATE.test(input)) {
    // Only the binding call is wrapped into a SyntaxError (parse failures);
    // onError exceptions propagate unchanged, matching transpileAsync.
    let unitsResult: { code: Uint16Array, unsupported: NativeUnsupported[] }
    try {
      unitsResult = requireBinding().transpileUtf16Sync(toUtf16Units(input), toNativeOptions(options))
    }
    catch (error) {
      throw new SyntaxError(error instanceof Error ? error.message : String(error))
    }
    dispatchReports(unitsResult.unsupported, options)
    return fromUtf16Units(unitsResult.code)
  }
  // Only the binding call is wrapped into a SyntaxError (parse failures);
  // exceptions thrown from `options.onError` must propagate unchanged,
  // matching the JS implementation and `transpileAsync`.
  let result: NativeResult
  try {
    result = requireBinding().transpileNativeSync(input, toNativeOptions(options))
  }
  catch (error) {
    throw new SyntaxError(error instanceof Error ? error.message : String(error))
  }
  dispatchReports(result.unsupported, options)
  return result.code
}
