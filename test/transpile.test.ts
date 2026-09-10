import { parseSync } from 'oxc-parser'
import tsBlankSpace from 'ts-blank-space'
import { describe, expect, it } from 'vitest'
import { transpile } from './parity'

describe('transpile', () => {
  it('blanks a type annotation while preserving positions', () => {
    // Given: a variable declaration with a type annotation
    const input = 'const a: number = 1'
    // When: transpiled
    const output = transpile(input)
    // Then: the annotation becomes whitespace of equal length
    expect(output).toBe('const a         = 1')
    expect(output).toEqual(tsBlankSpace(input))
    expect(output.length).toBe(input.length)
  })

  it('keeps every line and column of untouched code stable', () => {
    // Given: code mixing types and runtime statements
    const input = [
      'function greet(name: string): string {',
      '  return `hi ${name}`;',
      '}',
      '',
    ].join('\n')
    // When: transpiled
    const output = transpile(input)
    // Then: output has the same length and line count
    expect(output.length).toBe(input.length)
    expect(output.split('\n').length).toBe(input.split('\n').length)
    expect(output).toContain('return `hi ${name}`;')
  })

  it('keeps CR/LF when blanking and replaces U+2028/U+2029 with spaces', () => {
    // Given: blanked type declarations containing each line terminator kind.
    // Pinned behavior: blanked regions preserve CR/LF as line breaks and turn
    // U+2028/U+2029 into single spaces like any other character, matching the
    // reference implementation; the UTF-16 length is kept either way
    const cases = [
      ['\r\n', true],
      ['\r', true],
      ['\u2028', false],
      ['\u2029', false],
    ] as const
    for (const [separator, preserved] of cases) {
      const input = `type T${separator}= 'x';\nconst after = 1;\n`
      // When: transpiled
      const output = transpile(input)
      // Then: the output matches the reference byte for byte, keeps the
      // total length, and preserves exactly the CR/LF terminators
      expect(output).toEqual(tsBlankSpace(input))
      expect(output.length).toBe(input.length)
      expect(output.includes(separator)).toBe(preserved)
    }
  })

  it('applies the pinned line-terminator behavior on the UTF-16 path', () => {
    // Given: a raw lone surrogate routing the input through the UTF-16 entry
    // points; the pinned CR/LF vs U+2028/U+2029 behavior must not differ
    const surrogate = String.fromCharCode(0xD800)
    const cases = [
      ['\r\n', true],
      ['\r', true],
      ['\u2028', false],
      ['\u2029', false],
    ] as const
    for (const [separator, preserved] of cases) {
      const input = `type T${separator}= 'x';\nconst y = '${surrogate}';\n`
      // When: transpiled
      const output = transpile(input)
      // Then: same pinned behavior, the surrogate survives, length unchanged
      expect(output.length).toBe(input.length)
      expect(output.includes(separator)).toBe(preserved)
      expect(output).toContain(surrogate)
      expect(output.endsWith(`const y = '${surrogate}';\n`)).toBe(true)
    }
  })

  it('erases interfaces and type aliases as blank statements', () => {
    // Given: type-only declarations
    const input
      = 'interface Foo {\n  a: string;\n}\ntype Bar = Foo | null;\nconst x = 1;\n'
    // When: transpiled
    const output = transpile(input)
    // Then: only whitespace remains where the declarations were
    expect(output).toEqual(tsBlankSpace(input))
    expect(output.trim()).toBe('const x = 1;')
    expect(output.length).toBe(input.length)
  })

  it('erases `as` and `satisfies` expressions and non-null assertions', () => {
    // Given: assertions of all three shapes
    const input
      = 'const a = b as C;\nconst d = e satisfies F;\nconst g = h!.i;\n'
    // When: transpiled
    const output = transpile(input)
    // Then: assertion syntax is gone, positions unchanged
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).not.toContain('as')
    expect(output).not.toContain('satisfies')
    expect(output).not.toContain('!')
  })

  it('erases generic type arguments and parameters', () => {
    // Given: generics on calls, news, functions and classes
    const input = [
      'function f<T>(x: T): T { return x }',
      'const a = new Set<string>()',
      'const b = f<number>(1)',
      'class C<K> extends Array<K> { m(): void {} }',
      '',
    ].join('\n')
    // When: transpiled
    const output = transpile(input)
    // Then: no angle-bracket types remain
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).not.toContain('<')
    expect(output).not.toContain('>')
  })

  it('erases type-only imports and exports', () => {
    // Given: mixed type and value module syntax
    const input = [
      'import type A from "a";',
      'import { type B, c } from "b";',
      'import d, { type E } from "c";',
      'export type F = 1;',
      'export { type G, h } from "d";',
      'export const i = 1;',
      '',
    ].join('\n')
    // When: transpiled
    const output = transpile(input)
    // Then: type-only parts are erased, value parts kept
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toContain('import {         c } from "b"')
    expect(output).toContain('import d, {        } from "c"')
    expect(output).toContain('export {         h } from "d"')
    expect(output).toContain('export const i = 1;')
  })

  it('erases declare statements and ambient declarations', () => {
    // Given: ambient-only syntax
    const input
      = 'declare const a: number;\ndeclare function f(): void;\ndeclare class C {}\ndeclare enum E {}\ndeclare module "m" {}\ndeclare global { }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: everything is blanked
    expect(output).toEqual(tsBlankSpace(input))
    expect(output.trim()).toBe('')
  })

  it('erases class member type syntax but keeps runtime modifiers', () => {
    // Given: members with annotations, modifiers and one parameter property
    const input = [
      'class C {',
      '  readonly x = 1;',
      '  private static y!: string;',
      '  declare z: any;',
      '  constructor(private a: string, b?: number) {}',
      '}',
      '',
    ].join('\n')
    // When: transpiled
    const output = transpile(input)
    // Then: runtime parts survive and the parameter property is reported
    const errors: unknown[] = []
    const outputWithError = transpile(input, {
      onError: e => errors.push(e),
    })
    expect(outputWithError).toEqual(tsBlankSpace(input, () => {}))
    expect(output).toContain('x = 1;')
    expect(output).toContain('static')
    expect(output).not.toContain('readonly')
    expect(errors.length).toBe(1)
  })

  it('erases namespaces that contain only types', () => {
    // Given: a namespace holding an interface
    const input
      = 'namespace N {\n  export interface I {}\n}\nconst after = 1;\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the namespace is blanked and ASI protection is not needed
    expect(output).toEqual(tsBlankSpace(input))
    expect(output.trim()).toBe('const after = 1;')
  })

  it('adds ASI protection for statements after blanked syntax', () => {
    // Given: a JS statement without a semicolon followed by a blanked one and a paren statement
    const input = 'const a = b\ntype X = number\n(f())()\n'
    // When: transpiled
    const output = transpile(input)
    // Then: a `;` guards the next statement from merging
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toContain('\n;')
    expect(output.length).toBe(input.length)
  })

  it('handles arrow functions whose return type spans lines', () => {
    // Given: an arrow with the `=>` on a later line than the parameters
    const input = '[1].map((v)\n:number[\n]=>[v]);\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the `)` moves next to the arrow, keeping the output valid JS
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toBe('[1].map((v \n        \n)=>[v]);\n')
  })

  it('moves the closing paren for arrows with multiline parameter lists', () => {
    // Given: an arrow whose parameter list spans lines before the return type
    const input
      = 'export const f = (\n    a: string,\n): number | undefined => list.pop();\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the `)` is relocated next to the `=>`, matching the reference
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toContain(') => list.pop();')
    expect(output.length).toBe(input.length)
  })

  it('moves the opening paren when generic parameters span lines', () => {
    // Given: a function with multi-line type parameters
    const input = 'function f<\n  T\n>(\n  a: T\n) {}\n'
    // When: transpiled
    const output = transpile(input)
    // Then: output matches the reference implementation
    expect(output).toEqual(tsBlankSpace(input))
  })

  it('erases catch clause parameter annotations', () => {
    // Given: a typed catch parameter
    const input = 'try {} catch (e: unknown) { }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the annotation is blanked, the binding kept
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toContain('catch (e         ) { }')
    expect(output.length).toBe(input.length)
  })

  it('erases this parameters and optional markers', () => {
    // Given: a method with a this-param and optional members
    const input
      = 'class C { m?(a): void; }\nfunction f(this: Window, x?: string) {}\n'
    // When: transpiled
    const output = transpile(input)
    // Then: output matches the reference implementation
    expect(output).toEqual(tsBlankSpace(input))
  })

  it('supports tsx parsing via the lang option', () => {
    // Given: tsx code with an embedded assertion
    const input = 'const elm = <div>{x as string}</div>;\n'
    // When: transpiled with lang tsx
    const output = transpile(input, { lang: 'tsx' })
    // Then: the assertion is erased and the JSX stays intact
    // (the reference tool's default entry always parses as plain .ts, so
    // only the position/length invariants are compared here)
    expect(output).toBe('const elm = <div>{x          }</div>;\n')
    expect(output.length).toBe(input.length)
  })

  it('throws a SyntaxError on input oxc cannot parse', () => {
    // Given: input oxc cannot recover a statement list from
    const input = 'let x: = 1'
    // When/Then: the failure surfaces as a SyntaxError
    expect(() => transpile(input)).toThrow(SyntaxError)
    expect(() => transpile(input)).toThrow(/input\.ts/)
  })

  it('labels parse diagnostics with the provided filename', () => {
    // Given: invalid input and a caller-supplied source path
    const input = 'let x: = 1'
    // When/Then: the thrown diagnostics quote that path
    expect(() => transpile(input, { filename: 'src/app.ts' })).toThrow(
      /src\/app\.ts/,
    )
  })

  it('infers tsx parsing from a .tsx filename', () => {
    // Given: JSX input without the lang option
    const input = 'const elm = <div>{x as string}</div>;\n'
    // When: transpiled with a .tsx filename
    const output = transpile(input, { filename: 'component.tsx' })
    // Then: the assertion is erased and the JSX stays intact
    expect(output).toBe('const elm = <div>{x          }</div>;\n')
    expect(output.length).toBe(input.length)
  })

  it('throws on grouping-unsafe assertions like TypeScript does', () => {
    // Given: an `as` erasure that would rebind the `/` (TypeScript#63527) —
    // invalid to both TypeScript and oxc, so it never reaches the erasure
    // logic
    const input = 'const x = 1 + 1 as T / 2'
    // When/Then: the parse failure is surfaced as a SyntaxError instead of a
    // silent passthrough
    expect(() => transpile(input)).toThrow(SyntaxError)
  })

  it('throws on unparseable input even when other statements are valid', () => {
    // Given: a file mixing erasable assertions with one invalid statement
    const input = 'const a = 1 as T;\nlet y: = 2;\nconst b = 2 as U;\n'
    // When/Then: no silent partial passthrough
    expect(() => transpile(input)).toThrow(SyntaxError)
  })

  it('erases safe assertions without wrapping', () => {
    // Given: assertions whose erasure cannot change grouping
    const input = 'const x = a as T + 2'
    // When: transpiled
    const output = transpile(input)
    // Then: no parens are inserted, length preserved
    expect(output).toBe('const x = a      + 2')
    expect(output.length).toBe(input.length)
  })

  it('expands runtime enums into TypeScript-compiler-shaped IIFEs', () => {
    // Given: an auto-incrementing enum with an explicit value in the middle
    const input = 'enum Color { Red, Green = 5, Blue }'
    // When: transpiled and evaluated
    const output = transpile(input)
    const Color = new Function(`${output}; return Color;`)()
    // Then: forward and reverse mappings match the TypeScript emitter
    expect(output).toBe(
      'var  Color; (function (Color) { Color[Color["Red"] = 0] = "Red"; Color[Color["Green"] = 5] = "Green"; Color[Color["Blue"] = 6] = "Blue" })(Color || (Color = {}));',
    )
    expect(Color).toEqual({
      Red: 0,
      Green: 5,
      Blue: 6,
      0: 'Red',
      5: 'Green',
      6: 'Blue',
    })
  })

  it('expands string enums without reverse mapping', () => {
    // Given: a string enum
    const input = 'enum S { A = "x", B = "y" }'
    // When: transpiled and evaluated
    const output = transpile(input)
    const S = new Function(`${output}; return S;`)()
    // Then: plain property assignments, matching the TypeScript emitter
    expect(output).toBe(
      'var  S; (function (S) { S["A"] = "x"; S["B"] = "y" })(S || (S = {}));',
    )
    expect(S).toEqual({ A: 'x', B: 'y' })
  })

  it('resolves member references inside enum initializers', () => {
    // Given: members referencing earlier members and non-constant values
    const input = 'enum E { A, B = A, C = B + 1, D = "d".length, F = D }'
    // When: transpiled and evaluated
    const output = transpile(input)
    const E = new Function(`${output}; return E;`)()
    // Then: references are qualified with the enum name and stay correct
    expect(output).toContain('E[E["F"] = E.D] = "F"')
    expect(E).toEqual({
      A: 0,
      B: 0,
      C: 1,
      D: 1,
      F: 1,
      0: 'B',
      1: 'F',
    })
  })

  it('expands const enums so untouched use sites keep working', () => {
    // Given: a const enum with a use site that the tool never rewrites
    const input = 'const enum CE { A, B = A + 3 }\nconst use = CE.B;'
    // When: transpiled and evaluated
    const output = transpile(input)
    const use = new Function(`${output}; return use;`)()
    // Then: the enum object exists and the use site resolves
    expect(use).toBe(3)
  })

  it('expands exported enums under their export keyword', () => {
    // Given: an exported enum
    const input = 'export enum Ex { A }'
    // When: transpiled
    const output = transpile(input)
    // Then: the export keyword is kept and the enum is expanded
    expect(output).toBe(
      'export var  Ex; (function (Ex) { Ex[Ex["A"] = 0] = "A" })(Ex || (Ex = {}));',
    )
    const Ex = new Function(
      `${output.replace('export ', '')}; return Ex;`,
    )()
    expect(Ex).toEqual({ A: 0, 0: 'A' })
  })

  it('erases exported overload signatures with the whole statement', () => {
    // Given: an exported overload signature — oxc wraps it as an
    // ExportNamedDeclaration around a bodyless TSDeclareFunction
    const input = 'export function f(): void;\nexport declare function g(): void;\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the `export` keyword does not survive erasure
    expect(output).toEqual(tsBlankSpace(input))
    expect(output.startsWith(`${' '.repeat(26)}\n`)).toBe(true)
    expect(parseSync('input.js', output).errors).toEqual([])
  })

  it('erases default-exported overload signatures with the whole statement', () => {
    // Given: a default-exported overload signature
    const input = 'export default function f(): void;'
    // When: transpiled
    const output = transpile(input)
    // Then: the `export default` keyword does not survive erasure
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toBe(' '.repeat(input.length))
  })

  it('produces output that parses as valid JavaScript', () => {
    // Given: a mixed bag of erasable TypeScript
    const input = [
      'interface I { a: string }',
      'type T = I | null;',
      'export class C implements I {',
      '  x!: string;',
      '  m(a: number): number { return a as number; }',
      '}',
      'const c = new C<string>();//',
      '',
    ].join('\n')
    // When: transpiled and re-parsed as plain JS
    const output = transpile(input)
    const parsed = parseSync('input.js', output)
    // Then: oxc parses it as JavaScript without errors
    expect(output).toEqual(tsBlankSpace(input))
    expect(parsed.errors).toEqual([])
    expect(output.length).toBe(input.length)
  })
})
