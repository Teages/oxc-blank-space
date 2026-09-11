import type { TranspileOptions } from '../src/index'

/**
 * The tsx support matrix: one row per syntax case, grouped by category.
 *
 * Three assertion layers run per row (see test/tsx.test.ts):
 * 1. the output equals this file's independently written `expected`;
 * 2. the output parses as plain JSX (byte-identical .jsx round trip);
 * 3. outside erased regions the output is byte-identical to the input
 *    (equal length, every differing character is a space).
 *
 * `ref: true` adds the ts-blank-space TSX reference as an auxiliary check —
 * it must agree with `expected` — while `ref: false` marks a documented
 * divergence (JSX type arguments and enum expansion). `runtime: true` adds
 * the TypeScript-compiler equivalence layer from test/tsx-runtime.ts.
 */

export type Category
  = | 'tags-attributes'
    | 'children'
    | 'ts-jsx-combos'
    | 'fidelity'
    | 'errors-unsupported'
    | 'runtime'

export interface ExpectedReport {
  readonly type: string
  /** the exact input slice the report must point at */
  readonly slice: string
}

interface ErasureCase {
  readonly kind: 'erasure'
  readonly id: string
  readonly category: Category
  readonly input: string
  readonly expected: string | { readonly contains: readonly string[] }
  readonly ref?: boolean
  readonly runtime?: boolean
  /** set false when the output legitimately differs in length (enum expansion) */
  readonly fidelity?: boolean
  /**
   * pinned count of .jsx-mode parse diagnostics in the output. Omitted for
   * clean output (zero diagnostics enforced); set for rows whose output
   * carries input-inherent soft-recovery diagnostics (e.g. mismatched tags
   * pass through).
   */
  readonly jsxParseDiagnostics?: number
}

interface ParseErrorCase {
  readonly kind: 'parse-error'
  readonly id: string
  readonly category: Category
  readonly input: string
  readonly options?: TranspileOptions
  readonly messagePattern: RegExp
}

interface UnsupportedCase {
  readonly kind: 'unsupported'
  readonly id: string
  readonly category: Category
  readonly input: string
  readonly options?: TranspileOptions
  readonly expected: string
  readonly reports: readonly ExpectedReport[]
}

export type TsxCase = ErasureCase | ParseErrorCase | UnsupportedCase

const lone = String.fromCharCode(0xD800)

