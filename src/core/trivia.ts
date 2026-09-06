import type { Comment } from 'oxc-parser'

function isWhitespaceCode(code: number): boolean {
  return code === 32
    || /* space */ code === 9
    || /* \t */ code === 10
    || /* \n */ code === 13
    || /* \r */ code === 11
    || /* \v */ code === 12
} /* \f */

export function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\w$]/.test(char)
}

/**
 * Trivia (whitespace and comment) navigation over the source text.
 *
 * The oxc AST only exposes token-anchored spans, so several erased markers
 * (`?`, `!`, modifier keywords, `implements`, the `(` moved out of multi-line
 * generic parameter lists) have to be located by scanning past trivia.
 */
export class Trivia {
  private readonly commentEndingAt: Map<number, Comment>

  constructor(
    private readonly src: string,
    comments: readonly Comment[],
  ) {
    this.commentEndingAt = new Map(comments.map(c => [c.end, c]))
  }

  /** First character offset at or after `pos` that is not trivia. */
  skipForward(pos: number, stopAtNewline = false): number {
    const src = this.src
    for (;;) {
      if (pos >= src.length) {
        return src.length
      }
      const char = src[pos]
      if (isWhitespaceCode(src.charCodeAt(pos))) {
        if (stopAtNewline && (char === '\n' || char === '\r')) {
          return pos
        }
        pos += 1
        continue
      }
      if (char === '/' && src[pos + 1] === '/') {
        const newline = src.indexOf('\n', pos)
        const carriage = src.indexOf('\r', pos)
        const end
          = newline === -1
            ? carriage
            : carriage === -1
              ? newline
              : Math.min(newline, carriage)
        if (end === -1) {
          return src.length
        }
        if (stopAtNewline) {
          return end
        }
        pos = end + 1
        continue
      }
      if (char === '/' && src[pos + 1] === '*') {
        const end = src.indexOf('*/', pos + 2)
        pos = end === -1 ? src.length : end + 2
        continue
      }
      return pos
    }
  }

  /**
   * Offset of the first non-trivia character strictly before `pos`, or `-1`
   * when `pos` is preceded only by trivia.
   */
  skipBackward(pos: number): number {
    const src = this.src
    for (;;) {
      if (pos <= 0) {
        return -1
      }
      if (isWhitespaceCode(src.charCodeAt(pos - 1))) {
        pos -= 1
        continue
      }
      const comment = this.commentEndingAt.get(pos)
      if (comment) {
        pos = comment.start
        continue
      }
      return pos - 1
    }
  }

  /** Whether [start, end) contains a line terminator. */
  spansLines(start: number, end: number): boolean {
    const src = this.src
    for (let i = start; i < end; i++) {
      if (src.charCodeAt(i) === 10 /* \n */) {
        return true
      }
    }
    return false
  }

  /**
   * Offset of the word starting at or after `pos`, together with its text.
   * `undefined` when no word follows (only trivia).
   */
  scanWord(pos: number): { start: number, word: string } | undefined {
    const start = this.skipForward(pos)
    const src = this.src
    if (!isWordChar(src[start])) {
      return undefined
    }
    let end = start
    while (isWordChar(src[end])) {
      end += 1
    }
    return { start, word: src.slice(start, end) }
  }

  /** Offset of the first non-trivia character at or after `pos`. */
  scanChar(pos: number): number {
    return this.skipForward(pos)
  }

  /**
   * Whether the node text ends with `;` or a same-line `;` immediately
   * follows it. The TypeScript AST includes trailing semicolons in statement
   * spans while oxc does not, so callers checking "did the emitted code end
   * with a semicolon" need this parity helper.
   */
  endsWithSemicolon(start: number, end: number): boolean {
    if (start < end && this.src[end - 1] === ';') {
      return true
    }
    const next = this.skipForward(end, true)
    return this.src[next] === ';'
  }
}
