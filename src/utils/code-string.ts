export class CodeString {
  private original: string
  private current: string

  private pending: { start: number, end: number, content: string }[] = []

  private static blankChars: string[] = [' ', '\t', '\n', '\r']
  private static blank = ' '

  constructor(code: string) {
    this.original = code
    this.current = code
  }

  public getOriginal(start: number, end: number) {
    return this.original.slice(start, end)
  }

  public getOriginalChar(index: number) {
    return this.original[index]
  }

  public isMultiLineInRange(start: number, end: number) {
    for (let i = start; i < end; i++) {
      if (this.original[i] === '\n') {
        return true
      }
    }

    return false
  }

  public overwriteDanger(start: number, end: number, content: string) {
    this.pending.push({ start, end, content })
  }

  public override(start: number, end: number, content: string) {
    if (content.length !== end - start) {
      throw new Error('The content length should be the same as the range length')
    }

    this.current = this.current.slice(0, start) + content + this.current.slice(end)
  }

  /** replace the content to the blank char */
  public blank(start: number, end: number) {
    const slice = this.current.slice(start, end)
    const replaced = slice.split('').map((char) => {
      return CodeString.blankChars.includes(char) ? char : CodeString.blank
    }).join('')

    this.override(start, end, replaced)
  }

  public blankButStartWithSemicolon(start: number, end: number) {
    const slice = this.current.slice(start, end)
    const replaced = slice.split('').map((char, index) => {
      if (index === 0) {
        return ';'
      }

      return CodeString.blankChars.includes(char) ? char : CodeString.blank
    }).join('')

    this.override(start, end, replaced)
  }

  /** get the result */
  public toString() {
    let res = this.current

    // we will apply the pending task from the end to the start
    const pending = [...this.pending].sort((a, b) => b.start - a.start)

    let lastModified = Number.MAX_SAFE_INTEGER
    for (const { start, end, content } of pending) {
      if (start > lastModified) {
        throw new Error('Pending task should never overlap with each other')
      }
      res = res.slice(0, start) + content + res.slice(end)
      lastModified = start
    }
    return res
  }
}
