import type { TranspileOptions } from './types'
import { parseSync } from 'oxc-parser'
import { blankProgram } from './visitor/walk'

export type { OnError, TranspileOptions, UnsupportedSyntax } from './types'

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
 * properties, `export =`, `import x = require(...)` and `<T>expr` assertions)
 * cannot be blanked: they are kept verbatim and reported through
 * `options.onError`. Inputs that are not valid TypeScript — including `as`/
 * `satisfies` erasures that would change operator grouping, which TypeScript
 * itself rejects — throw a `SyntaxError`.
 */
export function transpile(
  input: string,
  options: TranspileOptions = {},
): string {
  const filename
    = options.filename ?? (options.lang === 'tsx' ? 'input.tsx' : 'input.ts')
  const parsed = parseSync(filename, input, { sourceType: 'module' })

  // Hard parse failures leave no usable AST: the input is not valid
  // TypeScript, so surface it as a syntax error rather than silently
  // passing TypeScript through as if it were JavaScript. (Soft parse
  // errors still produce a recovered AST, which we process like
  // ts-blank-space does for TypeScript's recovered trees.)
  if (parsed.program.body.length === 0 && parsed.errors.length > 0) {
    const details = parsed.errors
      .map(error => error.codeframe || error.message)
      .join('\n')
    throw new SyntaxError(`failed to parse ${filename}:\n${details}`)
  }

  return blankProgram(
    parsed.program,
    input,
    parsed.comments,
    options.onError,
  )
}
