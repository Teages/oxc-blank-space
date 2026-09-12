import tsBlankSpace from 'ts-blank-space'
import { describe, expect, it } from 'vitest'
import { transpile } from './parity'

/**
 * `export` wrapping: declarations that erase fully must take the whole
 * statement with them, so no `export` keyword is ever left stranded.
 */
describe('exported declarations', () => {
  const collect = (input: string): { output: string, reported: number } => {
    let reported = 0
    const output = transpile(input, {
      onError: () => {
        reported += 1
      },
    })
    return { output, reported }
  }

  it('erases exported type aliases and interfaces', () => {
    const input = 'export type T = number;\nexport interface I { a: string }\n'
    const { output, reported } = collect(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).not.toContain('export')
    expect(reported).toBe(0)
  })

  it('erases ambient exports wholesale', () => {
    const input = [
      'export declare const x: number;',
      'export declare class C {}',
      'export declare enum E {}',
      '',
    ].join('\n')
    const { output, reported } = collect(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).not.toContain('export')
    expect(reported).toBe(0)
  })

  it('keeps exported functions with bodies', () => {
    const input = 'export function f(a: number): number { return a; }\n'
    const { output, reported } = collect(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('export function f(a')
    expect(output).toContain('{ return a; }')
    expect(reported).toBe(0)
  })

  it('keeps default-exported declarations', () => {
    const input = 'export default function f(a: string) { return a; }\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('export default function f(a')
  })

  it('reports namespaces with values under `export`', () => {
    const input = 'export namespace N { export const x = 1; }\n'
    const { output, reported } = collect(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })

  it('reports `export import = require` forms', () => {
    const input = 'export import lib = require("lib");\n'
    const { output, reported } = collect(input)
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })
})

/**
 * Namespace value detection: a namespace may be erased only when it holds
 * no runtime code.
 */
describe('namespace value detection', () => {
  const transpiled = (input: string): { output: string, reported: number } => {
    let reported = 0
    const output = transpile(input, {
      onError: () => {
        reported += 1
      },
    })
    return { output, reported }
  }

  it('erases namespaces holding only types', () => {
    const input = 'namespace X { export type T = 1; }\n'
    const { output, reported } = transpiled(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).not.toContain('namespace')
    expect(reported).toBe(0)
  })

  it('keeps namespaces re-exporting values', () => {
    const input = 'namespace X { export import y = Z.w; }\n'
    const { output, reported } = transpiled(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })

  it('keeps namespaces with re-export statements', () => {
    const input = 'namespace X { export * from "y"; }\n'
    const { output, reported } = transpiled(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })

  it('keeps namespaces with bare export lists', () => {
    const input = 'namespace X { export {}; }\n'
    const { output, reported } = transpiled(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })
})
