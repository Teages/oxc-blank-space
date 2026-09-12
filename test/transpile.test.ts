import { parseSync } from 'oxc-parser'
import tsBlankSpace from 'ts-blank-space'
import { describe, expect, it } from 'vitest'
import { transpile } from './parity'

describe('transpile', () => {
  it('blanks a type annotation while preserving positions', () => {
    const input = 'const a: number = 1'
    const output = transpile(input)
    expect(output).toBe('const a         = 1')
    expect(output).toEqual(tsBlankSpace(input))
    expect(output.length).toBe(input.length)
  })

  it('keeps every line and column of untouched code stable', () => {
    const input = [
      'function greet(name: string): string {',
      '  return `hi ${name}`;',
      '}',
      '',
    ].join('\n')
    const output = transpile(input)
    expect(output.length).toBe(input.length)
    expect(output.split('\n').length).toBe(input.split('\n').length)
    expect(output).toContain('return `hi ${name}`;')
  })

  it('keeps CR/LF when blanking and replaces U+2028/U+2029 with spaces', () => {
    // pinned: blanked regions keep CR/LF as line breaks; U+2028/U+2029 become
    // single spaces like any other character, matching the reference
    const cases = [
      ['\r\n', true],
      ['\r', true],
      ['\u2028', false],
      ['\u2029', false],
    ] as const
    for (const [separator, preserved] of cases) {
      const input = `type T${separator}= 'x';\nconst after = 1;\n`
      const output = transpile(input)
      expect(output).toEqual(tsBlankSpace(input))
      expect(output.length).toBe(input.length)
      expect(output.includes(separator)).toBe(preserved)
    }
  })

  it('applies the pinned line-terminator behavior on the UTF-16 path', () => {
    // the pinned CR/LF vs U+2028/U+2029 behavior must not differ on the UTF-16 path
    const surrogate = String.fromCharCode(0xD800)
    const cases = [
      ['\r\n', true],
      ['\r', true],
      ['\u2028', false],
      ['\u2029', false],
    ] as const
    for (const [separator, preserved] of cases) {
      const input = `type T${separator}= 'x';\nconst y = '${surrogate}';\n`
      const output = transpile(input)
      expect(output.length).toBe(input.length)
      expect(output.includes(separator)).toBe(preserved)
      expect(output).toContain(surrogate)
      expect(output.endsWith(`const y = '${surrogate}';\n`)).toBe(true)
    }
  })

  it('erases interfaces and type aliases as blank statements', () => {
    const input
      = 'interface Foo {\n  a: string;\n}\ntype Bar = Foo | null;\nconst x = 1;\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output.trim()).toBe('const x = 1;')
    expect(output.length).toBe(input.length)
  })

  it('erases `as` and `satisfies` expressions and non-null assertions', () => {
    const input
      = 'const a = b as C;\nconst d = e satisfies F;\nconst g = h!.i;\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).not.toContain('as')
    expect(output).not.toContain('satisfies')
    expect(output).not.toContain('!')
  })

  it('erases generic type arguments and parameters', () => {
    const input = [
      'function f<T>(x: T): T { return x }',
      'const a = new Set<string>()',
      'const b = f<number>(1)',
      'class C<K> extends Array<K> { m(): void {} }',
      '',
    ].join('\n')
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).not.toContain('<')
    expect(output).not.toContain('>')
  })

  it('erases type-only imports and exports', () => {
    const input = [
      'import type A from "a";',
      'import { type B, c } from "b";',
      'import d, { type E } from "c";',
      'export type F = 1;',
      'export { type G, h } from "d";',
      'export const i = 1;',
      '',
    ].join('\n')
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toContain('import {         c } from "b"')
    expect(output).toContain('import d, {        } from "c"')
    expect(output).toContain('export {         h } from "d"')
    expect(output).toContain('export const i = 1;')
  })

  it('erases declare statements and ambient declarations', () => {
    const input
      = 'declare const a: number;\ndeclare function f(): void;\ndeclare class C {}\ndeclare enum E {}\ndeclare module "m" {}\ndeclare global { }\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output.trim()).toBe('')
  })

  it('erases class member type syntax but keeps runtime modifiers', () => {
    const input = [
      'class C {',
      '  readonly x = 1;',
      '  private static y!: string;',
      '  declare z: any;',
      '  constructor(private a: string, b?: number) {}',
      '}',
      '',
    ].join('\n')
    const output = transpile(input)
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
    const input
      = 'namespace N {\n  export interface I {}\n}\nconst after = 1;\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output.trim()).toBe('const after = 1;')
  })

  it('adds ASI protection for statements after blanked syntax', () => {
    const input = 'const a = b\ntype X = number\n(f())()\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toContain('\n;')
    expect(output.length).toBe(input.length)
  })

  it('handles arrow functions whose return type spans lines', () => {
    const input = '[1].map((v)\n:number[\n]=>[v]);\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toBe('[1].map((v \n        \n)=>[v]);\n')
  })

  it('moves the closing paren for arrows with multiline parameter lists', () => {
    const input
      = 'export const f = (\n    a: string,\n): number | undefined => list.pop();\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toContain(') => list.pop();')
    expect(output.length).toBe(input.length)
  })

  it('moves the opening paren when generic parameters span lines', () => {
    const input = 'function f<\n  T\n>(\n  a: T\n) {}\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
  })

  it('erases catch clause parameter annotations', () => {
    const input = 'try {} catch (e: unknown) { }\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toContain('catch (e         ) { }')
    expect(output.length).toBe(input.length)
  })

  it('erases this parameters and optional markers', () => {
    const input
      = 'class C { m?(a): void; }\nfunction f(this: Window, x?: string) {}\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
  })

  it('supports tsx parsing via the lang option', () => {
    const input = 'const elm = <div>{x as string}</div>;\n'
    const output = transpile(input, { lang: 'tsx' })
    // the reference tool's default entry always parses as plain .ts, so only
    // the position/length invariants are compared here
    expect(output).toBe('const elm = <div>{x          }</div>;\n')
    expect(output.length).toBe(input.length)
  })

  it('throws a SyntaxError on input oxc cannot parse', () => {
    const input = 'let x: = 1'
    expect(() => transpile(input)).toThrow(SyntaxError)
    expect(() => transpile(input)).toThrow(/input\.ts/)
  })

  it('labels parse diagnostics with the provided filename', () => {
    const input = 'let x: = 1'
    expect(() => transpile(input, { filename: 'src/app.ts' })).toThrow(
      /src\/app\.ts/,
    )
  })

  it('infers tsx parsing from a .tsx filename', () => {
    const input = 'const elm = <div>{x as string}</div>;\n'
    const output = transpile(input, { filename: 'component.tsx' })
    expect(output).toBe('const elm = <div>{x          }</div>;\n')
    expect(output.length).toBe(input.length)
  })

  it('throws on grouping-unsafe assertions like TypeScript does', () => {
    // a TypeScript#63527 case — invalid to both TypeScript and oxc, so it never reaches the erasure logic
    const input = 'const x = 1 + 1 as T / 2'
    // the parse failure surfaces as a SyntaxError instead of a silent passthrough
    expect(() => transpile(input)).toThrow(SyntaxError)
  })

  it('throws on unparseable input even when other statements are valid', () => {
    const input = 'const a = 1 as T;\nlet y: = 2;\nconst b = 2 as U;\n'
    expect(() => transpile(input)).toThrow(SyntaxError)
  })

  it('erases safe assertions without wrapping', () => {
    const input = 'const x = a as T + 2'
    const output = transpile(input)
    expect(output).toBe('const x = a      + 2')
    expect(output.length).toBe(input.length)
  })

  it('expands runtime enums into TypeScript-compiler-shaped IIFEs', () => {
    const input = 'enum Color { Red, Green = 5, Blue }'
    const output = transpile(input)
    const Color = new Function(`${output}; return Color;`)()
    // forward and reverse mappings match the TypeScript emitter
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
    const input = 'enum S { A = "x", B = "y" }'
    const output = transpile(input)
    const S = new Function(`${output}; return S;`)()
    // plain property assignments, matching the TypeScript emitter
    expect(output).toBe(
      'var  S; (function (S) { S["A"] = "x"; S["B"] = "y" })(S || (S = {}));',
    )
    expect(S).toEqual({ A: 'x', B: 'y' })
  })

  it('resolves member references inside enum initializers', () => {
    const input = 'enum E { A, B = A, C = B + 1, D = "d".length, F = D }'
    const output = transpile(input)
    const E = new Function(`${output}; return E;`)()
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
    const input = 'const enum CE { A, B = A + 3 }\nconst use = CE.B;'
    const output = transpile(input)
    const use = new Function(`${output}; return use;`)()
    expect(use).toBe(3)
  })

  it('expands exported enums under their export keyword', () => {
    const input = 'export enum Ex { A }'
    const output = transpile(input)
    expect(output).toBe(
      'export var  Ex; (function (Ex) { Ex[Ex["A"] = 0] = "A" })(Ex || (Ex = {}));',
    )
    const Ex = new Function(
      `${output.replace('export ', '')}; return Ex;`,
    )()
    expect(Ex).toEqual({ A: 0, 0: 'A' })
  })

  it('erases exported overload signatures with the whole statement', () => {
    // oxc wraps an exported overload as ExportNamedDeclaration around a bodyless TSDeclareFunction
    const input = 'export function f(): void;\nexport declare function g(): void;\n'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output.startsWith(`${' '.repeat(26)}\n`)).toBe(true)
    expect(parseSync('input.js', output).errors).toEqual([])
  })

  it('erases default-exported overload signatures with the whole statement', () => {
    const input = 'export default function f(): void;'
    const output = transpile(input)
    expect(output).toEqual(tsBlankSpace(input))
    expect(output).toBe(' '.repeat(input.length))
  })

  it('produces output that parses as valid JavaScript', () => {
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
    const output = transpile(input)
    const parsed = parseSync('input.js', output)
    expect(output).toEqual(tsBlankSpace(input))
    expect(parsed.errors).toEqual([])
    expect(output.length).toBe(input.length)
  })
})
