// Loads the actual published browser artifact (dist/browser.mjs) end to end.
// The bundled wasm loader fetches the module with `globalThis.fetch`, which
// cannot read file:// URLs, so the test installs a fetch shim that serves
// local files — after that, the real module graph (bundled wasm runtime +
// instantiation + transpile calls) runs exactly as it would in a browser.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const browserEntryPath = join(root, 'dist/browser.mjs')

if (!existsSync(browserEntryPath)) {
  throw new Error('the browser entry is missing; run `pnpm build` first')
}

// the shim must be installed before the (top-level-await) import below
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.startsWith('file:')) {
    const { fileURLToPath } = await import('node:url')
    return new Response(readFileSync(fileURLToPath(url)), { status: 200 })
  }
  return originalFetch(input)
}) as typeof fetch

afterAll(() => {
  globalThis.fetch = originalFetch
})

interface BrowserEntry {
  transpile: (input: string, options?: object) => Promise<string>
  transpileSync: (input: string, options?: object) => string
}

const browser = (await import(browserEntryPath)) as BrowserEntry

describe('browser entry (dist/browser.mjs)', () => {
  it('blanks type annotations while preserving positions', () => {
    expect(browser.transpileSync('const a: number = 1')).toBe('const a         = 1')
  })

  it('expands enums through the async entry', async () => {
    const output = await browser.transpile('enum E { A = 2 }')
    expect(output).toContain('E[E["A"] = 2] = "A"')
  })

  it('rejects parse errors with a codeframe-carrying SyntaxError', async () => {
    await expect(browser.transpile('let x: = 1')).rejects.toThrow(SyntaxError)
  })

  it('keeps astral characters lossless through the UTF-16 path', () => {
    const input = 'const 文: string = "😀";'
    const output = browser.transpileSync(input)
    expect(output.length).toBe(input.length)
    expect(output).toContain('文')
    expect(output).toContain('😀')
  })
})
