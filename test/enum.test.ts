import { describe, expect, it } from 'vitest'
import { transpile } from './parity'

/**
 * Enum expansion mirrors the TypeScript emitter. These tests pin the emitted
 * text and, where the input is valid runtime TS, the evaluated enum object.
 */
describe('enum expansion', () => {
  /** Run transpiled output and return the expanded enum object. */
  const evalEnum = (
    input: string,
    f?: (name: string) => unknown,
  ): Record<string | number, unknown> => {
    const output = transpile(input)
    const name = /\(function \((\w+)\)/.exec(output)?.[1]
    expect(name).toBeTruthy()
    const factory = new Function(
      'f',
      `${output}; return ${name as string};`,
    )
    return factory(f)
  }

  it.each([
    ['2 + 1', 3],
    ['2 - 1', 1],
    ['2 * 3', 6],
    ['8 / 4', 2],
    ['7 % 3', 1],
    ['2 ** 5', 32],
    ['1 << 4', 16],
    ['-8 >> 1', -4],
    ['255 >>> 4', 15],
    ['5 | 2', 7],
    ['5 & 3', 1],
    ['5 ^ 3', 6],
  ])('folds binary constant `%s` to %i', (expr, expected) => {
    // Given: a member whose initializer is a constant binary expression
    const input = `enum E { A = ${expr} }`
    // When: transpiled
    const output = transpile(input)
    // Then: the folded value is emitted, matching the TypeScript emitter
    expect(output).toContain(`E[E["A"] = ${expected}] = "A"`)
    expect(evalEnum(input).A).toBe(expected)
  })

  it.each([
    ['-5', -5],
    ['+5', 5],
    ['~5', -6],
  ])('folds unary constant `%s` to %i', (expr, expected) => {
    // Given: a member whose initializer is a constant unary expression
    const input = `enum E { A = ${expr} }`
    // When: transpiled
    const output = transpile(input)
    // Then: the folded value is emitted
    expect(output).toContain(`E[E["A"] = ${expected}] = "A"`)
    expect(evalEnum(input).A).toBe(expected)
  })

  it('keeps unary and binary initializers the folder cannot compute', () => {
    // Given: constants over unknown identifiers or non-arithmetic operators
    const inputs = [
      'enum E { A = -X }',
      'enum E { A = !5 }',
      'enum E { A = {} instanceof Object }',
      'enum E { A = 1 < 2 }',
    ]
    // When/Then: each is kept verbatim in the emitted assignment
    for (const input of inputs) {
      const output = transpile(input)
      const expr = input.slice(input.indexOf('= ') + 2, -1).trim()
      expect(output).toContain(`E[E["A"] = ${expr}] = "A"`)
    }
  })

  it('folds parenthesized constants', () => {
    // Given: a parenthesized constant initializer
    const input = 'enum E { A = (2 + 3) }'
    // When: transpiled
    const output = transpile(input)
    // Then: the parenthesized expression folds to its value
    expect(output).toContain('E[E["A"] = 5] = "A"')
  })

  it('folds references to earlier constant members', () => {
    // Given: an initializer referencing a sibling constant
    const input = 'enum E { A = 5, B = A + 1 }'
    // When: transpiled and evaluated
    const output = transpile(input)
    // Then: the reference folds through the constants map
    expect(output).toContain('E[E["B"] = 6] = "B"')
    expect(evalEnum(input).B).toBe(6)
  })

  it('keeps non-constant initializers verbatim and qualifies references', () => {
    // Given: an initializer the folder cannot compute
    const input = 'enum E { A = 1, B = A + f() }'
    // When: transpiled with a runtime `f`
    const output = transpile(input)
    // Then: the source expression is kept and the sibling reference is
    // qualified with the enum name
    expect(output).toContain('E[E["B"] = E.A + f()] = "B"')
    expect(evalEnum(input, () => 1).B).toBe(2)
  })

  it('qualifies member references in computed positions', () => {
    // Given: initializers referencing siblings inside members, computed
    // keys, computed indices and array literals
    const input = [
      'enum E {',
      '  A = 3,',
      '  B = f({ v: A, [A]: 0 }),',
      '  C = arr[A] + A.toFixed(0) + f(),',
      '  D = [A, 2] + f(),',
      '  G = `${A}` + f(),',
      '}',
    ].join('\n')
    // When: transpiled
    const output = transpile(input)
    // Then: every bare sibling reference is qualified, and every other
    // sub-expression is left untouched
    expect(output).toContain('f({ v: E.A, [E.A]: 0 })')
    expect(output).toContain('arr[E.A] + E.A.toFixed(0)')
    expect(output).toContain('[E.A, 2]')
    expect(output).toContain('`${E.A}`')
  })

  it('emits `undefined` for auto-increment after a non-constant member', () => {
    // Given: unannotated members following a non-constant initializer
    // (a TypeScript compile error whose emit shape tsc still defines)
    const input = 'enum E { A = f(), B, C }'
    // When: transpiled
    const output = transpile(input)
    // Then: both followers mirror tsc's `undefined` emit
    expect(output).toContain('E[E["B"] = undefined] = "B"')
    expect(output).toContain('E[E["C"] = undefined] = "C"')
  })

  it('emits string members without a reverse mapping', () => {
    // Given: string-valued members
    const input = 'enum E { A = "x", B = "y" }'
    // When: transpiled and evaluated
    const E = evalEnum(input)
    // Then: plain assignments are emitted (no reverse mapping)
    expect(transpile(input)).toContain('E["A"] = "x"')
    expect(transpile(input)).toContain('E["B"] = "y"')
    expect(E).toEqual({ A: 'x', B: 'y' })
  })

  it('supports quoted string member names', () => {
    // Given: members named by string literals (double and single quoted)
    const input = 'enum E { "str name" = 1, \'sq\' = 2 }'
    // When: transpiled and evaluated
    const E = evalEnum(input)
    // Then: the literal names become quoted property keys
    expect(transpile(input)).toContain('E["str name"] = 1')
    expect(transpile(input)).toContain('E["sq"] = 2')
    expect(E['str name']).toBe(1)
    expect(E.sq).toBe(2)
  })

  it('keeps a self-referencing initializer bare like tsc', () => {
    // Given: a member referencing itself (a compile-error input)
    const input = 'enum E { A = A }'
    // When: transpiled
    const output = transpile(input)
    // Then: the reference is emitted bare, matching the TypeScript emitter
    expect(output).toContain('E[E["A"] = A] = "A"')
  })
})
