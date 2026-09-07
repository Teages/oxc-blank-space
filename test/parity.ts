import type { TranspileOptions, UnsupportedSyntax } from '../src/index'
import { afterAll, expect } from 'vitest'
import { transpile as transpileAsync, transpileSync } from '../src/index'

/**
 * The behavior suites run against the synchronous API, and every call is
 * cross-checked against the asynchronous API in this file's afterAll: output,
 * onError reports and rejection messages must match byte for byte.
 */
const asyncChecks: Array<() => Promise<void>> = []

afterAll(async () => {
  for (const [index, check] of asyncChecks.entries()) {
    await check().catch((error: unknown) => {
      throw new Error(`async transpile mismatch (queued check #${index})`, {
        cause: error,
      })
    })
  }
})

export function transpile(input: string, options: TranspileOptions = {}): string {
  const reports: UnsupportedSyntax[] = []
  let output: string
  try {
    output = transpileSync(input, {
      ...options,
      onError: (node) => {
        reports.push(node)
        options.onError?.(node)
      },
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    asyncChecks.push(async () => {
      let asyncMessage = ''
      try {
        await transpileAsync(input, options)
      }
      catch (asyncError) {
        asyncMessage = asyncError instanceof Error ? asyncError.message : String(asyncError)
      }
      expect(asyncMessage, `async rejection for ${JSON.stringify(input.slice(0, 80))}`).toBe(message)
    })
    throw error
  }

  asyncChecks.push(async () => {
    const asyncReports: UnsupportedSyntax[] = []
    const asyncOutput = await transpileAsync(input, {
      ...options,
      onError: (node) => {
        asyncReports.push(node)
      },
    })
    expect(
      asyncOutput,
      `async output for ${JSON.stringify(input.slice(0, 80))}`,
    ).toBe(output)
    expect(asyncReports).toEqual(reports)
  })

  return output
}
