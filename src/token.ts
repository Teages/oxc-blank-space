import * as ts from 'typescript'

const scanner = ts.createScanner(ts.ScriptTarget.ESNext, true, ts.LanguageVariant.Standard)
export function* walkTokens(code: string): Generator<{ kind: ts.SyntaxKind, start: number, end: number }> {
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
