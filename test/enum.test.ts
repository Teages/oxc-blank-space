import { describe, expect, it } from 'vitest'
import { transpile } from '../src'

describe('enum', () => {
  it('works', () => {
    expect(transpile(`
      enum Foo {
        BAR = 'bar',
        BAZ = 'baz',
      }
    `)).toMatchInlineSnapshot(`
      "
            var  Foo; (function (Foo) {
              Foo[Foo["BAR"] = 0] = "BAR";
              Foo[Foo["BAZ"] = 1] = "BAZ";
            })(Foo || (Foo = {}));
          "
    `)

    expect(transpile(`
      enum Foo {
        BAR,
        BAZ,
      }
    `)).toMatchInlineSnapshot(`
      "
            var  Foo; (function (Foo) {
              Foo[Foo["BAR"] = 0] = "BAR";
              Foo[Foo["BAZ"] = 1] = "BAZ";
            })(Foo || (Foo = {}));
          "
    `)

    expect(transpile(`
      enum A {
        X,
        "!X",
        Y = 1,
        "!Y"
      }
    `)).toMatchInlineSnapshot(`
      "
            var  A; (function (A) {
              A[A["X"] = 0] = "X";
              A[A["!X"] = 1] = "!X";
              A[A["Y"] = 1] = "Y";
              A[A["!Y"] = 2] = "!Y"
            })(A || (A = {}));
          "
    `)

    expect(transpile(`
      enum A { B, C }
    `)).toMatchInlineSnapshot(`
      "
            var  A; (function (A) { A[A["B"] = 0] = "B"; A[A["C"] = 1] = "C" })(A || (A = {}));
          "
    `)

    expect(transpile(`
      enum A { B,
      C }
    `)).toMatchInlineSnapshot(`
      "
            var  A; (function (A) { A[A["B"] = 0] = "B";
            A[A["C"] = 1] = "C" })(A || (A = {}));
          "
    `)

    expect(transpile(`
      /**/enum/**/Foo/**/{/**/
        /**/BAR/**/,/**/
        /**/BAZ/**/,/**/
      /**/}/**/
    `)).toMatchInlineSnapshot(`
      "
            /**/var /**/Foo; (function (Foo)/**/{/**/
              /**/Foo[Foo["BAR"] = 0] = "BAR"/**/;/**/
              /**/Foo[Foo["BAZ"] = 1] = "BAZ"/**/;/**/
            /**/})(Foo || (Foo = {}));/**/
          "
    `)
  })
})
