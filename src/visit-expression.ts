import type {
  CallExpression,
  NewExpression,
  Node,
  TaggedTemplateExpression,
} from 'oxc-parser'
import type { Blanker } from './core/blanker.js'
import type { VisitResult } from './types.js'
import {
  getBinaryOperatorPrecedence,
  hasUnsafeNullishLogicalMix,
  nextOperatorAfter,
} from './core/precedence.js'
import { VISIT_JS } from './types.js'

type Assertion = Extract<
  Node,
  { type: 'TSAsExpression' | 'TSSatisfiesExpression' }
>

function isAssertion(node: Node): node is Assertion {
  return node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression'
}

export function visitCallOrNew(
  blanker: Blanker,
  node: CallExpression | NewExpression,
): VisitResult {
  blanker.visitNested(node.callee)
  if (node.typeArguments) {
    blanker.blankRange(node.typeArguments.start, node.typeArguments.end)
  }
  for (const argument of node.arguments) {
    blanker.visitNested(argument)
  }
  return VISIT_JS
}

export function visitTaggedTemplate(
  blanker: Blanker,
  node: TaggedTemplateExpression,
): VisitResult {
  blanker.visitNested(node.tag)
  if (node.typeArguments) {
    blanker.blankRange(node.typeArguments.start, node.typeArguments.end)
  }
  blanker.visitNested(node.quasi)
  return VISIT_JS
}

export function visitNonNullExpression(
  blanker: Blanker,
  node: Extract<Node, { type: 'TSNonNullExpression' }>,
): VisitResult {
  blanker.visitNested(node.expression)
  blanker.blankRange(node.end - 1, node.end)
  return VISIT_JS
}

/**
 * `expr as T` / `expr satisfies T`. When the assertion ends the enclosing
 * statement without a trailing `;`, the blank starts with a `;` so that a
 * following `(`- or `[`-headed statement cannot merge into the expression.
 */
export function visitTypeAssertion(
  blanker: Blanker,
  node: Assertion,
): VisitResult {
  if (assertionChainWouldChangeBinaryGrouping(blanker, node)) {
    blanker.report(node)
    return VISIT_JS
  }

  const result = blanker.visitNested(node.expression)
  const nodeEnd = node.end
  if (
    blanker.parentStatement
    && nodeEnd === blanker.parentStatement.end
    && blanker.src[nodeEnd] !== ';'
  ) {
    blanker.output.blankButStartWithSemi(node.expression.end, nodeEnd)
  }
  else {
    blanker.blankRange(node.expression.end, nodeEnd)
  }
  return result
}

/**
 * Detect if erasing a type assertion would result in a runtime syntax error due
 * to changed operator grouping. e.g. In `1 + 1 as T / 2` erasing `as T` would
 * rebind the `/` onto `(1 + 1)` which TypeScript would not allow silently.
 */
function assertionChainWouldChangeBinaryGrouping(
  blanker: Blanker,
  node: Assertion,
): boolean {
  let baseExpr: Node = node.expression
  while (
    baseExpr.type === 'TSAsExpression'
    || baseExpr.type === 'TSSatisfiesExpression'
  ) {
    baseExpr = baseExpr.expression
  }

  if (baseExpr.type !== 'BinaryExpression') {
    return false
  }

  const nextToken = nextOperatorAfter(blanker.src, blanker.trivia, node.end)
  const basePrecedence = getBinaryOperatorPrecedence(baseExpr.operator)
  const nextPrecedence
    = nextToken === undefined
      ? undefined
      : getBinaryOperatorPrecedence(nextToken)
  if (basePrecedence === undefined || nextPrecedence === undefined) {
    return false
  }

  if (nextPrecedence > basePrecedence) {
    return true // higher next precedence is unsafe, the grouping would change
  }

  if (nextPrecedence === basePrecedence) {
    // Exponentiation is unsafe as it is right-associative. `(2 ** 2) ** 3` !== `2 ** 2 ** 3`.
    return baseExpr.operator === '**' || nextToken === '**'
  }

  return false
}

/**
 * Detect cases where erasing an assertion inside a logical chain would produce
 * a syntax error because `??` may not be mixed with `||`/`&&` unparenthesized.
 * e.g. `a ?? b as T && c` parses as `??[a, &&[as[b, T], c]]` and erasing the
 * assertion would leave `a ?? b && c`.
 */
export function visitLogicalExpression(
  blanker: Blanker,
  node: Extract<Node, { type: 'LogicalExpression' }>,
): VisitResult {
  const { operator, left, right } = node
  if (
    right.type === 'LogicalExpression'
    && hasUnsafeNullishLogicalMix(operator, right.operator)
    && isAssertion(right.left)
  ) {
    blanker.visitNested(left)
    blanker.report(right.left)
    blanker.visitNested(right.right)
    return VISIT_JS
  }
  if (
    left.type === 'LogicalExpression'
    && hasUnsafeNullishLogicalMix(operator, left.operator)
    && isAssertion(left.right)
  ) {
    blanker.visitNested(left.left)
    blanker.report(left.right)
    blanker.visitNested(right)
    return VISIT_JS
  }
  blanker.visitNested(left)
  blanker.visitNested(right)
  return VISIT_JS
}

export function visitTypeAssertionStatement(
  blanker: Blanker,
  node: Extract<Node, { type: 'TSTypeAssertion' }>,
): VisitResult {
  blanker.report(node)
  return blanker.visitNested(node.expression)
}
