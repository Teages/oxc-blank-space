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

interface NativeBinding {
  transpileAsync: (input: string, options?: NativeOptions) => Promise<NativeResult>
  transpileNativeSync: (input: string, options?: NativeOptions) => NativeResult
}
const nativeDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')

/**
 * The napi artifact for the running platform, e.g.
 * `oxc-blank-space-native.darwin-arm64.node`.
 */
function platformBinary(): string | undefined {
  const preferred = `oxc-blank-space-native.${process.platform}-${process.arch}.node`
  const binaries = readdirSync(nativeDir).filter(file => file.endsWith('.node')).sort()
  return binaries.includes(preferred) ? preferred : binaries[0]
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
  const result = await requireBinding()
    .transpileAsync(input, toNativeOptions(options))
    .catch((error: unknown) => {
      throw new SyntaxError(error instanceof Error ? error.message : String(error))
    })
  dispatchReports(result.unsupported, options)
  return result.code
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
