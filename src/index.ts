import type { TranspileOptions } from './types.js'
import { parseSync } from 'oxc-parser'
import { blankProgram } from './visitor/walk.js'

export type { OnError, TranspileOptions, UnsupportedSyntax } from './types.js'

/**
 * Replace TypeScript-only syntax with whitespace, keeping the remaining
 * JavaScript byte-for-byte at its original line and column positions.
 *
 * ```
 * import { transpile } from '@teages/oxc-blank-space'
 *
 * transpile(`const a: number = 1`)
 * // 'const a         = 1'
 * ```
 *
 * Runtime TypeScript features (enums, namespaces with runtime code, parameter
 * properties, `export =`, `import x = require(...)`, `<T>expr` assertions and
 * `as` erasures that would change operator grouping) cannot be blanked: they
 * are kept verbatim and reported through `options.onError`.
 */
export function transpile(
  input: string,
  options: TranspileOptions = {},
): string {
  const filename = options.lang === 'tsx' ? 'input.tsx' : 'input.ts'
  const parsed = parseSync(filename, input, { sourceType: 'module' })

  // Hard parse failures leave no usable AST; keep the input untouched. (Soft
  // parse errors still produce a recovered AST, which we process like
  // ts-blank-space does for TypeScript's recovered trees.)
  if (parsed.program.body.length === 0 && parsed.errors.length > 0) {
    return input
  }

  return blankProgram(
    parsed.program,
    input,
    parsed.comments,
    options.onError,
  )
}
