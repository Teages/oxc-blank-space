import { describe, expect, test } from "bun:test";
import { parseSync } from "oxc-parser";
import tsBlankSpace from "ts-blank-space";
import { transpile } from "../src/index.js";

describe("transpile", () => {
    test("blanks a type annotation while preserving positions", () => {
        // Given: a variable declaration with a type annotation
        const input = "const a: number = 1";
        // When: transpiled
        const output = transpile(input);
        // Then: the annotation becomes whitespace of equal length
        expect(output).toBe("const a         = 1");
        expect(output).toEqual(tsBlankSpace(input));
        expect(output.length).toBe(input.length);
    });

    test("keeps every line and column of untouched code stable", () => {
        // Given: code mixing types and runtime statements
        const input = [
            "function greet(name: string): string {",
            "  return `hi ${name}`;",
            "}",
            "",
        ].join("\n");
        // When: transpiled
        const output = transpile(input);
        // Then: output has the same length and line count
        expect(output.length).toBe(input.length);
        expect(output.split("\n").length).toBe(input.split("\n").length);
        expect(output).toContain("return `hi ${name}`;");
    });

    test("erases interfaces and type aliases as blank statements", () => {
        // Given: type-only declarations
        const input =
            "interface Foo {\n  a: string;\n}\ntype Bar = Foo | null;\nconst x = 1;\n";
        // When: transpiled
        const output = transpile(input);
        // Then: only whitespace remains where the declarations were
        expect(output).toEqual(tsBlankSpace(input));
        expect(output.trim()).toBe("const x = 1;");
        expect(output.length).toBe(input.length);
    });

    test("erases `as` and `satisfies` expressions and non-null assertions", () => {
        // Given: assertions of all three shapes
        const input =
            "const a = b as C;\nconst d = e satisfies F;\nconst g = h!.i;\n";
        // When: transpiled
        const output = transpile(input);
        // Then: assertion syntax is gone, positions unchanged
        expect(output).toEqual(tsBlankSpace(input));
        expect(output).not.toContain("as");
        expect(output).not.toContain("satisfies");
        expect(output).not.toContain("!");
    });

    test("erases generic type arguments and parameters", () => {
        // Given: generics on calls, news, functions and classes
        const input = [
            "function f<T>(x: T): T { return x }",
            "const a = new Set<string>()",
            "const b = f<number>(1)",
            "class C<K> extends Array<K> { m(): void {} }",
            "",
        ].join("\n");
        // When: transpiled
        const output = transpile(input);
        // Then: no angle-bracket types remain
        expect(output).toEqual(tsBlankSpace(input));
        expect(output).not.toContain("<");
        expect(output).not.toContain(">");
    });

    test("erases type-only imports and exports", () => {
        // Given: mixed type and value module syntax
        const input = [
            'import type A from "a";',
            'import { type B, c } from "b";',
            'import d, { type E } from "c";',
            "export type F = 1;",
            'export { type G, h } from "d";',
            "export const i = 1;",
            "",
        ].join("\n");
        // When: transpiled
        const output = transpile(input);
        // Then: type-only parts are erased, value parts kept
        expect(output).toEqual(tsBlankSpace(input));
        expect(output).toContain('import {         c } from "b"');
        expect(output).toContain('import d, {        } from "c"');
        expect(output).toContain('export {         h } from "d"');
        expect(output).toContain("export const i = 1;");
    });

    test("erases declare statements and ambient declarations", () => {
        // Given: ambient-only syntax
        const input =
            'declare const a: number;\ndeclare function f(): void;\ndeclare class C {}\ndeclare enum E {}\ndeclare module "m" {}\ndeclare global { }\n';
        // When: transpiled
        const output = transpile(input);
        // Then: everything is blanked
        expect(output).toEqual(tsBlankSpace(input));
        expect(output.trim()).toBe("");
    });

    test("erases class member type syntax but keeps runtime modifiers", () => {
        // Given: members with annotations, modifiers and one parameter property
        const input = [
            "class C {",
            "  readonly x = 1;",
            "  private static y!: string;",
            "  declare z: any;",
            "  constructor(private a: string, b?: number) {}",
            "}",
            "",
        ].join("\n");
        // When: transpiled
        const output = transpile(input);
        // Then: runtime parts survive and the parameter property is reported
        const errors: unknown[] = [];
        const outputWithError = transpile(input, {
            onError: (e) => errors.push(e),
        });
        expect(outputWithError).toEqual(tsBlankSpace(input, () => {}));
        expect(output).toContain("x = 1;");
        expect(output).toContain("static");
        expect(output).not.toContain("readonly");
        expect(errors.length).toBe(1);
    });

    test("erases namespaces that contain only types", () => {
        // Given: a namespace holding an interface
        const input =
            "namespace N {\n  export interface I {}\n}\nconst after = 1;\n";
        // When: transpiled
        const output = transpile(input);
        // Then: the namespace is blanked and ASI protection is not needed
        expect(output).toEqual(tsBlankSpace(input));
        expect(output.trim()).toBe("const after = 1;");
    });

    test("adds ASI protection for statements after blanked syntax", () => {
        // Given: a JS statement without a semicolon followed by a blanked one and a paren statement
        const input = "const a = b\ntype X = number\n(f())()\n";
        // When: transpiled
        const output = transpile(input);
        // Then: a `;` guards the next statement from merging
        expect(output).toEqual(tsBlankSpace(input));
        expect(output).toContain("\n;");
        expect(output.length).toBe(input.length);
    });

    test("handles arrow functions whose return type spans lines", () => {
        // Given: an arrow with the `=>` on a later line than the parameters
        const input = "[1].map((v)\n:number[\n]=>[v]);\n";
        // When: transpiled
        const output = transpile(input);
        // Then: the `)` moves next to the arrow, keeping the output valid JS
        expect(output).toEqual(tsBlankSpace(input));
        expect(output).toBe("[1].map((v \n        \n)=>[v]);\n");
    });

    test("moves the closing paren for arrows with multiline parameter lists", () => {
        // Given: an arrow whose parameter list spans lines before the return type
        const input =
            "export const f = (\n    a: string,\n): number | undefined => list.pop();\n";
        // When: transpiled
        const output = transpile(input);
        // Then: the `)` is relocated next to the `=>`, matching the reference
        expect(output).toEqual(tsBlankSpace(input));
        expect(output).toContain(") => list.pop();");
        expect(output.length).toBe(input.length);
    });

    test("moves the opening paren when generic parameters span lines", () => {
        // Given: a function with multi-line type parameters
        const input = "function f<\n  T\n>(\n  a: T\n) {}\n";
        // When: transpiled
        const output = transpile(input);
        // Then: output matches the reference implementation
        expect(output).toEqual(tsBlankSpace(input));
    });

    test("erases catch clause parameter annotations", () => {
        // Given: a typed catch parameter
        const input = "try {} catch (e: unknown) { }\n";
        // When: transpiled
        const output = transpile(input);
        // Then: the annotation is blanked, the binding kept
        expect(output).toEqual(tsBlankSpace(input));
        expect(output).toContain("catch (e         ) { }");
        expect(output.length).toBe(input.length);
    });

    test("erases this parameters and optional markers", () => {
        // Given: a method with a this-param and optional members
        const input =
            "class C { m?(a): void; }\nfunction f(this: Window, x?: string) {}\n";
        // When: transpiled
        const output = transpile(input);
        // Then: output matches the reference implementation
        expect(output).toEqual(tsBlankSpace(input));
    });

    test("supports tsx parsing via the lang option", () => {
        // Given: tsx code with an embedded assertion
        const input = "const elm = <div>{x as string}</div>;\n";
        // When: transpiled with lang tsx
        const output = transpile(input, { lang: "tsx" });
        // Then: the assertion is erased and the JSX stays intact
        // (the reference tool's default entry always parses as plain .ts, so
        // only the position/length invariants are compared here)
        expect(output).toBe("const elm = <div>{x          }</div>;\n");
        expect(output.length).toBe(input.length);
    });

    test("returns input unchanged on hard parse failures", () => {
        // Given: input oxc cannot recover a statement list from
        const input = "let x: = 1";
        // When: transpiled
        const output = transpile(input);
        // Then: the input is returned verbatim
        expect(output).toBe(input);
    });

    test("wraps `as` expressions whose erasure would change grouping", () => {
        // Given: an assertion whose base expression is rebinding the `/`
        const input = "const x = 1 + 1 as T / 2";
        // When: transpiled
        const output = transpile(input);
        // Then: the base expression is wrapped, length is preserved
        expect(output).toBe("const x = (1 + 1)    / 2");
        expect(output.length).toBe(input.length);
        const parsed = parseSync("input.js", output);
        expect(parsed.errors).toEqual([]);
        expect(
            new Function(`return ${output.slice("const x = ".length)}`)(),
        ).toBe(1);
    });

    test("wraps `satisfies` expressions the same way", () => {
        // Given: a satisfies assertion with a following higher-precedence operator
        const input = "const x = 1 + 1 satisfies T / 2";
        // When: transpiled
        const output = transpile(input);
        // Then: the base expression is wrapped (the longer `satisfies T` span
        // absorbs the two inserted characters the same way)
        expect(output).toBe("const x = (1 + 1)           / 2");
        expect(output.length).toBe(input.length);
    });

    test("wraps assertions inside unparenthesized ??-mixes", () => {
        // Given: `a ?? b as T && c` parses as `a ?? (b && c)` in TypeScript
        const input = "const v = a ?? b as T && c";
        // When: transpiled
        const output = transpile(input);
        // Then: the inner logical expression is wrapped
        expect(output).toBe("const v = a ?? (b)    && c");
        expect(output.length).toBe(input.length);
        const parsed = parseSync("input.js", output);
        expect(parsed.errors).toEqual([]);
    });

    test("wraps reversed ??-mixes around their logical left side", () => {
        // Given: `a && b as T ?? c` parses as `(a && b) ?? c` in TypeScript
        const input = "const v = a && b as T ?? c";
        // When: transpiled
        const output = transpile(input);
        // Then: the left logical expression is wrapped
        expect(output).toBe("const v = (a && b)    ?? c");
        expect(output.length).toBe(input.length);
    });

    test("erases safe assertions without wrapping", () => {
        // Given: assertions whose erasure cannot change grouping
        const input = "const x = a as T + 2";
        // When: transpiled
        const output = transpile(input);
        // Then: no parens are inserted, length preserved
        expect(output).toBe("const x = a      + 2");
        expect(output.length).toBe(input.length);
    });

    test("expands runtime enums into TypeScript-compiler-shaped IIFEs", () => {
        // Given: an auto-incrementing enum with an explicit value in the middle
        const input = "enum Color { Red, Green = 5, Blue }";
        // When: transpiled and evaluated
        const output = transpile(input);
        const Color = new Function(`${output}; return Color;`)();
        // Then: forward and reverse mappings match the TypeScript emitter
        expect(output).toBe(
            'var  Color; (function (Color) { Color[Color["Red"] = 0] = "Red"; Color[Color["Green"] = 5] = "Green"; Color[Color["Blue"] = 6] = "Blue" })(Color || (Color = {}));',
        );
        expect(Color).toEqual({
            Red: 0,
            Green: 5,
            Blue: 6,
            0: "Red",
            5: "Green",
            6: "Blue",
        });
    });

    test("expands string enums without reverse mapping", () => {
        // Given: a string enum
        const input = 'enum S { A = "x", B = "y" }';
        // When: transpiled and evaluated
        const output = transpile(input);
        const S = new Function(`${output}; return S;`)();
        // Then: plain property assignments, matching the TypeScript emitter
        expect(output).toBe(
            'var  S; (function (S) { S["A"] = "x"; S["B"] = "y" })(S || (S = {}));',
        );
        expect(S).toEqual({ A: "x", B: "y" });
    });

    test("resolves member references inside enum initializers", () => {
        // Given: members referencing earlier members and non-constant values
        const input = 'enum E { A, B = A, C = B + 1, D = "d".length, F = D }';
        // When: transpiled and evaluated
        const output = transpile(input);
        const E = new Function(`${output}; return E;`)();
        // Then: references are qualified with the enum name and stay correct
        expect(output).toContain('E[E["F"] = E.D] = "F"');
        expect(E).toEqual({
            A: 0,
            B: 0,
            C: 1,
            D: 1,
            F: 1,
            0: "B",
            1: "F",
        });
    });

    test("expands const enums so untouched use sites keep working", () => {
        // Given: a const enum with a use site that the tool never rewrites
        const input = "const enum CE { A, B = A + 3 }\nconst use = CE.B;";
        // When: transpiled and evaluated
        const output = transpile(input);
        const use = new Function(`${output}; return use;`)();
        // Then: the enum object exists and the use site resolves
        expect(use).toBe(3);
    });

    test("expands exported enums under their export keyword", () => {
        // Given: an exported enum
        const input = "export enum Ex { A }";
        // When: transpiled
        const output = transpile(input);
        // Then: the export keyword is kept and the enum is expanded
        expect(output).toBe(
            'export var  Ex; (function (Ex) { Ex[Ex["A"] = 0] = "A" })(Ex || (Ex = {}));',
        );
        const Ex = new Function(
            `${output.replace("export ", "")}; return Ex;`,
        )();
        expect(Ex).toEqual({ A: 0, 0: "A" });
    });

    test("produces output that parses as valid JavaScript", () => {
        // Given: a mixed bag of erasable TypeScript
        const input = [
            "interface I { a: string }",
            "type T = I | null;",
            "export class C implements I {",
            "  x!: string;",
            "  m(a: number): number { return a as number; }",
            "}",
            "const c = new C<string>();//",
            "",
        ].join("\n");
        // When: transpiled and re-parsed as plain JS
        const output = transpile(input);
        const parsed = parseSync("input.js", output);
        // Then: oxc parses it as JavaScript without errors
        expect(output).toEqual(tsBlankSpace(input));
        expect(parsed.errors).toEqual([]);
        expect(output.length).toBe(input.length);
    });
});
