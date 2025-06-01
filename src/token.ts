import * as ts from 'typescript'

export interface TokenWalkResult {
  kind: ts.SyntaxKind
  start: number
  end: number
}

const scanner = ts.createScanner(ts.ScriptTarget.ESNext, true, ts.LanguageVariant.Standard)
export function* walkTokens(code: string): Generator<TokenWalkResult> {
  scanner.setText(code)
  scanner.resetTokenState(0)

  scanner.scan() // skip first token
  while (scanner.getToken() !== ts.SyntaxKind.EndOfFileToken) {
    yield {
      kind: scanner.getToken(),
      start: scanner.getTokenStart(),
      end: scanner.getTokenEnd(),
    }
    scanner.scan()
  }
}

export function firstToken(code: string): TokenWalkResult | null {
  const walker = walkTokens(code)
  return walker.next().value
}

export function lastToken(code: string): TokenWalkResult | null {
  const walker = walkTokens(code)
  let res: TokenWalkResult | null = null
  for (const token of walker) {
    res = token
  }
  return res
}