export const cases: readonly TsxCase[] = [
  // --- tags & attributes -------------------------------------------------

  {
    kind: 'erasure',
    id: 'tags/member-component',
    category: 'tags-attributes',
    input: 'const el = <UI.Comp x="1"/>\n',
    expected: 'const el = <UI.Comp x="1"/>\n',
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'tags/member-component-type-arguments',
    category: 'tags-attributes',
    input: 'const el = <UI.Comp<T> x={1}/>\n',
    expected: 'const el = <UI.Comp    x={1}/>\n',
    ref: false,
  },
  {
    kind: 'erasure',
    id: 'tags/namespaced-tag-and-attribute',
    category: 'tags-attributes',
    input: 'const el = <svg:rect xlink:href="#a"/>\n',
    expected: 'const el = <svg:rect xlink:href="#a"/>\n',
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'tags/boolean-and-string-attributes',
    category: 'tags-attributes',
    input: 'const el = <input disabled title="a&amp;b"/>\n',
    expected: 'const el = <input disabled title="a&amp;b"/>\n',
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'tags/spread-attribute-with-assertion',
    category: 'tags-attributes',
    input: 'const el = <div {...(p as P)} data-n={1}/>\n',
    expected: `const el = <div {...(p${' '.repeat(5)})} data-n={1}/>\n`,
    ref: true,
  },

  // --- children -----------------------------------------------------------

  {
    kind: 'erasure',
    id: 'children/text-and-entities',
    category: 'children',
    input: 'const el = <div>a &amp; b {\'c\'}</div>\n',
    expected: 'const el = <div>a &amp; b {\'c\'}</div>\n',
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'children/comment-verbatim',
    category: 'children',
    input: 'const el = <div>{/* keep me */}t</div>\n',
    expected: 'const el = <div>{/* keep me */}t</div>\n',
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'children/empty-expression',
    category: 'children',
    input: 'const el = <div>a{}b</div>\n',
    expected: 'const el = <div>a{}b</div>\n',
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'children/spread-with-assertion',
    category: 'children',
    input: 'const el = <ul>{...items as string[]}</ul>\n',
    expected: `const el = <ul>{...items${' '.repeat(12)}}</ul>\n`,
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'children/nested-fragments',
    category: 'children',
    input: 'const el = <><>a</><>b</></>\n',
    expected: 'const el = <><>a</><>b</></>\n',
    ref: true,
  },

  // --- ts & jsx combinations ----------------------------------------------

  {
    kind: 'erasure',
    id: 'combo/assertion-and-non-null',
    category: 'ts-jsx-combos',
    input: 'const el = <div title={title as string}>{text!}</div>\n',
    expected: 'const el = <div title={title          }>{text }</div>\n',
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'combo/generic-arrow-constraint-and-default',
    category: 'ts-jsx-combos',
    input: 'const f = <T extends object = {},>(x: T): T => <b>{x}</b>\n',
    expected: `const f = ${' '.repeat(24)}(x   )    => <b>{x}</b>\n`,
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'combo/generic-call-in-container',
    category: 'ts-jsx-combos',
    input: 'const el = <div>{render<Item>(x)}</div>\n',
    expected: `const el = <div>{render${' '.repeat(6)}(x)}</div>\n`,
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'combo/instantiation-expression-in-container',
    category: 'ts-jsx-combos',
    input: 'const el = <div>{render<Item>}</div>\n',
    expected: `const el = <div>{render${' '.repeat(6)}}</div>\n`,
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'combo/generic-tagged-template-in-container',
    category: 'ts-jsx-combos',
    input: 'const el = <div>{tag<Item>`x`}</div>\n',
    expected: `const el = <div>{tag${' '.repeat(6)}\`x\`}</div>\n`,
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'combo/double-assertion-chain',
    category: 'ts-jsx-combos',
    input: 'const el = <div>{x as unknown as string}</div>\n',
    expected: `const el = <div>{x${' '.repeat(21)}}</div>\n`,
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'combo/non-null-attributes',
    category: 'ts-jsx-combos',
    input: 'const el = <Comp value={v!} onX={fn!}/>\n',
    expected: 'const el = <Comp value={v } onX={fn }/>\n',
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'combo/satisfies-attribute',
    category: 'ts-jsx-combos',
    input: 'const el = <Comp p={o satisfies P}>t</Comp>\n',
    expected: `const el = <Comp p={o${' '.repeat(12)}}>t</Comp>\n`,
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'combo/type-only-module-syntax',
    category: 'ts-jsx-combos',
    input: 'import type { A } from \'mod\'\nexport type { A }\nexport { type B } from \'mod\'\nconst el = <div a={1 as A}/>\n',
    expected: `${' '.repeat(28)}\n${' '.repeat(17)}\nexport {        } from 'mod'\nconst el = <div a={1     }/>\n`,
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'combo/type-arguments-self-closing',
    category: 'ts-jsx-combos',
    input: 'const el = <Comp<string> value={v as string}/>\n',
    expected: 'const el = <Comp         value={v          }/>\n',
    ref: false,
  },
  {
    kind: 'erasure',
    id: 'combo/type-arguments-paired',
    category: 'ts-jsx-combos',
    input: 'const el = <Comp<T> x={1}>text</Comp>\n',
    expected: 'const el = <Comp    x={1}>text</Comp>\n',
    ref: false,
  },
  {
    kind: 'erasure',
    id: 'combo/type-arguments-nested',
    category: 'ts-jsx-combos',
    input: 'const el = <Comp<Array<string>>>hi</Comp>\n',
    expected: 'const el = <Comp               >hi</Comp>\n',
    ref: false,
  },
  {
    kind: 'erasure',
    id: 'combo/type-arguments-multi-parameter',
    category: 'ts-jsx-combos',
    input: 'const el = <Comp<A, B> x={1}/>\n',
    expected: 'const el = <Comp       x={1}/>\n',
    ref: false,
  },

  // --- position & text fidelity --------------------------------------------

  {
    kind: 'erasure',
    id: 'fidelity/multi-line-type-arguments',
    category: 'fidelity',
    input: 'const el = <Comp<\n  string,\n  number\n> x={1}/>\n',
    expected: 'const el = <Comp \n         \n        \n  x={1}/>\n',
    ref: false,
  },
  {
    kind: 'erasure',
    id: 'fidelity/crlf-line-endings',
    category: 'fidelity',
    input: 'const a: number = 1\r\nconst el = <div>{v as string}</div>\r\n',
    expected: 'const a         = 1\r\nconst el = <div>{v          }</div>\r\n',
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'fidelity/unicode-content',
    category: 'fidelity',
    input: 'const s: string = \'文\'\nconst el = <div title={s as string}>😀</div>\n',
    expected: `const s${' '.repeat(8)} = '文'\nconst el = <div title={s${' '.repeat(10)}}>😀</div>\n`,
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'fidelity/lone-surrogate-utf16-path',
    category: 'fidelity',
    input: `const el = <div title={"${lone}" as string}/>\n`,
    expected: `const el = <div title={"${lone}"          }/>\n`,
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'fidelity/leading-bom',
    category: 'fidelity',
    input: '\uFEFFconst a: number = 1\nconst el = <div>{v as string}</div>\n',
    expected: '\uFEFFconst a         = 1\nconst el = <div>{v          }</div>\n',
    ref: true,
  },
  {
    kind: 'erasure',
    id: 'fidelity/positions-across-lines',
    category: 'fidelity',
    input: 'const f = <T,>(x: T): T => (\n  <b title={x as T}>{x}</b>\n)\n',
    expected: `const f = ${' '.repeat(4)}(x   )    => (\n  <b title={x${' '.repeat(5)}}>{x}</b>\n)\n`,
    ref: true,
  },

  // --- parse errors & unsupported constructs -------------------------------

  {
    kind: 'erasure',
    id: 'errors/mismatched-tags-soft-recovery',
    category: 'errors-unsupported',
    input: 'const el = <div></span>\n',
    expected: 'const el = <div></span>\n',
    // oxc recovers the mismatched closing tag as a soft parse error, so —
    // exactly like the diagnostics-ignoring ts-blank-space reference — the
    // input passes through verbatim instead of throwing. The output carries
    // that soft diagnostic into .jsx mode; the count is pinned.
    ref: true,
    jsxParseDiagnostics: 1,
  },
  {
    kind: 'parse-error',
    id: 'errors/incomplete-expression-container',
    category: 'errors-unsupported',
    input: 'const el = <div>{x</div>\n',
    options: { lang: 'tsx' },
    messagePattern: /failed to parse input\.tsx/,
  },
  {
    kind: 'parse-error',
    id: 'errors/angle-bracket-assertion-in-tsx',
    category: 'errors-unsupported',
    input: 'const x = <T>foo;\n',
    options: { lang: 'tsx' },
    messagePattern: /failed to parse input\.tsx/,
  },
  {
    kind: 'parse-error',
    id: 'errors/ambiguous-generic-arrow',
    category: 'errors-unsupported',
    input: 'const f = <T>(x: T): T => x\n',
    options: { lang: 'tsx' },
    messagePattern: /failed to parse input\.tsx/,
  },
  {
    kind: 'parse-error',
    id: 'errors/jsx-under-default-ts-mode',
    category: 'errors-unsupported',
    input: 'const el = <div>{n}</div>\n',
    messagePattern: /failed to parse input\.ts/,
  },
  {
    kind: 'parse-error',
    id: 'errors/diagnostic-quotes-synthesized-name',
    category: 'errors-unsupported',
    input: 'const x: = 1',
    options: { lang: 'tsx' },
    messagePattern: /input\.tsx/,
  },
  {
    kind: 'parse-error',
    id: 'errors/filename-precedes-lang',
    category: 'errors-unsupported',
    input: 'const el = <div/>\n',
    options: { lang: 'tsx', filename: 'app.ts' },
    messagePattern: /app\.ts/,
  },
  {
    kind: 'parse-error',
    id: 'errors/single-letter-element-raw-gt',
    category: 'errors-unsupported',
    input: 'const a = <T>() => {}</T>;\n',
    options: { lang: 'tsx' },
    messagePattern: /failed to parse input\.tsx/,
    // every parser — tsc 6, tsgo 7.0.2 and oxc alike — reads this as a JSX
    // element and rejects the raw `>` of `=>` in its text children
    // (tsc TS1382; the same wording from oxc; see
    // tests/cases/conformance/jsx/tsxGenericArrowFunctionParsing.tsx in
    // v6.0.3). The difference is recovery only: tsc reports and continues,
    // while oxc's recovered body stays empty for the single-statement input,
    // which trips this tool's hard parse-failure rule.
  },
  {
    kind: 'parse-error',
    id: 'errors/extends-attribute-raw-gt',
    category: 'errors-unsupported',
    input: 'const d = <T extends={true}>() => {}</T>;\nconst e = <T extends>() => {}</T>;\n',
    options: { lang: 'tsx' },
    messagePattern: /failed to parse input\.tsx/,
    // same agreement as above: tsc 6, tsgo 7.0.2 and oxc all read
    // `extends={true}`/`extends` as JSX attributes and reject the raw `>`
    // (tsc TS1382, identical positions)
  },

  {
    kind: 'unsupported',
    id: 'unsupported/parameter-property-after-jsx',
    options: { lang: 'tsx' },
    category: 'errors-unsupported',
    input: 'const el = <div/>\nclass C { constructor(private p: string) {} }\n',
    expected: 'const el = <div/>\nclass C { constructor(private p        ) {} }\n',
    reports: [{ type: 'TSParameterProperty', slice: 'private p: string' }],
  },
  {
    kind: 'unsupported',
    id: 'unsupported/export-assignment-before-jsx',
    options: { lang: 'tsx' },
    category: 'errors-unsupported',
    input: 'export = foo;\nconst el = <div/>\n',
    expected: 'export = foo;\nconst el = <div/>\n',
    reports: [{ type: 'TSExportAssignment', slice: 'export = foo;' }],
  },
  {
    kind: 'unsupported',
    id: 'unsupported/import-equals-after-jsx',
    options: { lang: 'tsx' },
    category: 'errors-unsupported',
    input: 'const el = <div/>\nimport x = require(\'y\');\n',
    expected: 'const el = <div/>\nimport x = require(\'y\');\n',
    reports: [{ type: 'TSImportEqualsDeclaration', slice: 'import x = require(\'y\');' }],
  },
  {
    kind: 'unsupported',
    id: 'unsupported/runtime-namespace-kept-with-slice',
    category: 'errors-unsupported',
    input: 'const el = <div/>\nnamespace Auth { export const token = 1 }\n',
    options: { lang: 'tsx' },
    expected: 'const el = <div/>\nnamespace Auth { export const token = 1 }\n',
    reports: [{ type: 'TSModuleDeclaration', slice: 'namespace Auth { export const token = 1 }' }],
  },
  {
    kind: 'unsupported',
    id: 'unsupported/bom-prefixed-report-offsets',
    category: 'errors-unsupported',
    input: '\uFEFFexport = foo;\nconst el = <div/>\n',
    options: { lang: 'tsx' },
    expected: '\uFEFFexport = foo;\nconst el = <div/>\n',
    // the leading BOM routes the input through the UTF-16 entries; the
    // report offsets must still slice the offending source exactly
    reports: [{ type: 'TSExportAssignment', slice: 'export = foo;' }],
  },
  {
    kind: 'unsupported',
    id: 'unsupported/angle-bracket-assertion-kept-in-ts-mode',
    category: 'errors-unsupported',
    input: 'const x = <T>foo;\n',
    expected: 'const x = <T>foo;\n',
    reports: [{ type: 'TSTypeAssertion', slice: '<T>foo' }],
  },

  // --- runtime combinations (TypeScript-compiler equivalence layer) ---------

  {
    kind: 'erasure',
    id: 'runtime/attribute-evaluation-order',
    category: 'runtime',
    input: 'const el = <progress a={log(\'a\')} b={log(\'b\')}/>\n',
    expected: 'const el = <progress a={log(\'a\')} b={log(\'b\')}/>\n',
    ref: true,
    runtime: true,
  },
  {
    kind: 'erasure',
    id: 'runtime/child-evaluation-order',
    category: 'runtime',
    input: 'const el = <progress>{log(\'x\')}{log(\'y\') as string}</progress>\n',
    expected: `const el = <progress>{log('x')}{log('y')${' '.repeat(10)}}</progress>\n`,
    ref: true,
    runtime: true,
  },
  {
    kind: 'erasure',
    id: 'runtime/enum-folding-in-container',
    category: 'runtime',
    input: 'enum Size { S = 1, M = Size.S + 1 }\nconst el = <progress value={Size.M as number} max={Size.M}/>\n',
    expected: 'var  Size; (function (Size) { Size[Size["S"] = 1] = "S"; Size[Size["M"] = 2] = "M" })(Size || (Size = {}));\nconst el = <progress value={Size.M          } max={Size.M}/>\n',
    ref: false,
    runtime: true,
    fidelity: false,
  },
  {
    kind: 'erasure',
    id: 'runtime/string-enum-in-attribute',
    category: 'runtime',
    input: 'enum Kind { A = \'a\' }\nconst el = <progress data-k={Kind.A as Kind}/>\n',
    expected: 'var  Kind; (function (Kind) { Kind["A"] = \'a\' })(Kind || (Kind = {}));\nconst el = <progress data-k={Kind.A        }/>\n',
    ref: false,
    runtime: true,
    fidelity: false,
  },
  {
    kind: 'erasure',
    id: 'runtime/block-scoped-enum-shadowing',
    category: 'runtime',
    input: 'const Kind = \'outer\'\nlet el: string = \'\'\n{\n  enum Kind { X = 2 }\n  el = <progress data-k={Kind.X as number}/>\n}\n',
    expected: {
      contains: [
        'Kind["X"] = 2',
        '<progress data-k={Kind.X',
        'const Kind = \'outer\'',
      ],
    },
    ref: false,
    runtime: true,
    fidelity: false,
  },
]
