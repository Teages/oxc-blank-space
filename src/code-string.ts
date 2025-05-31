export class CodeString {
  public original: string
  public current: string
  public pending: { start: number, end: number, content: string }[] = []

  private static blankChars: string[] = [' ', '\t', '\n', '\r']
  private static blank = ' '

  constructor(code: string) {
    this.original = code
    this.current = code
  }

  public getCurrent(start: number, end: number) {
    return this.current.slice(start, end)
  }

  public getOriginal(start: number, end: number) {
    return this.original.slice(start, end)
  }

  public searchPrev(target: string, start: number) {
    const index = this.current.slice(0, start).lastIndexOf(target)
    if (index === -1) {
      return null
    }

    return index
  }

  public searchNext(target: string, start: number) {
    const index = this.current.slice(start).indexOf(target)
    if (index === -1) {
      return null
    }
  }

  /** replace the content to the blank char */
  public blank(start: number, end: number) {
    const slice = this.current.slice(start, end)
    const replaced = slice.split('').map((char) => {
      return CodeString.blankChars.includes(char) ? char : CodeString.blank
    }).join('')
    this.current = this.current.slice(0, start) + replaced + this.current.slice(end)
  }

  public blankButStartWithSemicolon(start: number, end: number) {
    this.blank(start, end)
    // make the first char to be a semicolon
    this.current = `${this.current.slice(0, start)};${this.current.slice(start + 1)}`
  }

  /** rollback the content to the original */
  public rollback(start: number, end: number) {
    this.current = this.current.slice(0, start) + this.original.slice(start, end) + this.current.slice(end)
  }

  /** remove the content, but don't touch the specific */
  public removeButKeep(start: number, end: number, keepStart: number, keepEnd: number) {
    // Remove content before the keep range
    if (start < keepStart) {
      this.blank(start, keepStart)
    }

    // Remove content after the keep range
    if (keepEnd < end) {
      this.blank(keepEnd, end)
    }
  }

  /** add a pending overwrite, with the content will be applied in the end */
  public overwrite(start: number, end: number, content: string) {
    this.pending.push({ start, end, content })
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
