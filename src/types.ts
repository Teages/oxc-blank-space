/**
 * Information about a TypeScript-only construct that has runtime semantics and
 * therefore cannot be erased. Positions are character offsets into the input.
 */
export interface UnsupportedSyntax {
  readonly type: string
  readonly start: number
  readonly end: number
}

export type OnError = (node: UnsupportedSyntax) => void

/**
 * Options accepted by {@link transpile} / {@link transpileSync}.
 *
 * Scope: for legal TS/TSX of the grammar pinned by this repository's test
 * corpus (TypeScript v6), TypeScript-only syntax is erased by replacing it
 * with whitespace at the original positions; JSX is preserved byte-for-byte
 * and still needs a JSX compiler. Type checking is out of scope. Constructs
 * with runtime semantics that cannot be erased (parameter properties,
 * `export =`, `import x = require(…)`, runtime namespaces) are kept
 * verbatim and reported through `onError`; enums are expanded in place.
 */
export interface TranspileOptions {
  /**
   * Called for every unsupported construct (namespaces with runtime code,
   * parameter properties, `export =`, `import x = require(...)`, `<T>expr`
   * assertions, unsafe `as` erasures). The offending source is kept verbatim
   * in the output, mirroring ts-blank-space. Enums are expanded in place
   * instead of being reported.
   */
  readonly onError?: OnError
  /**
   * Parse the input as `ts` (default) or `tsx`.
   */
  readonly lang?: 'ts' | 'tsx'
  /**
   * Source path quoted in the diagnostics of the `SyntaxError` thrown when
   * the input cannot be parsed. The extension also selects the parse mode
   * (a `.tsx` filename enables JSX), so `lang` is only consulted to
   * synthesize a fallback name when this is omitted.
   */
  readonly filename?: string
}
