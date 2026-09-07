import type { TranspileOptions, UnsupportedSyntax } from '../src/index'
import { afterAll, expect } from 'vitest'
import { transpile as transpileJs } from '../src/index'
import { nativeBindingAvailable, transpileAsync, transpileSync } from '../src/native'

/**
 * Checked replacement for `transpile` in the behavior suites: runs the JS
 * implementation the tests were written against, and — when the native binary
 * is built — asserts that `transpileSync`/`transpileAsync` produce the same
 * output, the same onError reports, and the same rejection behavior.
 *
 * Async checks cannot await inline (the behavior tests are synchronous), so
 * they are queued and flushed in this file's afterAll; a failure there fails
 * the whole file.
 */
const asyncChecks: Array<() => Promise<void>> = []

afterAll(async () => {
  for (const [index, check] of asyncChecks.entries()) {
    await check().catch((error: unknown) => {
      throw new Error(`native async parity failed (queued check #${index})`, {
        cause: error,
      })
    })
  }
})

export function transpile(input: string, options: TranspileOptions = {}): string {
  const jsReports: UnsupportedSyntax[] = []
  let js: string
  try {
    js = transpileJs(input, {
      ...options,
      onError: (node) => {
        jsReports.push(node)
        options.onError?.(node)
      },
    })
  }
  catch (jsError) {
    // rejection parity: both native entries must reject with a SyntaxError
    // (wording differs — the JS error carries the codeframe — so only the
    // type is asserted; the original JS error is rethrown to the test)
    if (nativeBindingAvailable) {
      expect(() => transpileSync(input, options)).toThrow(SyntaxError)
      asyncChecks.push(async () => {
        await expect(transpileAsync(input, options)).rejects.toThrow(SyntaxError)
      })
    }
    throw jsError
  }

  if (nativeBindingAvailable) {
    // sync: output + onError reports must match
    const syncReports: UnsupportedSyntax[] = []
    const sync = transpileSync(input, {
      ...options,
      onError: node => syncReports.push(node),
    })
    expect(sync, `sync output for ${JSON.stringify(input.slice(0, 80))}`).toBe(js)
    expect(syncReports).toEqual(jsReports)

    // async: queued (see afterAll)
    asyncChecks.push(async () => {
      const asyncReports: UnsupportedSyntax[] = []
      const asyncOutput = await transpileAsync(input, {
        ...options,
        onError: node => asyncReports.push(node),
      })
      expect(
        asyncOutput,
        `async output for ${JSON.stringify(input.slice(0, 80))}`,
      ).toBe(js)
      expect(asyncReports).toEqual(jsReports)
    })
  }

  return js
}
