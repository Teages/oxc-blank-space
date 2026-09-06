import type { Comment } from 'oxc-parser'

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

export interface TranspileOptions {
  /**
   * Called for every unsupported construct (enums, namespaces with runtime
   * code, parameter properties, `export =`, `import x = require(...)`,
   * `<T>expr` assertions, unsafe `as` erasures). The offending source is kept
   * verbatim in the output, mirroring ts-blank-space.
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

export interface ParseArtifacts {
  readonly comments: readonly Comment[]
}

/**
 * Result of visiting a node.
 * - `js`: JavaScript was (or may have been) emitted for this node.
 * - `blanked`: the node was fully erased, it contains no runtime code.
 */
export type VisitResult = 'js' | 'blanked'

export const VISIT_JS: VisitResult = 'js'
export const VISIT_BLANKED: VisitResult = 'blanked'
