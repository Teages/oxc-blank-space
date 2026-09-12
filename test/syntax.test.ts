import { parseSync } from 'oxc-parser'
import tsBlankSpace from 'ts-blank-space'
import { describe, expect, it } from 'vitest'
import { transpile } from './parity'

/**
 * Cross-cutting erasure mechanics that do not belong to a single construct:
 * position preservation, class/param syntax corners, and assertion-hazard
 * reporting.
 */
function transpiled(input: string): { output: string, reported: number } {
  let reported = 0
  const output = transpile(input, {
    onError: () => {
      reported += 1
    },
  })
  return { output, reported }
}

describe('erasure mechanics', () => {
  it('preserves CRLF line endings inside blanked spans', () => {
    const input = 'const a: {\r\n  x: number;\r\n} = { x: 1 };\r\n'
    const { output, reported } = transpiled(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('\r\n')
    expect(output.length).toBe(input.length)
    expect(reported).toBe(0)
  })

  it('erases class static blocks while keeping their statements', () => {
    const input = 'class C { static { x = 1; } }\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('{ x = 1; }')
  })

  it('erases definite and optional property markers', () => {
    const input = 'class C { x!: number; y?: string }\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('x  ')
    expect(output).toContain('y ')
    expect(output.length).toBe(input.length)
  })

  it('erases implements clauses after a superclass', () => {
    const input
      = 'interface I { a: string }\nclass B {}\nclass C extends B implements I { a = ""; }\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('class C extends B')
    expect(output).not.toContain('implements')
  })

  it('erases catch clause parameter annotations', () => {
    const input = 'try { f(); }\ncatch (e: unknown) {}\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('catch (e         )')
  })

  it('keeps catch clauses without a parameter binding', () => {
    const input = 'try { f(); }\ncatch {}\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
  })

  it('keeps accessor properties as plain JavaScript', () => {
    const input = 'class C { accessor x = 1 }\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
  })

  it('erases array destructuring annotations and skips holes', () => {
    const input = 'function f([, a = 1]: number[]): number { return a; }\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('[, a = 1]')
  })

  it('keeps value re-exports as JavaScript', () => {
    const input = 'export * from "./mod";\n'
    const output = transpile(input)
    expect(output).toBe(input)
  })
})

describe('function parameter scanning', () => {
  it('erases annotations on async arrows', () => {
    const input = 'const f = async (x: string): string => x;\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('const f = async (x        )')
    expect(output.length).toBe(input.length)
  })

  it('erases annotations on generator function expressions', () => {
    const input
      = 'const g = function* <T>(x: T): T { return x as T; };\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('function*  ')
  })

  it('erases generator parameter lists with trailing commas', () => {
    const input
      = 'const g = function* <T>(x: T,): T { return x as T; };\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('(x   ,)')
  })

  it('erases annotations on generic-free generator expressions', () => {
    const input = 'const g = function* (x: number): number { return x; };\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('function* (x        )         { return x; }')
  })

  it('moves the closing paren of multiline-return arrows', () => {
    const input = [
      'const f = <T>(',
      '  a: string,',
      '): {',
      '  v: number',
      '} => ({ v: 1 });',
      '',
    ].join('\n')
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('\n) => ({ v: 1 });')
    expect(parseSync('input.js', output).errors).toEqual([])
  })

  it('erases annotations on arrows with type parameters', () => {
    const input = 'const h = <T>(x: T): T => x;\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('const h =    ')
  })

  it('erases trailing commas after annotated single parameters', () => {
    const input = 'const k = (a: string,) => a;\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('(a        ,) => a')
  })
})

describe('assertion hazards', () => {
  it('reports assertions whose erasure breaks a ??-mix on the right', () => {
    const input = 'const v = a ?? b as T && c;\n'
    const { output, reported } = transpiled(input)
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })

  it('throws on assertion chains over binary bases', () => {
    // erasure would rebind `*` — TypeScript and oxc both reject this input
    const input = 'const x = a + b as T as U * c;\n'
    expect(() => transpile(input)).toThrow(SyntaxError)
  })
})
