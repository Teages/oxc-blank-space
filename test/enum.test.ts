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

  it('keeps unbound global references as runtime reads', () => {
    // Given: an initializer referencing a name no scope binds (a global
    // function) — nothing folds it, and the reference must stay bare
    const input = 'enum E { B = g(3) }'
    // When: transpiled
    const output = transpile(input)
    // Then: the initializer is kept verbatim in the numeric shape
    expect(output).toContain('E[E["B"] = g(3)] = "B"')
  })

  it('keeps reference-free non-constant initializers verbatim', () => {
    // Given: an initializer with no bare references that still does not
    // fold — the self-contained path emits it without any scope model
    const input = 'enum E { B = [1, 2] }'
    // When: transpiled
    const output = transpile(input)
    // Then: the initializer is kept in the numeric reverse-mapping shape
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
    // Given: a non-folding initializer whose static type is a string (a
    // literal or template operand)
    const input = `enum E { B = ${initializer} }`
    // When: transpiled with a runtime `f`
    const output = transpile(input)
    // Then: the plain assignment shape, no reverse mapping over the
    // runtime string, matching the TypeScript emitter
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
    // When: a member value or const depends on a group declared later in
    // the file — resolution must re-queue the dependent declarations
    const output = transpile(input)
    const result = new Function(`${output}; ${expression};`)()
    expect(result).toBe(expected)
  })

  it('resolves a member name that an outer const also binds', () => {
    // Given: a member whose name matches an outer const — inside the
    // initializer the member binding wins, on both resolution paths
    const input = [
      'const X = 100',
      'enum E { X = 1, Y = X + 1 }',
    ].join('\n')
    // When: transpiled
    const output = transpile(input)
    // Then: the sibling member folds, not the outer const
    expect(output).toContain('E[E["Y"] = 2] = "Y"')
    expect(evalEnum(input).Y).toBe(2)
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

  it('erases type assertions in constant initializers like tsc', () => {
    // Given: a parenthesized constant initializer with a type assertion
    const input = 'enum E { A = (1 as number) }'
    // When: transpiled and evaluated
    const output = transpile(input)
    // Then: the assertion does not survive into the emitted JavaScript
    // (tsc erases it and folds the member to `E[E["A"] = 1] = "A"`), and the
    // output stays executable
    expect(output).not.toContain('as')
    expect(evalEnum(input).A).toBe(1)
  })

  it('erases type-only syntax in non-constant initializers', () => {
    // Given: a non-constant initializer containing a type assertion
    const input = 'enum E { A = f() as number }'
    // When: transpiled and evaluated with a runtime `f`
    const output = transpile(input)
    // Then: the initializer goes through the normal erasure flow (tsc emits
    // `E[E["A"] = f()] = "A"`), so the member evaluates instead of the
    // emitted text failing to parse
    expect(output).not.toContain('as')
    expect(evalEnum(input, () => 1).A).toBe(1)
  })

  it.each([
    ['an arrow parameter', 'enum E { A = 1, B = ((A) => A)(2) }', 2],
    ['a function parameter', 'enum E { A = 1, B = (function (A) { return A })(3) }', 3],
    ['a local declaration', 'enum E { A = 1, B = (() => { var A = 5; return A })() }', 5],
  ])('leaves %s shadowing a member name unqualified', (_label, input, expected) => {
    // Given: a non-constant initializer whose inner scope shadows the member
    // name `A` — valid TypeScript that tsc emits with the reference unqualified
    // When: transpiled and evaluated
    // Then: the shadowed reference resolves to the local binding, not the
    // enum member
    expect(evalEnum(input).B).toBe(expected)
  })

  it('still qualifies unshadowed references next to shadowed ones', () => {
    // Given: one shadowed reference and one real member reference in the
    // same initializer
    const input = 'enum E { A = 1, B = ((A) => A)(2) + A }'
    // When: transpiled and evaluated
    // Then: only the unshadowed reference is qualified (tsc emits
    // `E[E["B"] = ((A) => A)(2) + E.A] = "B"`), so B is 2 + 1
    expect(evalEnum(input).B).toBe(3)
  })

  it('keeps scope information through nested value positions', () => {
    // Given: a shadowing parameter referenced through a property access —
    // the member-access walk must not start from an empty scope stack
    const input = 'enum E { A = 1, B = ((A) => A.x)({ x: 2 }) }'
    // When: transpiled and evaluated
    // Then: the shadowed reference stays unqualified (tsc emits
    // `((A) => A.x)`), so B is 2, not undefined
    expect(transpile(input)).toContain('((A) => A.x)')
    expect(evalEnum(input).B).toBe(2)
  })

  it('never rewrites references inside erased type declarations', () => {
    // Given: a body-level type alias referencing a member via `typeof` —
    // the declaration is erased, and rewriting its names would splice
    // member text back into erased content
    const input
      = 'enum E {\n  A = 1,\n  B = (() => { type T = [typeof A, typeof A]; return 2; })()\n}'
    // When: transpiled and evaluated
    // Then: the erased declaration contributes nothing to the output (tsc
    // erases it entirely) and the member evaluates
    expect(transpile(input)).not.toContain('typeof')
    expect(transpile(input)).not.toContain('E.A')
    expect(evalEnum(input).B).toBe(2)
  })

  it('does not let a block-scoped declaration shadow the whole body', () => {
    // Given: a block-scoped `let` inside the body and a reference outside
    // that block
    const input = 'enum E { A = 1, B = (() => { { let A = 2; } return A; })() }'
    // When: transpiled and evaluated
    // Then: the outer reference resolves to the member (tsc emits
    // `return E.A`), so B is 1
    expect(transpile(input)).toContain('return E.A;')
    expect(evalEnum(input).B).toBe(1)
  })

  it('hoists var declarations to the function scope like tsc', () => {
    // Given: a `var` declared inside a nested block, referenced outside it
    const input = 'enum E { A = 1, B = (() => { { var A = 2; } return A; })() }'
    // When: transpiled and evaluated
    // Then: the hoisted var shadows the member for the whole body (tsc
    // leaves `return A` unqualified), so B is 2
    expect(transpile(input)).toContain('return A;')
    expect(evalEnum(input).B).toBe(2)
  })

  it('binds function declarations in their enclosing scope', () => {
    // Given: a member name reused by a function declaration in the body —
    // the declaration binds in the enclosing scope even though the walk
    // must not descend into the function's own bindings
    const input = 'enum E { f = 1, B = (() => { function f() { return 9 } return f() })() }'
    // When: transpiled and evaluated
    // Then: the call resolves to the local function (tsc leaves `f()`
    // unqualified), so B is 9
    expect(transpile(input)).toContain('return f()')
    expect(evalEnum(input).B).toBe(9)
  })

  it('propagates string members through qualified references', () => {
    // Given: a reference to a string-valued sibling through the enum object
    const input = 'enum E { A = "a", B = E.A }'
    // When: transpiled and evaluated
    // Then: tsc folds it to a plain assignment — the numeric
    // reverse-mapping shape would add a bogus `"a": "B"` key
    expect(transpile(input)).not.toContain('E[E["B"]')
    expect(evalEnum(input)).toEqual({ A: 'a', B: 'a' })
  })

  it('propagates string members through computed references', () => {
    // Given: a computed access to a string-valued sibling
    const input = 'enum E { A = "a", B = E["A"] }'
    // When: transpiled and evaluated
    // Then: folded to a plain assignment like tsc
    expect(transpile(input)).not.toContain('E[E["B"]')
    expect(evalEnum(input)).toEqual({ A: 'a', B: 'a' })
  })

  it('folds mixed string/number concatenations like tsc', () => {
    // Given: concatenations mixing a string member with numbers
    const inputs = [
      ['enum E { A = "a", B = A + 1 }', 'a1'],
      ['enum E { A = "a", B = 1 + A }', '1a'],
      ['enum E { A = "a", B = "n" + 1 + A }', 'n1a'],
    ] as const
    for (const [input, expected] of inputs) {
      // When: transpiled and evaluated
      // Then: folded with JS number formatting, no reverse mapping
      expect(transpile(input)).not.toContain('E[E["B"]')
      expect(evalEnum(input)).toEqual({ A: 'a', B: expected })
    }
  })

  it('binds declarations written directly in switch case clauses', () => {
    // Given: a case-level `let` — all clauses of a switch share one block
    // scope, so the reference from a later statement resolves to it
    const input
      = 'enum E { A = 1, B = (() => { switch (2) { case 2: let A = 10; return A; } return 0; })() }'
    // When: transpiled and evaluated
    // Then: the reference stays unqualified like tsc, so B is 10 — not the
    // member value
    expect(transpile(input)).toContain('return A;')
    expect(evalEnum(input).B).toBe(10)
  })

  it('binds function declarations in switch case clauses', () => {
    // Given: a function declaration written directly in a case clause
    const input
      = 'enum E { f = 1, B = (() => { switch (2) { case 2: function f() { return 9 } return f() } return 0 })() }'
    // When: transpiled and evaluated
    // Then: the call resolves to the local function like tsc, so B is 9
    expect(transpile(input)).toContain('return f()')
    expect(evalEnum(input).B).toBe(9)
  })

  it('qualifies the switch discriminant in the enclosing scope', () => {
    // Given: a member reference in the discriminant while a case clause
    // declares the same name — the discriminant is evaluated before the
    // switch body's shared scope exists
    const input
      = 'enum E { A = 1, B = (() => { switch (A) { case 9: let A = 5; return A; } return 0 })() }'
    // When: transpiled and evaluated
    // Then: the discriminant is qualified (tsc emits `switch (E.A)`) while
    // the case reference is not; 1 does not match case 9, so B is 0
    expect(transpile(input)).toContain('switch (E.A)')
    expect(transpile(input)).toContain('return A;')
    expect(evalEnum(input).B).toBe(0)
  })

  it('propagates string member references without a reverse mapping', () => {
    // Given: a member whose initializer references a string-valued sibling
    const input = 'enum E { A = "a", B = A }'
    // When: transpiled and evaluated
    const output = transpile(input)
    // Then: the evaluated enum matches the TypeScript emitter exactly — the
    // value is a string, so the numeric reverse-mapping shape must not be
    // emitted (it would add a bogus `"a": "B"` key)
    expect(output).not.toContain('E[E["B"]')
    expect(evalEnum(input)).toEqual({ A: 'a', B: 'a' })
  })

  it('propagates string member references inside larger initializers', () => {
    // Given: a string-valued sibling referenced inside a bigger expression
    const input = 'enum E { A = "a", B = "x" + A }'
    // When: transpiled and evaluated
    // Then: B is the string value; no reverse mapping may run over it
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
    // Given: two declarations of the same enum — TypeScript merges them
    // into one enum, so the later declaration folds `B = A` to A's value
    // while auto-increment restarts per declaration
    const input = 'enum Foo { A = 7 }\nenum Foo { B = A, C }\n'
    // When: transpiled
    // Then: B folds to 7 and C continues from it, like tsc
    expect(transpile(input)).toContain('Foo[Foo["B"] = 7] = "B"')
    expect(transpile(input)).toContain('Foo[Foo["C"] = 8] = "C"')
  })

  it('qualifies merged-declaration references to the runtime binding', () => {
    // Given: a merged declaration whose earlier member is not foldable
    const input = 'enum Foo { A = f() }\nenum Foo { B = A }\n'
    // When: transpiled and evaluated with a runtime `f`
    // Then: the reference is qualified like tsc (`Foo[Foo["B"] = Foo.A]
    // = "B"`), so B is 3 — not the outer `A` binding if one exists
    expect(transpile(input)).toContain('Foo[Foo["B"] = Foo.A] = "B"')
    expect(evalEnum(input, () => 3).B).toBe(3)
  })

  it('restarts auto-increment at 0 in each merged declaration', () => {
    // Given: a merged declaration whose first declaration ends in a string
    const input = 'enum Foo { A = "s" }\nenum Foo { B }\n'
    // When: transpiled
    // Then: B starts from 0 again, like tsc
    expect(transpile(input)).toContain('Foo[Foo["B"] = 0] = "B"')
  })

  it('folds string members through template literals like tsc', () => {
    // Given: template literals referencing string members of other enums
    // (the oxc transformer conformance corpus covers this shape)
    const input = [
      'enum Size { SMALL = "tiny", LARGE = "big" }',
      'enum Animal { CAT = "meow", DOG = "woof" }',
      'enum Z { SMALL_CAT = `${Size.SMALL}_${Animal.CAT}`, LARGE_DOG = `${Size.LARGE}_${Animal.DOG}` }',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: folded to plain string assignments — no reverse mapping
    expect(transpile(input)).not.toContain('Z[Z[')
    const Z = evalNamed(input, 'Z')
    expect(Z.SMALL_CAT).toBe('tiny_meow')
    expect(Z.LARGE_DOG).toBe('big_woof')
  })

  it('folds numeric members through template literals like tsc', () => {
    // Given: template literals referencing numeric members of another enum
    const input = [
      'enum N { A = 1, B = 2 }',
      'enum Z { C = `prefix-${N.A}-middle-${N.B}-suffix`, D = `${N.A}-suffix` }',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: numbers render with JS number formatting inside the string
    const Z = evalNamed(input, 'Z')
    expect(Z.C).toBe('prefix-1-middle-2-suffix')
    expect(Z.D).toBe('1-suffix')
  })

  it('keeps nested enum members scoped to their own declaration', () => {
    // Given: an enum declared inside another enum's initializer (the oxc
    // transformer tests this shape) — the inner `B = A` references the
    // inner member, not the outer one
    const input
      = 'enum Outer { A = 5, B = (() => { enum Inner { A = 99, B = A } return Inner.B })() }'
    // When: transpiled and evaluated
    // Then: Inner.B resolves to the inner member, so Outer.B is 99
    expect(evalNamed(input, 'Outer').B).toBe(99)
  })

  it('emits `undefined` for auto-increment after a string member like tsc', () => {
    // Given: an unannotated member following a string member — oxc's
    // transformer emits `1 + E.A` here; tsc emits `void 0`, which we pin
    const input = 'enum E { A = "x", B }'
    expect(transpile(input)).toContain('E[E["B"] = undefined] = "B"')
    expect(evalEnum(input).B).toBeUndefined()
  })

  it('isolates the merged-declaration cache between scopes', () => {
    // Given: same-name enums in different function scopes — they do NOT
    // merge, so g's `B = A` must resolve to g's own non-constant member
    // instead of folding through f's member of the same name
    const input = [
      'function f() { enum E { A = 1 } }',
      'function g() { enum E { A = foo(), B = A } return E.B }',
      'function foo() { return 9 }',
      'const out = g();',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: the reference qualifies to g's member, so out is 9
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('hoists var from nested blocks inside static blocks', () => {
    // Given: a `var` inside a nested block of a class static block — the
    // static block is the var's innermost environment
    const input
      = 'enum E { A = 1, B = (() => { class C { static x = 0; static { { var A = 2 } C.x = A } } return C.x })() }'
    // When: transpiled and evaluated
    // Then: the reference resolves to the hoisted var, so B is 2
    expect(transpile(input)).not.toContain('C.x = E.A')
    expect(evalNamed(input, 'E').B).toBe(2)
  })

  it('normalizes CRLF and CR inside template literals like tsc', () => {
    // Given: template quasis containing literal <CRLF> and <CR> line
    // terminators — template cooked values normalize both to <LF>, while
    // an escaped `\r` is not a line terminator and stays CR
    const input = 'enum E { A = `a\r\nb`, B = `c\rd` }'
    const E = evalNamed(input, 'E')
    expect(E.A).toBe('a\nb')
    expect(E.B).toBe('c\nd')
    const escaped = 'enum E { A = `a\\rb` }'
    expect((evalNamed(escaped, 'E').A as string).includes('\r')).toBe(true)
  })

  it('resolves member references through outer enums', () => {
    // Given: an enum initializer referencing a member of an enum declared
    // in an outer scope — the scope-chain lookup finds it, inner scopes
    // first, so same-name enums shadow by depth
    const input = [
      'enum E { A = "a" }',
      'function f() { enum F { B = E.A } return F }',
      'const out = f();',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: folded to a plain string assignment like tsc — no reverse
    // mapping may run over it
    expect(transpile(input)).not.toContain('F[F[')
    expect(evalNamed(input, 'out')).toEqual({ B: 'a' })
  })

  it('shadows outer enums with an inner declaration of the same name', () => {
    // Given: an inner enum named like the outer one — the reference from
    // inside the inner declaration resolves to the inner member
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
    // Given: an enum inside a block shadowing a top-level enum of the same
    // name — `var` would hoist and clobber the outer binding; tsc emits
    // `let` everywhere but the program scope
    const input = 'enum E { A = 1 }\n{ enum E { A = 2 } }\nconst out = E.A;'
    // When: transpiled and evaluated
    // Then: the block enum is block-scoped, so the outer member survives
    expect(transpile(input)).toContain('{ let ')
    expect(evalNamed(input, 'out')).toBe(1)
  })

  it('exports a merged enum exactly once', () => {
    // Given: two exported declarations of the same enum — a second
    // `export var E` would make the module fail to load
    const input = 'export enum E { A = 1 }\nexport enum E { B = 2 }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: a single export carries the binding; the later declaration
    // appends only its members
    expect(output.match(/export /g)).toHaveLength(1)
    const E = new Function(`${output.replace(/export /g, '')}; return E;`)()
    expect(E).toEqual({ A: 1, B: 2, 1: 'A', 2: 'B' })
  })

  it('separates a merged later declaration from the previous statement', () => {
    // Given: a merged later declaration whose IIFE follows a statement
    // without a trailing semicolon — without a leading `;` the emitted
    // `(function ...)` continues that statement as a call (`1(function ...)`)
    const input = 'enum E { A = 1 }\nconst x = 1\nenum E { B = 2 }\n'
    // When: transpiled and evaluated
    const output = transpile(input)
    const E = new Function(`${output}; return E;`)()
    // Then: both IIFEs start fresh statements (`E; (function` plus the
    // injected `; (function`), so the merge completes without a call error
    expect(output.match(/; \(function/g)).toHaveLength(2)
    expect(E).toEqual({ A: 1, B: 2, 1: 'A', 2: 'B' })
  })

  it('separates a merged later declaration inside a function body', () => {
    // Given: the same merged shape inside a function body — the previous
    // `const` statement has no trailing semicolon either
    const input = [
      'function f() {',
      '  enum E { A = 1 }',
      '  const x = 1',
      '  enum E { B = 2 }',
      '  return E',
      '}',
      'const out = f();',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: the later IIFE does not call the previous statement's value
    expect(evalNamed(input, 'out')).toEqual({ A: 1, B: 2, 1: 'A', 2: 'B' })
  })

  it('separates an exported merged later declaration', () => {
    // Given: a merged group whose export landed on the first declaration —
    // the later declaration appends its members as a bare IIFE, which must
    // not continue a preceding semicolon-less statement
    const input = 'export enum E { A = 1 }\nconst x = 1\nexport enum E { B = 2 }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: a single export carries the binding and the later IIFE starts a
    // fresh statement
    expect(output.match(/export /g)).toHaveLength(1)
    expect(output.match(/; \(function/g)).toHaveLength(2)
    const E = new Function(`${output.replace(/export /g, '')}; return E;`)()
    expect(E).toEqual({ A: 1, B: 2, 1: 'A', 2: 'B' })
  })

  it('folds references to ambient enum members like tsc', () => {
    // Given: an ambient enum — it emits no runtime code, but TypeScript
    // still folds member references through it, so the emitted F must
    // never reference E at runtime
    const input = 'declare enum E { A = "x" }\nenum F { B = E.A }\n'
    // When: transpiled and evaluated
    const output = transpile(input)
    const F = new Function(`${output}; return F;`)()
    // Then: the reference folds to the ambient constant as a plain string
    // assignment (no reverse mapping over a string value), and no E remains
    expect(F).toEqual({ B: 'x' })
    expect(output).not.toContain('E')
  })

  it('folds numeric references to ambient enum members', () => {
    // Given: a numeric member of an ambient enum referenced by a real one
    const input = 'declare enum N { A = 5 }\nenum F { B = N.A }\n'
    // When: transpiled
    const output = transpile(input)
    // Then: the folded value emits in the reverse-mapping shape, like tsc
    expect(output).toContain('F[F["B"] = 5] = "B"')
    expect(output).not.toContain('N')
  })

  it('folds through ambient members of a merged group without emitting them', () => {
    // Given: an ambient declaration merged with a real one — the ambient
    // members join the constant table (tsc folds `B = A` to 7) but only the
    // real declaration's members reach the runtime object
    const input = 'declare enum E { A = 7 }\nenum E { B = A }\n'
    // When: transpiled and evaluated
    const output = transpile(input)
    const E = new Function(`${output}; return E;`)()
    // Then: B folds through the ambient member, and A stays ambient-only
    expect(output).toContain('E[E["B"] = 7] = "B"')
    expect(E).toEqual({ B: 7, 7: 'B' })
  })

  it('keeps enum declarations inside static blocks as block bindings', () => {
    // Given: an enum declared directly inside a class static block, named
    // like an outer member — like any block binding it shadows the member
    // for references in that static block (tsc emits `A.X` bare)
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
    // When: transpiled and evaluated
    // Then: the reference resolves to the inner enum, so B is 2 — not
    // `E.A.X`, which is undefined
    expect(transpile(input)).toContain('C.value = A.X')
    expect(evalNamed(input, 'E').B).toBe(2)
  })

  it('does not auto-increment uninitialized members of ambient enums', () => {
    // Given: an uninitialized member of a plain ambient enum — the ambient
    // object exists at runtime elsewhere, so its value is not a
    // compile-time constant; tsc keeps the runtime read (`E.B`) instead
    // of folding to previous + 1
    const input = 'declare enum E { A = 5, B }\nenum F { C = E.B }\n'
    // When: transpiled and evaluated against a runtime ambient object
    const output = transpile(input)
    const F = new Function('E', `${output}; return F;`)({ A: 5, B: 9 })
    // Then: C reads E.B at runtime, so it is 9 — not the folded 6
    expect(output).toContain('F[F["C"] = E.B] = "C"')
    expect(F.C).toBe(9)
  })

  it('auto-increments uninitialized members of ambient const enums', () => {
    // Given: an ambient *const* enum — every member inlines, so an
    // uninitialized member folds to previous + 1 like tsc
    const input = 'declare const enum E { A = 5, B }\nenum F { C = E.B }\n'
    // When: transpiled
    // Then: B folds to 6
    expect(transpile(input)).toContain('F[F["C"] = 6] = "C"')
  })

  it('resolves member references through chains of later-declared enums', () => {
    // Given: a reference chain crossing scopes where every link is
    // declared later in the file (F.A → E.B → G.C): single-pass collection
    // cannot fold F.A, so the emitted F wrongly picks the numeric
    // reverse-mapping shape; tsc resolves the whole chain before emitting
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
    // When: transpiled and evaluated
    // Then: the chain folds to the string, so F emits a plain assignment
    // without a reverse-mapping key
    expect(transpile(input)).toContain('F["A"] = "s"')
    expect(evalNamed(input, 'result')).toEqual({ A: 's' })
  })

  it('resolves numeric references through chains of later-declared enums', () => {
    // Given: the same forward chain ending in a numeric member
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
    // When: transpiled and evaluated
    // Then: the chain folds to the number in the reverse-mapping shape
    expect(transpile(input)).toContain('F[F["A"] = 5] = "A"')
    expect(evalNamed(input, 'result')).toEqual({ A: 5, 5: 'A' })
  })

  it('folds references to const constants like tsc', () => {
    // Given: a `const` with a literal initializer referenced by a member —
    // the checker treats it as a compile-time constant, so the reference
    // folds and the auto-increment chain continues from it
    const input = 'const x = 5\nenum E { A = x, B }\n'
    // When: transpiled and evaluated
    // Then: A folds to 5 and B increments to 6 (not `undefined`)
    expect(transpile(input)).toContain('E[E["A"] = 5] = "A"')
    expect(transpile(input)).toContain('E[E["B"] = 6] = "B"')
    expect(evalEnum(input).B).toBe(6)
  })

  it('folds const string constants without a reverse mapping', () => {
    // Given: a string `const` referenced by a member — its type is a
    // string literal, so tsc emits the plain assignment shape
    const input = 'const x = "s"\nenum E { A = x }\n'
    // When: transpiled and evaluated
    // Then: plain assignment — no `s: "A"` reverse-mapping key
    expect(transpile(input)).toContain('E["A"] = "s"')
    expect(evalEnum(input)).toEqual({ A: 's' })
  })

  it('folds const constants referencing enum members', () => {
    // Given: a const whose initializer references an enum member, itself
    // referenced by a later enum — the chain folds through the const
    const input = [
      'enum E { A = 5 }',
      'const y = E.A',
      'enum F { B = y }',
    ].join('\n')
    expect(transpile(input)).toContain('F[F["B"] = 5] = "B"')
  })

  it('reads let bindings at runtime instead of folding', () => {
    // Given: a `let` reference — reassignable bindings are not
    // compile-time constants; and an inner `let` shadowing an outer
    // `const` must win along the scope chain
    const shadow = [
      'const x = 5',
      'function f() { let x = 9; enum E { A = x } return E.A }',
      'const out = f()',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: the reference reads the inner let at runtime
    expect(transpile(shadow)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(shadow, 'out')).toBe(9)
  })

  it('emits the numeric reverse mapping for asserted string members', () => {
    // Given: a string initializer wrapped in a type assertion — the value
    // still folds, but the asserted type is not a string literal, so tsc
    // emits the numeric reverse-mapping shape (value and shape are
    // independent decisions)
    const input = 'enum E { A = ("s" as any) }\n'
    // When: transpiled and evaluated
    // Then: the object carries both directions, like tsc
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
    // Given: a non-null assertion on the initializer (tsc reports TS18033
    // on these inputs and keeps the runtime read)
    // When: transpiled
    const output = transpile(input)
    // Then: no member folds, the assertion is erased, bare member
    // references are qualified, and the numeric reverse-mapping shape
    // covers the runtime value — the object matches tsc's emit
    expect(output).not.toContain('E["B"] = "a"')
    expect(evalEnum(input)).toEqual(expected)
  })

  it.each([
    ['(("x") as any)', { B: 'x', x: 'B' }],
    ['(1) as any', { B: 1, 1: 'B' }],
  ])('keeps a parenthesized operand under an assertion as a runtime read (%s)', (initializer, expected) => {
    // Given: a type assertion whose direct operand is parenthesized —
    // legal TypeScript where tsc also keeps the runtime read, unlike an
    // assertion over a bare operand (which folds, see the tests above)
    const input = `enum E { B = ${initializer} }`
    // When: transpiled
    const output = transpile(input)
    // Then: the source expression is kept with the type erased, in the
    // numeric reverse-mapping shape
    expect(output).not.toContain('E["B"] = "x"')
    expect(evalEnum(input)).toEqual(expected)
  })

  it('keeps runtime reads when referencing non-literal string members', () => {
    // Given: a reference to a string member whose initializer was
    // asserted — its type is not a literal, so the checker does not
    // treat the reference as constant and tsc keeps the runtime read
    const input = 'enum P { S = ("s" as any) }\nenum E { A = P.S }\n'
    // When: transpiled and evaluated
    // Then: E.A reads P.S at runtime in the reverse-mapping shape
    expect(transpile(input)).toContain('E[E["A"] = P.S] = "A"')
    expect(evalNamed(input, 'E')).toEqual({ A: 's', s: 'A' })
  })

  it('reads parameters at runtime instead of folding outer consts', () => {
    // Given: a parameter shadowing an outer const — parameters are never
    // compile-time constants, and they stop the outer lookup
    const input = [
      'const x = 5',
      'function f(x: number) { enum E { A = x } return E.A }',
      'const out = f(9)',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: the member reads the parameter at runtime
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
    // Given: a `var` in a nested block — it hoists to the function, so a
    // sibling enum's reference resolves to it, not the outer const
    const input = [
      'const x = 5',
      'function f() { { var x = 9 } enum E { A = x } return E.A }',
      'const out = f()',
    ].join('\n')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('folds the outer const after a for-head binding ends', () => {
    // Given: a for-head `let` sharing the outer const's name — its scope
    // ends with the loop, so a later enum's references resolve outward
    const input = 'const x = 5\nfor (let x = 0; x < 1; x++) {}\nenum E { A = x, B }\n'
    expect(transpile(input)).toContain('E[E["A"] = 5] = "A"')
    expect(transpile(input)).toContain('E[E["B"] = 6] = "B"')
  })

  it('stops the outer lookup at consts whose values do not fold', () => {
    // Given: an inner const with a non-foldable initializer — the
    // unresolved inner binding must stop the search instead of falling
    // through to the outer const's value
    const input = [
      'const x = 5',
      'function f() { const x = (() => 9)(); enum E { A = x } return E.A }',
      'const out = f()',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('folds inner alias chains to the inner value', () => {
    // Given: an alias chain of foldable inner consts shadowing an outer
    // const of the same name — the chain resolves to the inner value
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
    // Given: a const with a type annotation — the declared type is not a
    // literal, so tsc keeps the runtime read (and the reverse-mapping
    // shape falls out of the non-folded initializer)
    const input = 'const x: any = "s"\nenum E { A = x }\n'
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'E')).toEqual({ A: 's', s: 'A' })
  })

  it('reads for-head let bindings inside the loop body', () => {
    // Given: a for-head `let` shadowing an outer const — inside the loop
    // body the reference resolves to the head binding
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
    // When: transpiled and evaluated
    // Then: the member reads the head binding at runtime
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('reads vars hoisted out of for heads after the loop', () => {
    // Given: a `var` declared in a for head — it hoists to the function,
    // so a reference after the loop reads it, not the outer const
    const input = [
      'const x = 5',
      'function f() { for (var x = 9; x < 10; x++) {} enum E { A = x } return E.A }',
      'const out = f()',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(10)
  })

  it('reads rest parameters through destructuring', () => {
    // Given: a rest parameter binding through a destructuring pattern —
    // it shadows the outer const like any parameter
    const input = [
      'const x = 5',
      'function f(...[x]: number[]) { enum E { A = x } return E.A }',
      'const out = f(9)',
    ].join('\n')
    expect(transpile(input)).toContain('E[E["A"] = x] = "A"')
    expect(evalNamed(input, 'out')).toBe(9)
  })

  it('resolves named function expression self-references', () => {
    // Given: a named function expression whose own name shadows an outer
    // const — inside the body the name resolves to the function itself
    const input = [
      'const x = 5',
      'const g = function x() {',
      '  enum E { A = +x }',
      '  return E.A',
      '}',
      'const out = g()',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: the reference reads the function at runtime (+fn is NaN),
    // like tsc — not the outer 5
    expect(transpile(input)).toContain('E[E["A"] = +x] = "A"')
    expect(Number.isNaN(evalNamed(input, 'out'))).toBe(true)
  })

  it('resolves named class expression self-references', () => {
    // Given: a named class expression whose own name shadows an outer
    // const — a method body resolves the name to the class
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
    // Given: an enum inside a parameter's default value — defaults
    // evaluate in the parameter environment, so the reference resolves
    // to the parameter, not an outer const
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
    // Given: the same shape one level down — the enum sits in an
    // expression-bodied arrow's enclosing parameter default
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
    // Given: a for loop without a block body — the head binding's scope
    // still ends with the loop, so a later enum folds the outer const
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
    // Given: an enum inside the loop condition itself — it sits in the
    // loop's scope, so the reference reads the head binding (the guard
    // flips on the first evaluation, keeping the loop finite)
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
    // Given: an enum inside a static field initializer of a named class
    // expression — field initializers sit in the class scope, so the
    // name resolves to the class (+class is NaN)
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
    // Given: a catch parameter with a destructuring default (containing a
    // type assertion) and a trailing type annotation — the pattern sits
    // before the annotation, so its edits must land before the erasure
    const input = 'try { throw {} }\ncatch ({ x = 1 as number }: any) {}\n'
    // When: transpiled and executed
    const output = transpile(input)
    // Then: the output stays valid JavaScript — the assertion is erased
    // in place and the annotation blanks after the pattern
    expect(output).toContain('catch ({ x = 1')
    expect(() => new Function(output)).not.toThrow()
  })

  it('erases catch annotations after enum members in defaults', () => {
    // Given: the same shape with an enum inside the default value — its
    // expansion edits interleave with the pattern's, still in order
    const input = [
      'try { throw {} }',
      'catch ({ x = (() => { enum E { A = 1 } return E.A })() as number }: any) {}',
    ].join('\n')
    const output = transpile(input)
    expect(() => new Function(output)).not.toThrow()
  })

  it('reads catch parameters from destructuring defaults', () => {
    // Given: an enum inside a catch parameter's destructuring default —
    // the parameter scope covers the defaults (where the pattern binds)
    // and the body alike
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
    // Given: an enum inside a switch discriminant — the discriminant
    // evaluates before the shared case scope exists, so its references
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
    // Given: a bare reference to a sibling member whose value is a
    // string — the member binds the name, so even though the numeric
    // folder cannot use it, the reference must not fall through to an
    // outer const of the same name
    const input = 'const A = 5\nenum E {\n  A = "s",\n  B = A\n}\n'
    // When: transpiled and evaluated
    // Then: the string folder resolves the member — B is "s", not 5
    expect(evalEnum(input)).toEqual({ A: 's', B: 's' })
  })

  it('does not fall through to outer consts behind uncomputable members', () => {
    // Given: a bare reference to a sibling member whose initializer does
    // not fold at all — the member still binds the name, and the emitted
    // reference reads it at runtime
    const input = 'const A = 5\nenum E {\n  A = (() => 9)(),\n  B = A\n}\n'
    // When: transpiled and evaluated
    // Then: B reads E.A at runtime, so it is 9 — not the folded outer 5
    expect(transpile(input)).toContain('E[E["B"] = E.A] = "B"')
    expect(evalEnum(input, () => 9).B).toBe(9)
  })

  it('resolves outer enum members inside nested declarations', () => {
    // Given: a nested enum whose initializer references a member of the
    // enclosing enum — the member binding is visible through the enum's
    // member scope, so the reference folds to it, not to a file-level
    // const of the same name
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
    // Given: the same reference through a local const alias — the const's
    // initializer resolves in the outer enum's member scope too
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
    // Given: a nested enum referencing an outer auto-increment member —
    // the member's computed value joins the lookup chain
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
    // Given: a nested enum referencing an outer member whose value does
    // not fold — the reference qualifies to the outer enum object, like
    // tsc, instead of staying bare (which has no binding at runtime)
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
    // Given: a template initializer that does not fold (its expression
    // calls a function) — the emitted value stays a runtime template,
    // and a string-typed initializer takes the plain assignment shape
    // (no reverse mapping over its runtime result), like the TypeScript
    // emitter
    const input = 'function f() { return 1 }\nenum E { B = `x${f()}` }\n'
    expect(transpile(input)).toContain('E["B"] = `x${f()}`')
    expect(evalNamed(input, 'E')).toEqual({ B: 'x1' })
  })

  it('keys string members by their raw units', () => {
    // Given: two members named with distinct lone surrogates — the parse
    // copy's lossy strings collapse both to U+FFFD, so the member tables
    // must key on the raw UTF-16 units to keep the members distinct
    const d800 = String.fromCharCode(0xD800)
    const dbff = String.fromCharCode(0xDBFF)
    const input = `enum E { "${d800}" = 1, "${dbff}" = 2, C = E["${d800}"] }\n`
    // When: transpiled and evaluated
    // Then: the reference resolves to the first member — 1, not 2
    expect(evalNamed(input, 'E').C).toBe(1)
  })

  it('resolves named class self-references in heritage expressions', () => {
    // Given: a named class *expression* whose heritage references the
    // class name — the binding exists at heritage evaluation (in its
    // temporal dead zone), so the reference stays bare and fails with a
    // ReferenceError at runtime, like TypeScript's output — instead of
    // qualifying to an outer member (which fails with a TypeError)
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
    // Given: an enum initializer referencing an enum declared after it —
    // TypeScript resolves member references with whole-file knowledge
    const input
      = 'export function f() {\n  enum F { B = E.A }\n  return F\n}\nenum E { A = "a" }\nexport const out = f();\n'
    // When: transpiled and evaluated
    // Then: folded to a plain assignment — no bogus reverse-mapping key
    expect(transpile(input)).not.toContain('F[F[')
    const output = transpile(input)
    const out = new Function(`${output.replace(/export /g, '')}; return out;`)()
    expect(out).toEqual({ B: 'a' })
  })

  it('isolates enums declared inside switch and static blocks', () => {
    // Given: enums declared directly in a switch case and a class static
    // block — both scope their declarations (tsc emits `let` for them) so
    // neither merges with nor clobbers the outer enum of the same name
    const input = [
      'let captured = 0',
      'enum E { A = 1 }',
      'switch (0) { case 0: enum E { A = 2 } }',
      'class C { static { enum F { A = 3 } captured = F.A } }',
      'const out = E.A;',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: the outer member survives, and the static-block reference
    // resolves to its own enum
    expect(transpile(input)).toContain('let ')
    expect(evalNamed(input, 'E').A).toBe(1)
    expect(evalNamed(input, 'captured')).toBe(3)
  })

  it('leaves shorthand property values untouched like tsc', () => {
    // Given: a shorthand property whose name matches a member — tsc leaves
    // the shorthand as-is (rewriting the value token would corrupt the key
    // into `{ E.A }`), and the bare name keeps resolving through the
    // runtime scope chain; the explicit `A: A` form does qualify
    const input = [
      'const A = 9;',
      'enum E { A = 1, B = ({ A }).A, C = ({ A: A }).A }',
      'const outB = E.B;',
      'const outC = E.C;',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: the shorthand stays bare (B = 9 through the outer binding)
    // while the explicit property qualifies (C = 1, the member value)
    expect(transpile(input)).toContain('({ A }).A')
    expect(transpile(input)).toContain('({ A: E.A }).A')
    expect(evalNamed(input, 'outB')).toBe(9)
    expect(evalNamed(input, 'outC')).toBe(1)
  })

  it('collects nested enum declarations as block bindings', () => {
    // Given: an enum declared inside an initializer's arrow body, named
    // like an outer member — the inner declaration shadows the member
    const input = [
      'enum E {',
      '  A = 1,',
      '  B = (() => {',
      '    enum A { X = 2 }',
      '    return A.X',
      '  })()',
      '}',
    ].join('\n')
    // When: transpiled and evaluated
    // Then: the reference resolves to the inner enum (tsc emits `A.X`
    // bare), so B is 2 — not undefined
    expect(transpile(input)).toContain('return A.X')
    expect(evalNamed(input, 'E').B).toBe(2)
  })

  it('keeps lone surrogates lossless through template folding', () => {
    // Given: a template literal whose quasis contain a lone surrogate —
    // escaped (the quasi's cooked string is lossy in the AST) and raw
    // (which routes the input through the UTF-16 path)
    const escaped = 'enum E { A = `\\uD800` }'
    const E = evalNamed(escaped, 'E')
    expect((E.A as string).charCodeAt(0)).toBe(0xD800)
    const raw = `enum E { A = \`${String.fromCharCode(0xD800)}\` }`
    expect((evalNamed(raw, 'E').A as string).charCodeAt(0)).toBe(0xD800)
    expect(transpile(raw)).not.toContain('\uFFFD')
  })
})
