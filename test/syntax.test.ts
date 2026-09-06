import { parseSync } from 'oxc-parser'
import tsBlankSpace from 'ts-blank-space'
import { describe, expect, it } from 'vitest'
import { transpile } from '../src/index'

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
    // Given: a multi-line type annotation in a CRLF file
    const input = 'const a: {\r\n  x: number;\r\n} = { x: 1 };\r\n'
    // When: transpiled
    const { output, reported } = transpiled(input)
    // Then: blanked `\r`s are preserved like `\n`s
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('\r\n')
    expect(output.length).toBe(input.length)
    expect(reported).toBe(0)
  })

  it('erases class static blocks while keeping their statements', () => {
    // Given: a class with a static initializer block
    const input = 'class C { static { x = 1; } }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the block statements survive
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('{ x = 1; }')
  })

  it('erases definite and optional property markers', () => {
    // Given: class properties with `!` and `?` markers
    const input = 'class C { x!: number; y?: string }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: both markers are erased with the annotations
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('x  ')
    expect(output).toContain('y ')
    expect(output.length).toBe(input.length)
  })

  it('erases implements clauses after a superclass', () => {
    // Given: a class with both `extends` and `implements`
    const input
      = 'interface I { a: string }\nclass B {}\nclass C extends B implements I { a = ""; }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: only the implements clause is erased
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('class C extends B')
    expect(output).not.toContain('implements')
  })

  it('erases catch clause parameter annotations', () => {
    // Given: a typed catch parameter
    const input = 'try { f(); }\ncatch (e: unknown) {}\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the annotation is erased, the binding kept
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('catch (e         )')
  })

  it('keeps catch clauses without a parameter binding', () => {
    // Given: an optional catch binding
    const input = 'try { f(); }\ncatch {}\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the statement is untouched plain JS
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
  })

  it('keeps accessor properties as plain JavaScript', () => {
    // Given: a decorator-based accessor property
    const input = 'class C { accessor x = 1 }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: it needs no erasure
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
  })

  it('erases array destructuring annotations and skips holes', () => {
    // Given: an array pattern with a hole and a default value
    const input = 'function f([, a = 1]: number[]): number { return a; }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the annotation is erased, hole and default untouched
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('[, a = 1]')
  })

  it('keeps value re-exports as JavaScript', () => {
    // Given: a runtime `export *` re-export
    const input = 'export * from "./mod";\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the statement is untouched plain JS
    expect(output).toBe(input)
  })
})

describe('function parameter scanning', () => {
  it('erases annotations on async arrows', () => {
    // Given: an async arrow whose scan must skip the `async` keyword
    const input = 'const f = async (x: string): string => x;\n'
    // When: transpiled
    const output = transpile(input)
    // Then: parameter and return types are erased
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('const f = async (x        )')
    expect(output.length).toBe(input.length)
  })

  it('erases annotations on generator function expressions', () => {
    // Given: a generator expression whose scan must skip `function` and `*`
    const input
      = 'const g = function* <T>(x: T): T { return x as T; };\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the type parameters and annotations are erased
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('function*  ')
  })

  it('erases generator parameter lists with trailing commas', () => {
    // Given: a generator expression whose parameter list has a trailing comma
    const input
      = 'const g = function* <T>(x: T,): T { return x as T; };\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the annotation is erased and the comma survives
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('(x   ,)')
  })

  it('erases annotations on generic-free generator expressions', () => {
    // Given: a generator expression without type parameters, whose scan must
    // skip `function` and `*` before the parameter list
    const input = 'const g = function* (x: number): number { return x; };\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the parameter and return annotations are erased
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('function* (x        )         { return x; }')
  })

  it('moves the closing paren of multiline-return arrows', () => {
    // Given: an arrow whose return type starts on its own line, with a
    // trailing parameter comma
    const input = [
      'const f = <T>(',
      '  a: string,',
      '): {',
      '  v: number',
      '} => ({ v: 1 });',
      '',
    ].join('\n')
    // When: transpiled
    const output = transpile(input)
    // Then: `) =>` stays adjacent so the arrow still parses
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('\n) => ({ v: 1 });')
    expect(parseSync('input.js', output).errors).toEqual([])
  })

  it('erases annotations on arrows with type parameters', () => {
    // Given: an arrow with generic type parameters before the parens
    const input = 'const h = <T>(x: T): T => x;\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the type parameters and annotations are erased
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('const h =    ')
  })

  it('erases trailing commas after annotated single parameters', () => {
    // Given: a parameter list with a trailing comma
    const input = 'const k = (a: string,) => a;\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the annotation is erased and the comma survives
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('(a        ,) => a')
  })
})

describe('assertion hazards', () => {
  it('reports assertions whose erasure breaks a ??-mix on the right', () => {
    // Given: an assertion at the head of a `&&` chain under `??`
    const input = 'const v = a ?? b as T && c;\n'
    // When: transpiled
    const { output, reported } = transpiled(input)
    // Then: error + source preserved, matching the reference tool
    expect(output).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toBe(input)
    expect(reported).toBe(1)
  })

  it('throws on assertion chains over binary bases', () => {
    // Given: a doubly-asserted binary base whose erasure would rebind `*` —
    // TypeScript and oxc both reject it, so it fails at parse time
    const input = 'const x = a + b as T as U * c;\n'
    // When/Then: the parse failure surfaces as a SyntaxError
    expect(() => transpile(input)).toThrow(SyntaxError)
  })
})
