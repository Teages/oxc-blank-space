import type {
  ArrowFunctionExpression,
  Function as FunctionNode,
  Node,
} from 'oxc-parser'
import type { Blanker } from '../core/blanker.js'
import type { VisitResult } from '../types.js'
import { VISIT_BLANKED, VISIT_JS } from '../types.js'
import { visitPattern } from './pattern.js'

type FunctionLike = FunctionNode | ArrowFunctionExpression

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\w$]/.test(char)
}

/**
 * `function f<T>(a: T) {}`, arrow functions, function expressions and
 * overload signatures. Parameters, return types and bodies are processed in
 * source order; a `this` pseudo-parameter is erased entirely.
 */
export function visitFunctionLike(
  blanker: Blanker,
  node: FunctionLike,
): VisitResult {
  if (node.type !== 'ArrowFunctionExpression' && node.body === null) {
    // Overload signature or `declare function` — erased entirely.
    if (node.declare) {
      blanker.blankStatement(node)
    }
    else {
      blanker.blankExact(node)
    }
    return VISIT_BLANKED
  }

  if (node.id) {
    blanker.visitNested(node.id)
  }

  let openParen = -1
  const typeParameters = node.typeParameters
  if (typeParameters && typeParameters.params.length > 0) {
    openParen = findParamsOpenParen(blanker, node)
    blankTypeParameters(blanker, typeParameters, openParen)
  }

  const params = node.params
  for (let i = 0; i < params.length; i++) {
    const parameter = params[i] as Node
    if (
      i === 0
      && parameter.type === 'Identifier'
      && parameter.name === 'this'
    ) {
      blanker.blankExactAndOptionalTrailingComma(parameter)
      continue
    }
    visitPattern(blanker, parameter)
  }

  const returnType = node.returnType
  if (returnType) {
    if (openParen < 0) {
      openParen = findParamsOpenParen(blanker, node)
    }
    if (
      node.type === 'ArrowFunctionExpression'
      && arrowReturnTypeSpansLines(blanker, node, openParen)
    ) {
      // Danger! A newline between the parameters and `=>` would make the
      // output an invalid arrow function, so move the `)` next to `=>`.
      const closingParen = findClosingParen(blanker, node, openParen)
      if (closingParen >= 0) {
        blanker.output.blankButEndWithCloseParen(
          closingParen,
          returnType.end,
        )
        visitBody(blanker, node)
        return VISIT_JS
      }
    }
    blanker.blankRange(returnType.start, returnType.end)
  }

  visitBody(blanker, node)
  return VISIT_JS
}

/**
 * Erase a `<T>` span; when it spans lines before the parameter list, start the
 * blank with `(` and blank the original `(` so the parens stay balanced on the
 * first line.
 */
export function blankTypeParameters(
  blanker: Blanker,
  typeParameters: Node,
  openParen: number,
): void {
  if (
    openParen >= 0
    && blanker.trivia.spansLines(typeParameters.start + 1, openParen + 1)
  ) {
    blanker.output.blankButStartWithOpenParen(
      typeParameters.start,
      typeParameters.end,
    )
    blanker.blankRange(openParen, openParen + 1)
  }
  else {
    blanker.blankRange(typeParameters.start, typeParameters.end)
  }
}

function visitBody(blanker: Blanker, node: FunctionLike): void {
  const body = node.body
  if (body && body.type === 'BlockStatement') {
    blanker.visitNodeArray(body.body, true, true, child =>
      blanker.visitNode(child))
  }
  else if (body) {
    blanker.visitNested(body)
  }
}

function arrowReturnTypeSpansLines(
  blanker: Blanker,
  node: FunctionLike,
  openParen: number,
): boolean {
  const returnTypeEnd = node.returnType?.end ?? -1
  const lastParam = node.params[node.params.length - 1] as Node | undefined
  const paramsEnd = lastParam
    ? lastParam.end
    : openParen >= 0
      ? openParen + 1
      : node.start
  return blanker.trivia.spansLines(paramsEnd, returnTypeEnd)
}

function findParamsOpenParen(blanker: Blanker, node: FunctionLike): number {
  const { trivia, src } = blanker
  if (node.typeParameters) {
    const paren = trivia.scanChar(node.typeParameters.end)
    return src[paren] === '(' ? paren : -1
  }
  if (node.id) {
    const paren = trivia.scanChar(node.id.end)
    return src[paren] === '(' ? paren : -1
  }
  // Anonymous function or arrow: skip `async`/`function`/`*` before the `(`.
  let pos = trivia.skipForward(node.start)
  for (;;) {
    const char = src[pos]
    if (char === '(') {
      return pos
    }
    if (isWordChar(char)) {
      while (isWordChar(src[pos])) {
        pos += 1
      }
      continue
    }
    if (char === '*') {
      pos += 1
      continue
    }
    return -1
  }
}

function findClosingParen(
  blanker: Blanker,
  node: FunctionLike,
  openParen: number,
): number {
  const lastParam = node.params[node.params.length - 1] as Node | undefined
  // With no parameters, scanning starts right after the `(` like
  // TypeScript's empty NodeArray position does.
  let pos = lastParam
    ? lastParam.end
    : openParen >= 0
      ? openParen + 1
      : node.start
  // Skip the parameter-list trailing comma; only `,` or `)` can follow.
  for (;;) {
    pos = blanker.trivia.scanChar(pos)
    const char = blanker.src[pos]
    if (char === ')') {
      return pos
    }
    if (char === ',') {
      pos += 1
      continue
    }
    return -1
  }
}
