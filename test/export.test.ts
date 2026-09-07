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
    // Given: type-only exports
    const input = 'export type T = number;\nexport interface I { a: string }\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: the whole statements are erased
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).not.toContain('export')
    expect(reported).toBe(0)
  })

  it('erases ambient exports wholesale', () => {
    // Given: `declare` constants, classes and enums under `export`
    const input = [
      'export declare const x: number;',
      'export declare class C {}',
      'export declare enum E {}',
      '',
    ].join('\n')
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: all three statements are erased
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).not.toContain('export')
    expect(reported).toBe(0)
  })

  it('keeps exported functions with bodies', () => {
    // Given: an exported function with a body
    const input = 'export function f(a: number): number { return a; }\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: the signature types are erased, the body is kept
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('export function f(a')
    expect(output).toContain('{ return a; }')
    expect(reported).toBe(0)
  })

  it('keeps default-exported declarations', () => {
    // Given: a default-exported function with a body
    const input = 'export default function f(a: string) { return a; }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: only the types are erased
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('export default function f(a')
  })

  it('reports namespaces with values under `export`', () => {
    // Given: an exported namespace holding a runtime value
    const input = 'export namespace N { export const x = 1; }\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: the source is kept and the module is reported
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })

  it('reports `export import = require` forms', () => {
    // Given: the CJS interop import under `export`
    const input = 'export import lib = require("lib");\n'
    // When: transpiled
    const { output, reported } = collect(input)
    // Then: the source is kept and reported
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
    // Given: a namespace whose body exports only a type
    const input = 'namespace X { export type T = 1; }\n'
    // When: transpiled
    const { output, reported } = transpiled(input)
    // Then: the namespace is erased without an error
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).not.toContain('namespace')
    expect(reported).toBe(0)
  })

  it('keeps namespaces re-exporting values', () => {
    // Given: a namespace body with an `export import` alias
    const input = 'namespace X { export import y = Z.w; }\n'
    // When: transpiled
    const { output, reported } = transpiled(input)
    // Then: the source is kept and the namespace reported
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })

  it('keeps namespaces with re-export statements', () => {
    // Given: a namespace body with an `export *` re-export
    const input = 'namespace X { export * from "y"; }\n'
    // When: transpiled
    const { output, reported } = transpiled(input)
    // Then: the source is kept and the namespace reported
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })

  it('keeps namespaces with bare export lists', () => {
    // Given: a namespace body with an `export {}` list
    const input = 'namespace X { export {}; }\n'
    // When: transpiled
    const { output, reported } = transpiled(input)
    // Then: the source is kept and the namespace reported
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })
})
