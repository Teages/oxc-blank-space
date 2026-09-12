/**
 * The vendored tsx corpus: syntactic case files selected from the official
 * TypeScript conformance suite (tests/cases/conformance/jsx, pinned to
 * v6.0.3 — the version this repository's `typescript` devDependency tracks).
 * Files are © Microsoft Corporation, Apache-2.0-licensed, vendored
 * verbatim (see fixture/tsx-corpus/LICENSE); the
 * TypeScript test directives they open with are inert comments here.
 *
 * Selection: 70 of the suite's 195 files. The ~125 exclusions are all
 * type-checking-oriented suites — attribute/element/spread/default-props
 * resolution, children-as-prop checks, dynamic tag names, component and
 * union/overload type inference, managed attributes, strict-null emit
 * variants — whose semantics live in the type checker (out of scope), plus
 * the `inline/`/`jsxs/` jsx-runtime emit directories and two ambient-module
 * emit files already covered by the kept-verbatim rows.
 *
 * Every erasure row asserts the committed expected output
 * (expected/<base>.js), byte-identical text fidelity outside erased regions,
 * and the pinned report set. `refParity` adds the ts-blank-space TSX
 * reference as an auxiliary check. `pureJsxOutput` marks files whose output
 * parses as plain JSX with zero oxc diagnostics; files that keep reported
 * constructs (import-equals, namespaces) or carry input-inherent
 * soft-recovery diagnostics — jsxParsingError1, and unicodeEscapesInJsxtags
 * where tsc/tsgo reject tag-name escapes outright while oxc only fails the
 * mismatched closing pairs — pin their exact `.jsx` diagnostic count via
 * `jsxModeDiagnostics` so it cannot drift silently. parse-error rows must be
 * rejected with a SyntaxError.
 */

export interface CorpusRow {
  readonly file: string
  readonly kind?: 'parse-error'
  /** ts-blank-space TSX reference agrees with the expected output */
  readonly refParity?: boolean
  /** whether the blanked output parses as plain JSX with zero diagnostics */
  readonly pureJsxOutput?: boolean
  /** pinned .jsx diagnostic count when pureJsxOutput is false */
  readonly jsxModeDiagnostics?: number
  /** comma-separated unsupported-construct types kept verbatim in the file */
  readonly reports?: string
}

export const corpus: readonly CorpusRow[] = [
  { file: 'checkJsxNamespaceNamesQuestionableForms.tsx', kind: 'parse-error' },
  { file: 'commentEmittingInPreserveJsx1.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'jsxAndTypeAssertion.tsx', kind: 'parse-error' },
  { file: 'jsxAttributeInitializer.ts', kind: 'parse-error' },
  { file: 'jsxEsprimaFbTestSuite.tsx', kind: 'parse-error' },
  { file: 'jsxInvalidEsprimaTestSuite.tsx', kind: 'parse-error' },
  { file: 'jsxParsingError1.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1 },
  { file: 'jsxParsingError2.tsx', kind: 'parse-error' },
  { file: 'jsxParsingError3.tsx', kind: 'parse-error' },
  { file: 'jsxParsingError4.tsx', refParity: true, pureJsxOutput: true },
  { file: 'jsxReactTestSuite.tsx', refParity: true, pureJsxOutput: true },
  { file: 'jsxUnclosedParserRecovery.ts', kind: 'parse-error' },
  { file: 'tsxCorrectlyParseLessThanComparison1.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxEmit1.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxEmit2.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxEmit3.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSModuleDeclaration,TSModuleDeclaration,TSModuleDeclaration,TSModuleDeclaration' },
  { file: 'tsxEmitSpreadAttribute.ts', refParity: true, pureJsxOutput: true },
  { file: 'tsxErrorRecovery1.tsx', kind: 'parse-error' },
  { file: 'tsxErrorRecovery2.tsx', kind: 'parse-error' },
  { file: 'tsxErrorRecovery3.tsx', kind: 'parse-error' },
  { file: 'tsxFragmentErrors.tsx', kind: 'parse-error' },
  { file: 'tsxFragmentPreserveEmit.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxFragmentReactEmit.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxGenericArrowFunctionParsing.tsx', kind: 'parse-error' },
  { file: 'tsxGenericAttributesType1.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxGenericAttributesType2.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxGenericAttributesType3.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxGenericAttributesType4.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxGenericAttributesType5.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxGenericAttributesType6.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxGenericAttributesType7.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxGenericAttributesType8.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxGenericAttributesType9.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxInArrowFunction.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxNamespacedAttributeName1.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxNamespacedAttributeName2.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxNamespacedTagName1.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxNamespacedTagName2.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxNoJsx.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxOpeningClosingNames.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxParseTests1.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxParseTests2.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxPreserveEmit1.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 4, reports: 'TSImportEqualsDeclaration,TSImportEqualsDeclaration,TSImportEqualsDeclaration,TSModuleDeclaration,TSModuleDeclaration' },
  { file: 'tsxPreserveEmit2.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxPreserveEmit3.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactComponentWithDefaultTypeParameter1.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxReactComponentWithDefaultTypeParameter2.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxReactComponentWithDefaultTypeParameter3.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxReactEmit1.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmit2.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmit3.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmit4.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmit5.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmit6.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSModuleDeclaration,TSModuleDeclaration' },
  { file: 'tsxReactEmit7.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmit8.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmitEntities.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmitNesting.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmitSpreadAttribute.ts', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmitWhitespace.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxReactEmitWhitespace2.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxSpreadChildren.tsx', refParity: true, pureJsxOutput: true },
  { file: 'tsxStatelessFunctionComponentsWithTypeArguments1.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxStatelessFunctionComponentsWithTypeArguments2.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxStatelessFunctionComponentsWithTypeArguments3.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxStatelessFunctionComponentsWithTypeArguments4.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxStatelessFunctionComponentsWithTypeArguments5.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxTypeArgumentResolution.tsx', refParity: false, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'tsxTypeArgumentsJsxPreserveOutput.tsx', refParity: false, pureJsxOutput: false, jsxModeDiagnostics: 1, reports: 'TSImportEqualsDeclaration' },
  { file: 'unicodeEscapesInJsxtags.tsx', refParity: true, pureJsxOutput: false, jsxModeDiagnostics: 6 },
]
