import type { TranspileOptions } from './types'

export type { OnError, TranspileOptions, UnsupportedSyntax } from './types'

export interface NativeOptions {
  lang?: string
  filename?: string
}

export interface NativeUnsupported {
  nodeType: string
  start: number
  end: number
}

export interface NativeResult {
  code: string
  unsupported: NativeUnsupported[]
}

export interface NativeUnitsResult {
  code: Uint16Array
  unsupported: NativeUnsupported[]
}

export interface NativeBinding {
  transpileAsync: (input: string, options?: NativeOptions) => Promise<NativeResult>
  transpileNativeSync: (input: string, options?: NativeOptions) => NativeResult
  transpileUtf16Async: (units: Uint16Array, options?: NativeOptions) => Promise<NativeUnitsResult>
  transpileUtf16Sync: (units: Uint16Array, options?: NativeOptions) => NativeUnitsResult
}

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
 * Build the public `transpile`/`transpileSync` pair on top of a binding
 * loader. Both platform entries (Node `.node` binary, browser WASM) share
 * this wrapper so surrogate routing, `SyntaxError` wrapping and `onError`
 * dispatch behave identically everywhere.
 *
 * The loader returns `undefined` when no usable binding exists for the
 * runtime; the resulting API then throws on use.
 */
export function createApi(load: () => NativeBinding | undefined): {
  transpile: (input: string, options?: TranspileOptions) => Promise<string>
  transpileSync: (input: string, options?: TranspileOptions) => string
  isAvailable: boolean
} {
  let binding: NativeBinding | undefined
  let loadError: unknown
  try {
    binding = load()
  }
  catch (error) {
    // a present-but-broken artifact surfaces through requireBinding, with the
    // original failure (e.g. a dlopen error) attached as `cause`
    binding = undefined
    loadError = error
  }

  // throws a plain Error — not a SyntaxError, which is reserved for parse
  // failures on both entry points
  function requireBinding(): NativeBinding {
    if (!binding) {
      throw new Error(
        'petrea: no usable transpiler binding for this runtime. Run `pnpm build` first, or import `petrea/wasm` in browser environments.',
        { cause: loadError },
      )
    }
    return binding
  }

  /**
   * Transpile with the Rust implementation, parsing and blanking on a
   * background thread (Node) or the wasm async worker (browser). Resolves
   * with the blanked JavaScript; `options.onError` is invoked with the
   * kept-verbatim unsupported constructs before the promise settles.
   * Rejects with a `SyntaxError` when the input cannot be parsed.
   *
   * ```
   * import { transpile } from 'petrea'
   *
   * await transpile(`const a: number = 1`)
   * // 'const a         = 1'
   * ```
   */
  async function transpile(
    input: string,
    options: TranspileOptions = {},
  ): Promise<string> {
    const native = requireBinding()
    if (LONE_SURROGATE.test(input)) {
      const result = await native
        .transpileUtf16Async(toUtf16Units(input), toNativeOptions(options))
        .catch((error: unknown) => {
          throw new SyntaxError(error instanceof Error ? error.message : String(error))
        })
      dispatchReports(result.unsupported, options)
      return fromUtf16Units(result.code)
    }
    const result = await native
      .transpileAsync(input, toNativeOptions(options))
      .catch((error: unknown) => {
        throw new SyntaxError(error instanceof Error ? error.message : String(error))
      })
    dispatchReports(result.unsupported, options)
    return result.code
  }

  /**
   * Synchronous counterpart of {@link transpile}: the same Rust pipeline,
   * running entirely on the calling thread. Produces byte-for-byte identical
   * output; prefer it when no other work needs to run concurrently.
   */
  function transpileSync(
    input: string,
    options: TranspileOptions = {},
  ): string {
    // resolved outside the try blocks: a missing binding throws a plain
    // Error, only parse failures are wrapped into a SyntaxError
    const native = requireBinding()
    if (LONE_SURROGATE.test(input)) {
      let unitsResult: NativeUnitsResult
      try {
        unitsResult = native.transpileUtf16Sync(toUtf16Units(input), toNativeOptions(options))
      }
      catch (error) {
        throw new SyntaxError(error instanceof Error ? error.message : String(error))
      }
      dispatchReports(unitsResult.unsupported, options)
      return fromUtf16Units(unitsResult.code)
    }
    // exceptions thrown from `options.onError` propagate unchanged
    let result: NativeResult
    try {
      result = native.transpileNativeSync(input, toNativeOptions(options))
    }
    catch (error) {
      throw new SyntaxError(error instanceof Error ? error.message : String(error))
    }
    dispatchReports(result.unsupported, options)
    return result.code
  }

  return { transpile, transpileSync, isAvailable: binding != null }
}
