const REPLACE_WITH_OPEN_PAREN = 1
const REPLACE_WITH_CLOSE_PAREN = 2
const REPLACE_WITH_SEMI = 3
const REPLACE_WITH_TEXT = 4

function getSpace(input: string, start: number, end: number): string {
  let out = ''
  for (let i = start; i < end; i++) {
    const charCode = input.charCodeAt(i)
    switch (charCode) {
      case 10 /* \n */:
        out += '\n'
        break
      case 13 /* \r */:
        out += '\r'
        break
      default:
        out += ' '
    }
  }
  return out
}

/**
 * Like magic-string but with only two features: blanking ranges (preserving
 * newlines so line/column numbers stay stable) and overwriting ranges with
 * literal text (may change the output length, used for enum expansion and
 * grouping parens).
 */
export default class BlankString {
  private readonly input: string
  /** Flat [flags, start, end, textIndex] tuples, pushed in source order. */
  private readonly ranges: number[] = []
  private readonly texts: string[] = []

  constructor(input: string) {
    this.input = input
  }

  /** Replace [start, end) with `text`; `end` may equal `start` to insert. */
  override(start: number, end: number, text: string): void {
    this.texts.push(text)
    this.ranges.push(REPLACE_WITH_TEXT, start, end, this.texts.length - 1)
  }

  blankButStartWithOpenParen(start: number, end: number): void {
    this.ranges.push(REPLACE_WITH_OPEN_PAREN, start, end, -1)
  }

  blankButEndWithCloseParen(start: number, end: number): void {
    this.ranges.push(0, start, end - 1, -1)
    this.ranges.push(REPLACE_WITH_CLOSE_PAREN, end - 1, end, -1)
  }

  blankButStartWithSemi(start: number, end: number): void {
    this.ranges.push(REPLACE_WITH_SEMI, start, end, -1)
  }

  blank(start: number, end: number): void {
    this.ranges.push(0, start, end, -1)
  }

  toString(): string {
    const ranges = this.ranges
    const input = this.input
    if (ranges.length === 0) {
      return input
    }

    let out = ''
    let previousEnd = 0
    const max = Math.max

    for (let i = 0; i < ranges.length; i += 4) {
      const flags = ranges[i] as number
      let rangeStart = ranges[i + 1] as number
      const rangeEnd = ranges[i + 2] as number
      const textIndex = ranges[i + 3] as number

      rangeStart = max(rangeStart, previousEnd)
      out += input.slice(previousEnd, rangeStart)

      if (flags === REPLACE_WITH_TEXT) {
        out += this.texts[textIndex]
      }
      else if (flags === REPLACE_WITH_CLOSE_PAREN) {
        out += ')'
        rangeStart += 1
      }
      else if (flags === REPLACE_WITH_SEMI) {
        out += ';'
        rangeStart += 1
      }
      else if (flags === REPLACE_WITH_OPEN_PAREN) {
        out += '('
        rangeStart += 1
      }

      previousEnd = rangeEnd
      if (flags !== REPLACE_WITH_TEXT) {
        out += getSpace(input, rangeStart, previousEnd)
      }
    }

    return out + input.slice(previousEnd)
  }
}
