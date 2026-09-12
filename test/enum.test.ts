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
    const input = `enum E { A = ${expr} }`
    const output = transpile(input)
    expect(output).toContain(`E[E["A"] = ${expected}] = "A"`)
    expect(evalEnum(input).A).toBe(expected)
  })

  it.each([
    ['-5', -5],
    ['+5', 5],
    ['~5', -6],
  ])('folds unary constant `%s` to %i', (expr, expected) => {
    const input = `enum E { A = ${expr} }`
    const output = transpile(input)
    expect(output).toContain(`E[E["A"] = ${expected}] = "A"`)
    expect(evalEnum(input).A).toBe(expected)
  })

  it('keeps unary and binary initializers the folder cannot compute', () => {
    const inputs = [
      'enum E { A = -X }',
      'enum E { A = !5 }',
      'enum E { A = {} instanceof Object }',
      'enum E { A = 1 < 2 }',
    ]
    for (const input of inputs) {
      const output = transpile(input)
      const expr = input.slice(input.indexOf('= ') + 2, -1).trim()
      expect(output).toContain(`E[E["A"] = ${expr}] = "A"`)
    }
  })

  it('folds parenthesized constants', () => {
    const input = 'enum E { A = (2 + 3) }'
    const output = transpile(input)
    expect(output).toContain('E[E["A"] = 5] = "A"')
  })

  it('folds references to earlier constant members', () => {
    const input = 'enum E { A = 5, B = A + 1 }'
    const output = transpile(input)
    expect(output).toContain('E[E["B"] = 6] = "B"')
    expect(evalEnum(input).B).toBe(6)
  })

  it('keeps unbound global references as runtime reads', () => {
    // a name no scope binds (a global function) — nothing folds it, the reference must stay bare
    const input = 'enum E { B = g(3) }'
    const output = transpile(input)
    expect(output).toContain('E[E["B"] = g(3)] = "B"')
  })

  it('keeps reference-free non-constant initializers verbatim', () => {
    // no bare references, yet not foldable — the self-contained path emits it with no scope model
    const input = 'enum E { B = [1, 2] }'
    const output = transpile(input)
    expect(output).toContain('E[E["B"] = [1, 2]] = "B"')
    expect(evalEnum(input).B).toEqual([1, 2])
  })

  it.each([
    ['"x" + f()', 'x1'],
    ['f() + "x"', '1x'],
    ['("x") + f()', 'x1'],
    ['f() + ("x")', '1x'],
    ['`t` + "x" + f()', 'tx1'],
  ])('emits runtime concatenation %s without reverse mapping', (initializer, expected) => {
    const input = `enum E { B = ${initializer} }`
    const output = transpile(input)
    // plain assignment shape — no reverse mapping over the runtime string
    expect(output).toContain(`E["B"] = ${initializer}`)
    expect(output).not.toContain('] = "B"')
    expect(evalEnum(input, () => 1).B).toBe(expected)
    // and no reverse entry lands on the runtime value
    expect(Reflect.has(evalEnum(input, () => 1), expected)).toBe(false)
  })

  it.each([
    [
      're-queues a merged declaration when an earlier member lands later',
      [
        'function f() {',
        '  enum E { A = F.X }',
        '  enum E { B = A, C }',
        '  return E',
        '}',
        'enum F { X = 1 }',
      ].join('\n'),
      'return f().C',
      2,
    ],
    [
      'propagates cached const dependencies to later readers',
      [
        'function f() {',
        '  const x = F.X',
        '  enum A { X = x }',
        '  enum B { X = x, Y }',
        '  return B',
        '}',
        'enum F { X = 1 }',
      ].join('\n'),
      'return f().Y',
      2,
    ],
  ])('%s', (_label, input, expression, expected) => {
    // a member value or const depends on a group declared later in the file — resolution must re-queue the dependent declarations
    const output = transpile(input)
    const result = new Function(`${output}; ${expression};`)()
    expect(result).toBe(expected)
  })

  it('resolves a member name that an outer const also binds', () => {
    // the member binding wins over the outer const of the same name, on both resolution paths
    const input = [
      'const X = 100',
      'enum E { X = 1, Y = X + 1 }',
    ].join('\n')
    const output = transpile(input)
    expect(output).toContain('E[E["Y"] = 2] = "Y"')
    expect(evalEnum(input).Y).toBe(2)
  })

  it('keeps non-constant initializers verbatim and qualifies references', () => {
    const input = 'enum E { A = 1, B = A + f() }'
    const output = transpile(input)
    expect(output).toContain('E[E["B"] = E.A + f()] = "B"')
    expect(evalEnum(input, () => 1).B).toBe(2)
  })

  it('qualifies member references in computed positions', () => {
    const input = [
      'enum E {',
      '  A = 3,',
      '  B = f({ v: A, [A]: 0 }),',
      '  C = arr[A] + A.toFixed(0) + f(),',
      '  D = [A, 2] + f(),',
      '  G = `${A}` + f(),',
      '}',
    ].join('\n')
    const output = transpile(input)
    expect(output).toContain('f({ v: E.A, [E.A]: 0 })')
    expect(output).toContain('arr[E.A] + E.A.toFixed(0)')
    expect(output).toContain('[E.A, 2]')
    expect(output).toContain('`${E.A}`')
  })

  it('emits `undefined` for auto-increment after a non-constant member', () => {
    // a TypeScript compile error whose emit shape tsc still defines
    const input = 'enum E { A = f(), B, C }'
    const output = transpile(input)
    // both followers mirror tsc's `undefined` emit
    expect(output).toContain('E[E["B"] = undefined] = "B"')
    expect(output).toContain('E[E["C"] = undefined] = "C"')
  })

  it('emits string members without a reverse mapping', () => {
    const input = 'enum E { A = "x", B = "y" }'
    const E = evalEnum(input)
    expect(transpile(input)).toContain('E["A"] = "x"')
    expect(transpile(input)).toContain('E["B"] = "y"')
    expect(E).toEqual({ A: 'x', B: 'y' })
  })

  it('supports quoted string member names', () => {
    const input = 'enum E { "str name" = 1, \'sq\' = 2 }'
    const E = evalEnum(input)
    expect(transpile(input)).toContain('E["str name"] = 1')
    expect(transpile(input)).toContain('E["sq"] = 2')
    expect(E['str name']).toBe(1)
    expect(E.sq).toBe(2)
  })

  it('keeps a self-referencing initializer bare like tsc', () => {
    const input = 'enum E { A = A }'
    const output = transpile(input)
    expect(output).toContain('E[E["A"] = A] = "A"')
  })

  it('erases type assertions in constant initializers like tsc', () => {
    const input = 'enum E { A = (1 as number) }'
    const output = transpile(input)
    // tsc erases it and folds the member to `E[E["A"] = 1] = "A"`; the output stays executable
    expect(output).not.toContain('as')
    expect(evalEnum(input).A).toBe(1)
  })

  it('erases type-only syntax in non-constant initializers', () => {
    const input = 'enum E { A = f() as number }'
    const output = transpile(input)
    // tsc emits `E[E["A"] = f()] = "A"` — the member evaluates instead of failing to parse
    expect(output).not.toContain('as')
    expect(evalEnum(input, () => 1).A).toBe(1)
  })

  it.each([
    ['an arrow parameter', 'enum E { A = 1, B = ((A) => A)(2) }', 2],
    ['a function parameter', 'enum E { A = 1, B = (function (A) { return A })(3) }', 3],
    ['a local declaration', 'enum E { A = 1, B = (() => { var A = 5; return A })() }', 5],
  ])('leaves %s shadowing a member name unqualified', (_label, input, expected) => {
    // valid TypeScript; tsc emits the reference unqualified — it resolves to
    // the local binding, not the enum member
    expect(evalEnum(input).B).toBe(expected)
  })

  it('still qualifies unshadowed references next to shadowed ones', () => {
    const input = 'enum E { A = 1, B = ((A) => A)(2) + A }'
    // only the unshadowed reference qualifies (tsc emits `E[E["B"] = ((A) => A)(2) + E.A] = "B"`)
    expect(evalEnum(input).B).toBe(3)
  })

  it('keeps scope information through nested value positions', () => {
    // the member-access walk must not start from an empty scope stack
    const input = 'enum E { A = 1, B = ((A) => A.x)({ x: 2 }) }'
    // the shadowed reference stays unqualified — tsc emits `((A) => A.x)`, so B is 2
    expect(transpile(input)).toContain('((A) => A.x)')
    expect(evalEnum(input).B).toBe(2)
  })

  it('never rewrites references inside erased type declarations', () => {
    // rewriting the erased declaration's names would splice member text back into erased content
    const input
      = 'enum E {\n  A = 1,\n  B = (() => { type T = [typeof A, typeof A]; return 2; })()\n}'
    expect(transpile(input)).not.toContain('typeof')
    expect(transpile(input)).not.toContain('E.A')
    expect(evalEnum(input).B).toBe(2)
  })

  it('does not let a block-scoped declaration shadow the whole body', () => {
    const input = 'enum E { A = 1, B = (() => { { let A = 2; } return A; })() }'
    // the outer reference resolves to the member — tsc emits `return E.A`
    expect(transpile(input)).toContain('return E.A;')
    expect(evalEnum(input).B).toBe(1)
  })

  it('hoists var declarations to the function scope like tsc', () => {
    const input = 'enum E { A = 1, B = (() => { { var A = 2; } return A; })() }'
    // the hoisted var shadows the member for the whole body (tsc leaves `return A` unqualified)
    expect(transpile(input)).toContain('return A;')
    expect(evalEnum(input).B).toBe(2)
  })

  it('binds function declarations in their enclosing scope', () => {
    // the declaration binds in the enclosing scope; the walk must not descend into the function's own bindings
    const input = 'enum E { f = 1, B = (() => { function f() { return 9 } return f() })() }'
    // the call resolves to the local function — tsc leaves `f()` unqualified
    expect(transpile(input)).toContain('return f()')
    expect(evalEnum(input).B).toBe(9)
  })

  it('propagates string members through qualified references', () => {
    const input = 'enum E { A = "a", B = E.A }'
    // tsc folds it to a plain assignment — the reverse-mapping shape would add a bogus `"a": "B"` key
    expect(transpile(input)).not.toContain('E[E["B"]')
    expect(evalEnum(input)).toEqual({ A: 'a', B: 'a' })
  })

  it('propagates string members through computed references', () => {
    const input = 'enum E { A = "a", B = E["A"] }'
    expect(transpile(input)).not.toContain('E[E["B"]')
    expect(evalEnum(input)).toEqual({ A: 'a', B: 'a' })
  })

  it('folds mixed string/number concatenations like tsc', () => {
    const inputs = [
      ['enum E { A = "a", B = A + 1 }', 'a1'],
      ['enum E { A = "a", B = 1 + A }', '1a'],
      ['enum E { A = "a", B = "n" + 1 + A }', 'n1a'],
    ] as const
    for (const [input, expected] of inputs) {
      expect(transpile(input)).not.toContain('E[E["B"]')
      expect(evalEnum(input)).toEqual({ A: 'a', B: expected })
    }
  })

  it('binds declarations written directly in switch case clauses', () => {
    // all clauses of a switch share one block scope — the reference from a later statement resolves to it
    const input
      = 'enum E { A = 1, B = (() => { switch (2) { case 2: let A = 10; return A; } return 0; })() }'
    expect(transpile(input)).toContain('return A;')
    expect(evalEnum(input).B).toBe(10)
  })

  it('binds function declarations in switch case clauses', () => {
    const input
      = 'enum E { f = 1, B = (() => { switch (2) { case 2: function f() { return 9 } return f() } return 0 })() }'
    expect(transpile(input)).toContain('return f()')
    expect(evalEnum(input).B).toBe(9)
  })

  it('qualifies the switch discriminant in the enclosing scope', () => {
    const input
      = 'enum E { A = 1, B = (() => { switch (A) { case 9: let A = 5; return A; } return 0 })() }'
    // the discriminant is qualified (tsc emits `switch (E.A)`), the case reference is not
    expect(transpile(input)).toContain('switch (E.A)')
    expect(transpile(input)).toContain('return A;')
    expect(evalEnum(input).B).toBe(0)
  })

  it('propagates string member references without a reverse mapping', () => {
    const input = 'enum E { A = "a", B = A }'
    const output = transpile(input)
    // string value — the reverse-mapping shape must not be emitted (a bogus `"a": "B"` key)
    expect(output).not.toContain('E[E["B"]')
    expect(evalEnum(input)).toEqual({ A: 'a', B: 'a' })
  })

  it('propagates string member references inside larger initializers', () => {
    const input = 'enum E { A = "a", B = "x" + A }'
    // B is the string value; no reverse mapping may run over it
    expect(evalEnum(input)).toEqual({ A: 'a', B: 'xa' })
  })

  /** Evaluate the transpiled output and return one enum by name. */
  const evalNamed = (
    input: string,
    name: string,
    f?: (name: string) => unknown,
  ): Record<string | number, unknown> => {
    const output = transpile(input)
    return new Function('f', `${output}; return ${name};`)(f)
  }

  it('propagates members across merged enum declarations', () => {
    // TypeScript merges same-name declarations — the later folds `B = A` to A's value; auto-increment restarts per declaration
    const input = 'enum Foo { A = 7 }\nenum Foo { B = A, C }\n'
    expect(transpile(input)).toContain('Foo[Foo["B"] = 7] = "B"')
    expect(transpile(input)).toContain('Foo[Foo["C"] = 8] = "C"')
  })

  it('qualifies merged-declaration references to the runtime binding', () => {
    const input = 'enum Foo { A = f() }\nenum Foo { B = A }\n'
    // tsc emits `Foo[Foo["B"] = Foo.A] = "B"` — B is 3, not an outer `A` binding
    expect(transpile(input)).toContain('Foo[Foo["B"] = Foo.A] = "B"')
    expect(evalEnum(input, () => 3).B).toBe(3)
  })

  it('restarts auto-increment at 0 in each merged declaration', () => {
    const input = 'enum Foo { A = "s" }\nenum Foo { B }\n'
    expect(transpile(input)).toContain('Foo[Foo["B"] = 0] = "B"')
  })

  it('folds string members through template literals like tsc', () => {
    const input = [
      'enum Size { SMALL = "tiny", LARGE = "big" }',
      'enum Animal { CAT = "meow", DOG = "woof" }',
      'enum Z { SMALL_CAT = `${Size.SMALL}_${Animal.CAT}`, LARGE_DOG = `${Size.LARGE}_${Animal.DOG}` }',
    ].join('\n')
    expect(transpile(input)).not.toContain('Z[Z[')
    const Z = evalNamed(input, 'Z')
    expect(Z.SMALL_CAT).toBe('tiny_meow')
    expect(Z.LARGE_DOG).toBe('big_woof')
  })

  it('folds numeric members through template literals like tsc', () => {
    const input = [
      'enum N { A = 1, B = 2 }',
      'enum Z { C = `prefix-${N.A}-middle-${N.B}-suffix`, D = `${N.A}-suffix` }',
    ].join('\n')
    const Z = evalNamed(input, 'Z')
    expect(Z.C).toBe('prefix-1-middle-2-suffix')
    expect(Z.D).toBe('1-suffix')
  })

  it('keeps nested enum members scoped to their own declaration', () => {
    const input
      = 'enum Outer { A = 5, B = (() => { enum Inner { A = 99, B = A } return Inner.B })() }'
    expect(evalNamed(input, 'Outer').B).toBe(99)
  })

  it('emits `undefined` for auto-increment after a string member like tsc', () => {
    // oxc's transformer emits `1 + E.A` here; tsc emits `void 0`, which we pin
    const input = 'enum E { A = "x", B }'
    expect(transpile(input)).toContain('E[E["B"] = undefined] = "B"')
    expect(evalEnum(input).B).toBeUndefined()
  })

  it('isolates the merged-declaration cache between scopes', () => {
    // same-name enums in different scopes do NOT merge — g's `B = A` must resolve to g's own non-constant member, not fold through f's
    const input = [
      'function f() { enum E { A = 1 } }',
      'function g() { enum E { A = foo(), B = A } return E.B }',
      'function foo() { return 9 }',
      'const out = g();',
    ].join('\n')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('hoists var from nested blocks inside static blocks', () => {
    const input
      = 'enum E { A = 1, B = (() => { class C { static x = 0; static { { var A = 2 } C.x = A } } return C.x })() }'
    expect(transpile(input)).not.toContain('C.x = E.A')
    expect(evalNamed(input, 'E').B).toBe(2)
  })

  it('normalizes CRLF and CR inside template literals like tsc', () => {
    // template cooked values normalize literal <CRLF>/<CR> to <LF>; an escaped `\r` stays CR
    const input = 'enum E { A = `a\r\nb`, B = `c\rd` }'
    const E = evalNamed(input, 'E')
    expect(E.A).toBe('a\nb')
    expect(E.B).toBe('c\nd')
    const escaped = 'enum E { A = `a\\rb` }'
    expect((evalNamed(escaped, 'E').A as string).includes('\r')).toBe(true)
  })

  it('resolves member references through outer enums', () => {
    // the scope-chain lookup finds outer enums innermost first — same-name enums shadow by depth
    const input = [
      'enum E { A = "a" }',
      'function f() { enum F { B = E.A } return F }',
      'const out = f();',
    ].join('\n')
    expect(transpile(input)).not.toContain('F[F[')
    expect(evalNamed(input, 'out')).toEqual({ B: 'a' })
  })

  it('shadows outer enums with an inner declaration of the same name', () => {
    const input = [
      'enum E { A = "outer" }',
      'function f() {',
      '  enum E { A = "inner" }',
      '  function g() { enum G { B = E.A } return G.B }',
      '  return g();',
      '}',
      'const out = f();',
    ].join('\n')
    expect(evalNamed(input, 'out')).toBe('inner')
  })

  it('emits `let` for enums inside blocks, keeping shadowing intact', () => {
    // `var` would hoist and clobber the outer binding — tsc emits `let` everywhere but program scope
    const input = 'enum E { A = 1 }\n{ enum E { A = 2 } }\nconst out = E.A;'
    expect(transpile(input)).toContain('{ let ')
    expect(evalNamed(input, 'out')).toBe(1)
  })

  it('exports a merged enum exactly once', () => {
    // a second `export var E` would make the module fail to load
    const input = 'export enum E { A = 1 }\nexport enum E { B = 2 }\n'
    const output = transpile(input)
    expect(output.match(/export /g)).toHaveLength(1)
    const E = new Function(`${output.replace(/export /g, '')}; return E;`)()
    expect(E).toEqual({ A: 1, B: 2, 1: 'A', 2: 'B' })
  })

  it('separates a merged later declaration from the previous statement', () => {
    // without a leading `;` the emitted `(function ...)` continues a semicolon-less statement as a call (`1(function ...)`, as tested above)
    const input = 'enum E { A = 1 }\nconst x = 1\nenum E { B = 2 }\n'
    const output = transpile(input)
    const E = new Function(`${output}; return E;`)()
    expect(output.match(/; \(function/g)).toHaveLength(2)
    expect(E).toEqual({ A: 1, B: 2, 1: 'A', 2: 'B' })
  })

  it('separates a merged later declaration inside a function body', () => {
    const input = [
      'function f() {',
      '  enum E { A = 1 }',
      '  const x = 1',
      '  enum E { B = 2 }',
      '  return E',
      '}',
      'const out = f();',
    ].join('\n')
    expect(evalNamed(input, 'out')).toEqual({ A: 1, B: 2, 1: 'A', 2: 'B' })
  })

  it('separates an exported merged later declaration', () => {
    const input = 'export enum E { A = 1 }\nconst x = 1\nexport enum E { B = 2 }\n'
    const output = transpile(input)
    expect(output.match(/export /g)).toHaveLength(1)
    expect(output.match(/; \(function/g)).toHaveLength(2)
    const E = new Function(`${output.replace(/export /g, '')}; return E;`)()
    expect(E).toEqual({ A: 1, B: 2, 1: 'A', 2: 'B' })
  })

  it('folds references to ambient enum members like tsc', () => {
    // an ambient enum emits no runtime code, but TypeScript still folds references through it — the emitted F must never reference E at runtime
    const input = 'declare enum E { A = "x" }\nenum F { B = E.A }\n'
    const output = transpile(input)
    const F = new Function(`${output}; return F;`)()
    expect(F).toEqual({ B: 'x' })
    expect(output).not.toContain('E')
  })

  it('folds numeric references to ambient enum members', () => {
    const input = 'declare enum N { A = 5 }\nenum F { B = N.A }\n'
    const output = transpile(input)
    expect(output).toContain('F[F["B"] = 5] = "B"')
    expect(output).not.toContain('N')
  })

  it('folds through ambient members of a merged group without emitting them', () => {
    // ambient members join the constant table (tsc folds `B = A` to 7); only the real declaration's members reach the runtime object
    const input = 'declare enum E { A = 7 }\nenum E { B = A }\n'
    const output = transpile(input)
    const E = new Function(`${output}; return E;`)()
    expect(output).toContain('E[E["B"] = 7] = "B"')
    expect(E).toEqual({ B: 7, 7: 'B' })
  })

  it('keeps enum declarations inside static blocks as block bindings', () => {
    // like any block binding it shadows the member within the static block (tsc emits `A.X` bare)
    const input = [
      'enum E {',
      '  A = 1,',
      '  B = (() => {',
      '    class C {',
      '      static value = 0',
      '      static {',
      '        enum A { X = 2 }',
      '        C.value = A.X',
      '      }',
      '    }',
      '    return C.value',
      '  })()',
      '}',
    ].join('\n')
    expect(transpile(input)).toContain('C.value = A.X')
    expect(evalNamed(input, 'E').B).toBe(2)
  })

  it('does not auto-increment uninitialized members of ambient enums', () => {
    // an uninitialized member of a plain ambient enum is not a compile-time constant — the ambient
    // object exists at runtime elsewhere; tsc keeps the runtime read instead of folding
    const input = 'declare enum E { A = 5, B }\nenum F { C = E.B }\n'
    const output = transpile(input)
    const F = new Function('E', `${output}; return F;`)({ A: 5, B: 9 })
    expect(output).toContain('F[F["C"] = E.B] = "C"')
    expect(F.C).toBe(9)
  })

  it('auto-increments uninitialized members of ambient const enums', () => {
    // an ambient *const* enum inlines every member — an uninitialized member folds to previous + 1
    const input = 'declare const enum E { A = 5, B }\nenum F { C = E.B }\n'
    expect(transpile(input)).toContain('F[F["C"] = 6] = "C"')
  })

  it('resolves member references through chains of later-declared enums', () => {
    // forward chain (F.A → E.B → G.C) declared later in the file: single-pass collection
    // cannot fold F.A; tsc resolves the whole chain before emitting
    const input = [
      'function outer() {',
      '  function f() {',
      '    enum F { A = E.B }',
      '    return F',
      '  }',
      '  enum E { B = G.C }',
      '  return f()',
      '}',
      'enum G { C = "s" }',
      'const result = outer()',
    ].join('\n')
    expect(transpile(input)).toContain('F["A"] = "s"')
    expect(evalNamed(input, 'result')).toEqual({ A: 's' })
  })

  it('resolves numeric references through chains of later-declared enums', () => {
    const input = [
      'function outer() {',
      '  function f() {',
      '    enum F { A = E.B }',
      '    return F',
      '  }',
      '  enum E { B = G.C }',
      '  return f()',
      '}',
      'enum G { C = 5 }',
      'const result = outer()',
    ].join('\n')
    expect(transpile(input)).toContain('F[F["A"] = 5] = "A"')
    expect(evalNamed(input, 'result')).toEqual({ A: 5, 5: 'A' })
  })

  it('folds references to const constants like tsc', () => {
    // the checker treats a literal `const` as a compile-time constant — the reference folds and auto-increment continues from it
    const input = 'const x = 5\nenum E { A = x, B }\n'
    expect(transpile(input)).toContain('E[E["A"] = 5] = "A"')
    expect(transpile(input)).toContain('E[E["B"] = 6] = "B"')
    expect(evalEnum(input).B).toBe(6)
  })

  it('folds const string constants without a reverse mapping', () => {
    // a string `const`'s type is a string literal — tsc emits the plain assignment shape
    const input = 'const x = "s"\nenum E { A = x }\n'
    expect(transpile(input)).toContain('E["A"] = "s"')
    expect(evalEnum(input)).toEqual({ A: 's' })
  })

  it('folds const constants referencing enum members', () => {
    // the chain folds through the const: const → enum member → later enum
    const input = [
      'enum E { A = 5 }',
      'const y = E.A',
      'enum F { B = y }',
    ].join('\n')
    expect(transpile(input)).toContain('F[F["B"] = 5] = "B"')
  })

  it('reads let bindings at runtime instead of folding', () => {
    // reassignable bindings are not compile-time constants; an inner `let` shadowing an outer `const` must win along the scope chain
    const shadow = [
      'const x = 5',
      'function f() { let x = 9; enum E { A = x } return E.A }',
      'const out = f()',
    ].join('\n')
    expect(transpile(shadow)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(shadow, 'out')).toBe(9)
  })

  it('emits the numeric reverse mapping for asserted string members', () => {
    // the value still folds, but the asserted type is not a string literal — value and
    // shape are independent decisions (tsc emits the reverse-mapping shape)
    const input = 'enum E { A = ("s" as any) }\n'
    expect(transpile(input)).toContain('E[E["A"] = "s"] = "A"')
    expect(evalEnum(input)).toEqual({ A: 's', s: 'A' })
  })

  it.each([
    ['a member reference', 'enum E { A = "a", B = A!, C = B }', { A: 'a', B: 'a', C: 'a', a: 'C' }],
    ['a numeric member reference', 'enum E { A = 1, B = A! }', { A: 1, B: 1, 1: 'B' }],
    ['an enum-object reference', 'enum E { A = "a", B = E.A! }', { A: 'a', B: 'a', a: 'B' }],
    ['a computed enum-object reference', 'enum E { A = "a", B = E["A"]! }', { A: 'a', B: 'a', a: 'B' }],
    ['a parenthesized reference', 'enum E { A = "a", B = (A)! }', { A: 'a', B: 'a', a: 'B' }],
    ['a string literal', 'enum E { B = "x"! }', { B: 'x', x: 'B' }],
    ['a template literal', 'enum E { B = `t`! }', { B: 't', t: 'B' }],
  ])('keeps %s under a non-null assertion as a runtime read', (_label, input, expected) => {
    // tsc reports TS18033 on these inputs and keeps the runtime read
    const output = transpile(input)
    expect(output).not.toContain('E["B"] = "a"')
    expect(evalEnum(input)).toEqual(expected)
  })

  it.each([
    ['(("x") as any)', { B: 'x', x: 'B' }],
    ['(1) as any', { B: 1, 1: 'B' }],
  ])('keeps a parenthesized operand under an assertion as a runtime read (%s)', (initializer, expected) => {
    // legal TypeScript where tsc keeps the runtime read, unlike an assertion over a bare
    // operand (which folds — see tests above)
    const input = `enum E { B = ${initializer} }`
    const output = transpile(input)
    expect(output).not.toContain('E["B"] = "x"')
    expect(evalEnum(input)).toEqual(expected)
  })

  it('keeps runtime reads when referencing non-literal string members', () => {
    // the asserted type is not a literal — the checker does not treat the reference as
    // constant; tsc keeps the runtime read
    const input = 'enum P { S = ("s" as any) }\nenum E { A = P.S }\n'
    expect(transpile(input)).toContain('E[E["A"] = P.S] = "A"')
    expect(evalNamed(input, 'E')).toEqual({ A: 's', s: 'A' })
  })

  it('reads parameters at runtime instead of folding outer consts', () => {
    // parameters are never compile-time constants, and they stop the outer lookup
    const input = [
      'const x = 5',
      'function f(x: number) { enum E { A = x } return E.A }',
      'const out = f(9)',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('reads catch parameters at runtime instead of folding outer consts', () => {
    const input = [
      'const x = 5',
      'function f() { try { throw 9 } catch (x) { enum E { A = x } return E.A } }',
      'const out = f()',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('reads vars hoisted from nested blocks at runtime', () => {
    // a `var` in a nested block hoists to the function — a sibling enum's reference resolves to it, not the outer const
    const input = [
      'const x = 5',
      'function f() { { var x = 9 } enum E { A = x } return E.A }',
      'const out = f()',
    ].join('\n')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('folds the outer const after a for-head binding ends', () => {
    // a for-head `let`'s scope ends with the loop — a later enum's references resolve outward
    const input = 'const x = 5\nfor (let x = 0; x < 1; x++) {}\nenum E { A = x, B }\n'
    expect(transpile(input)).toContain('E[E["A"] = 5] = "A"')
    expect(transpile(input)).toContain('E[E["B"] = 6] = "B"')
  })

  it('stops the outer lookup at consts whose values do not fold', () => {
    // the unresolved inner binding must stop the search instead of falling through to the outer const's value
    const input = [
      'const x = 5',
      'function f() { const x = (() => 9)(); enum E { A = x } return E.A }',
      'const out = f()',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('folds inner alias chains to the inner value', () => {
    // the alias chain resolves to the inner value, not the shadowed outer const
    const input = [
      'const x = 5',
      'function f() {',
      '  const c = 9',
      '  const x = c',
      '  const y = x',
      '  enum E { A = y }',
      '  return E.A',
      '}',
      'const out = f()',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = 9] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('reads type-annotated consts at runtime', () => {
    // the declared type is not a literal — tsc keeps the runtime read (the reverse-mapping
    // shape falls out of the non-folded initializer)
    const input = 'const x: any = "s"\nenum E { A = x }\n'
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'E')).toEqual({ A: 's', s: 'A' })
  })

  it('reads for-head let bindings inside the loop body', () => {
    // inside the loop body the reference resolves to the head binding
    const input = [
      'const x = 5',
      'function f() {',
      '  for (let x = 9; x < 10; x++) {',
      '    enum E { A = x }',
      '    return E.A',
      '  }',
      '}',
      'const out = f()',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('reads vars hoisted out of for heads after the loop', () => {
    // a `var` declared in a for head hoists to the function — a reference after the loop reads it, not the outer const
    const input = [
      'const x = 5',
      'function f() { for (var x = 9; x < 10; x++) {} enum E { A = x } return E.A }',
      'const out = f()',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(10)
  })

  it('reads rest parameters through destructuring', () => {
    // a rest parameter binding through a destructuring pattern shadows the outer const like any parameter
    const input = [
      'const x = 5',
      'function f(...[x]: number[]) { enum E { A = x } return E.A }',
      'const out = f(9)',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('resolves named function expression self-references', () => {
    // inside the body the function expression's own name resolves to the function itself
    const input = [
      'const x = 5',
      'const g = function x() {',
      '  enum E { A = +x }',
      '  return E.A',
      '}',
      'const out = g()',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = +x] = "A"')
    expect(Number.isNaN(evalNamed(input, 'out'))).toBe(true)
  })

  it('resolves named class expression self-references', () => {
    const input = [
      'const x = 5',
      'const C = class x {',
      '  m() { enum E { A = +x } return E.A }',
      '}',
      'const out = new C().m()',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = +x] = "A"')
    expect(Number.isNaN(evalNamed(input, 'out'))).toBe(true)
  })

  it('reads parameters from default-value expressions', () => {
    // defaults evaluate in the parameter environment — the reference resolves to the parameter, not an outer const
    const input = [
      'const x = 5',
      'function f(x: number, y = (() => {',
      '  enum E { A = x }',
      '  return E.A',
      '})()) {',
      '  return y',
      '}',
      'const out = f(9)',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('reads arrow parameters from expression-body initializers', () => {
    const input = [
      'const x = 5',
      'const out = ((x: number, y = (() => {',
      '  enum E { A = x }',
      '  return E.A',
      '})()) => y)(9)',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('ends a headless for scope with the loop', () => {
    const input = [
      'const x = 5',
      'function f() {',
      '  for (let x = 0; x < 1; x++);',
      '  enum E { A = x, B }',
      '  return E.B',
      '}',
      'const out = f()',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = 5] = "A"')
    expect(transpile(input)).toContain('E[E["B"] = 6] = "B"')
    expect(evalNamed(input, 'out')).toBe(6)
  })

  it('reads head bindings from loop-condition expressions', () => {
    // the enum sits in the loop's scope, so the reference reads the head binding (the
    // guard flips on first evaluation, keeping the loop finite)
    const input = [
      'const x = 5',
      'function f() {',
      '  for (let x = 7; (() => { enum E { A = x } return E.A === 7 })() && false; );',
      '  return 0',
      '}',
      'const out = f()',
    ].join('\n')
    // the enum body reads the head binding at runtime, like tsc
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(0)
  })

  it('resolves class expression names in field initializers', () => {
    // field initializers sit in the class scope — the name resolves to the class (+class is NaN)
    const input = [
      'const x = 5',
      'const C = class x {',
      '  static value = (() => {',
      '    enum E { A = +x }',
      '    return E.A',
      '  })()',
      '}',
      'const out = C.value',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = +x] = "A"')
    expect(Number.isNaN(evalNamed(input, 'out'))).toBe(true)
  })

  it('erases catch annotations after visiting the pattern', () => {
    // the pattern sits before the annotation — its edits must land before the erasure
    const input = 'try { throw {} }\ncatch ({ x = 1 as number }: any) {}\n'
    const output = transpile(input)
    expect(output).toContain('catch ({ x = 1')
    expect(() => new Function(output)).not.toThrow()
  })

  it('erases catch annotations after enum members in defaults', () => {
    const input = [
      'try { throw {} }',
      'catch ({ x = (() => { enum E { A = 1 } return E.A })() as number }: any) {}',
    ].join('\n')
    const output = transpile(input)
    expect(() => new Function(output)).not.toThrow()
  })

  it('reads catch parameters from destructuring defaults', () => {
    // the parameter scope covers the defaults (where the pattern binds) and the body alike
    const input = [
      'const x = 5',
      'let result',
      'try { throw { x: 9 } }',
      'catch ({ x, y = (() => {',
      '  enum E { A = x }',
      '  return E.A',
      '})() }) {',
      '  result = y',
      '}',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'result')).toBe(9)
  })

  it('evaluates switch discriminants outside the case scope', () => {
    // the discriminant evaluates before the shared case scope exists — its references
    // resolve in the enclosing scope, not through case bindings
    const input = [
      'const x = 5',
      'let result',
      'switch ((() => {',
      '  enum E { A = x, B }',
      '  result = E.B',
      '  return 0',
      '})()) {',
      '  case 0: let x = 9',
      '}',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = 5] = "A"')
    expect(transpile(input)).toContain('E[E["B"] = 6] = "B"')
    expect(evalNamed(input, 'result')).toBe(6)
  })

  it('does not fall through to outer consts behind string members', () => {
    // the member binds the name — even though the numeric folder cannot use it, the
    // reference must not fall through to an outer const of the same name
    const input = 'const A = 5\nenum E {\n  A = "s",\n  B = A\n}\n'
    expect(evalEnum(input)).toEqual({ A: 's', B: 's' })
  })

  it('does not fall through to outer consts behind uncomputable members', () => {
    const input = 'const A = 5\nenum E {\n  A = (() => 9)(),\n  B = A\n}\n'
    expect(transpile(input)).toContain('E[E["B"] = E.A] = "B"')
    expect(evalEnum(input, () => 9).B).toBe(9)
  })

  it('resolves outer enum members inside nested declarations', () => {
    const input = [
      'const A = 5',
      'enum E {',
      '  A = 9,',
      '  B = ((): number => {',
      '    enum F { C = A }',
      '    return F.C',
      '  })()',
      '}',
    ].join('\n')
    expect(transpile(input)).toContain('F[F["C"] = 9] = "C"')
    expect(evalEnum(input).B).toBe(9)
  })

  it('resolves outer enum members through local consts', () => {
    const input = [
      'const A = 5',
      'enum E {',
      '  A = 9,',
      '  B = ((): number => {',
      '    const x = A',
      '    enum F { C = x }',
      '    return F.C',
      '  })()',
      '}',
    ].join('\n')
    expect(transpile(input)).toContain('F[F["C"] = 9] = "C"')
    expect(evalEnum(input).B).toBe(9)
  })

  it('resolves outer auto-increment members inside nested declarations', () => {
    const input = [
      'enum E {',
      '  A = 9,',
      '  D,',
      '  B = ((): number => {',
      '    enum F { C = D }',
      '    return F.C',
      '  })()',
      '}',
    ].join('\n')
    expect(transpile(input)).toContain('F[F["C"] = 10] = "C"')
    expect(evalEnum(input).B).toBe(10)
  })

  it('qualifies references to outer uncomputable members', () => {
    // the reference qualifies to the outer enum object instead of staying bare — a bare name has no binding at runtime
    const input = [
      'enum E {',
      '  A = f(),',
      '  B = ((): number => {',
      '    enum F { C = A }',
      '    return F.C',
      '  })()',
      '}',
    ].join('\n')
    expect(transpile(input)).toContain('F[F["C"] = E.A] = "C"')
    expect(evalEnum(input, () => 9).B).toBe(9)
  })

  it('emits plain assignments for non-foldable string-typed initializers', () => {
    // a string-typed initializer stays a runtime template in the plain assignment shape —
    // no reverse mapping over its runtime result
    const input = 'function f() { return 1 }\nenum E { B = `x${f()}` }\n'
    expect(transpile(input)).toContain('E["B"] = `x${f()}`')
    expect(evalNamed(input, 'E')).toEqual({ B: 'x1' })
  })

  it('keys string members by their raw units', () => {
    // the parse copy's lossy strings collapse both lone surrogates to U+FFFD — member
    // tables must key on the raw UTF-16 units
    const d800 = String.fromCharCode(0xD800)
    const dbff = String.fromCharCode(0xDBFF)
    const input = `enum E { "${d800}" = 1, "${dbff}" = 2, C = E["${d800}"] }\n`
    expect(evalNamed(input, 'E').C).toBe(1)
  })

  it('resolves named class self-references in heritage expressions', () => {
    // the heritage reference sits in the class name's temporal dead zone — it stays bare
    // and fails with a ReferenceError at runtime, like TypeScript's output
    const input = [
      'enum E {',
      '  A = 1,',
      '  B = (() => {',
      '    try { const C = class A extends (A as any) {} }',
      '    catch (e) { return e instanceof ReferenceError ? 1 : 2 }',
      '    return 3',
      '  })()',
      '}',
    ].join('\n')
    expect(transpile(input)).toContain('extends (A')
    expect(evalNamed(input, 'E').B).toBe(1)
  })

  it('folds references to enums declared later in the file', () => {
    // TypeScript resolves member references with whole-file knowledge
    const input
      = 'export function f() {\n  enum F { B = E.A }\n  return F\n}\nenum E { A = "a" }\nexport const out = f();\n'
    expect(transpile(input)).not.toContain('F[F[')
    const output = transpile(input)
    const out = new Function(`${output.replace(/export /g, '')}; return out;`)()
    expect(out).toEqual({ B: 'a' })
  })

  it('isolates enums declared inside switch and static blocks', () => {
    // both scope their declarations (tsc emits `let`) — neither merges with nor clobbers
    // the outer enum of the same name
    const input = [
      'let captured = 0',
      'enum E { A = 1 }',
      'switch (0) { case 0: enum E { A = 2 } }',
      'class C { static { enum F { A = 3 } captured = F.A } }',
      'const out = E.A;',
    ].join('\n')
    expect(transpile(input)).toContain('let ')
    expect(evalNamed(input, 'E').A).toBe(1)
    expect(evalNamed(input, 'captured')).toBe(3)
  })

  it('leaves shorthand property values untouched like tsc', () => {
    // tsc leaves the shorthand as-is — rewriting the value token would corrupt the key
    // into `{ E.A }`; the explicit `A: A` form does qualify
    const input = [
      'const A = 9;',
      'enum E { A = 1, B = ({ A }).A, C = ({ A: A }).A }',
      'const outB = E.B;',
      'const outC = E.C;',
    ].join('\n')
    expect(transpile(input)).toContain('({ A }).A')
    expect(transpile(input)).toContain('({ A: E.A }).A')
    expect(evalNamed(input, 'outB')).toBe(9)
    expect(evalNamed(input, 'outC')).toBe(1)
  })

  it('collects nested enum declarations as block bindings', () => {
    const input = [
      'enum E {',
      '  A = 1,',
      '  B = (() => {',
      '    enum A { X = 2 }',
      '    return A.X',
      '  })()',
      '}',
    ].join('\n')
    // the reference resolves to the inner enum — tsc emits `return A.X` bare
    expect(transpile(input)).toContain('return A.X')
    expect(evalNamed(input, 'E').B).toBe(2)
  })

  it('keeps lone surrogates lossless through template folding', () => {
    // escaped quasis have a lossy cooked string in the AST; raw ones route the input through the UTF-16 path
    const escaped = 'enum E { A = `\\uD800` }'
    const E = evalNamed(escaped, 'E')
    expect((E.A as string).charCodeAt(0)).toBe(0xD800)
    const raw = `enum E { A = \`${String.fromCharCode(0xD800)}\` }`
    expect((evalNamed(raw, 'E').A as string).charCodeAt(0)).toBe(0xD800)
    expect(transpile(raw)).not.toContain('\uFFFD')
  })
})
