import type {
  CallExpression,
  NewExpression,
  Node,
  TaggedTemplateExpression,
} from 'oxc-parser'
import type { Blanker } from '../core/blanker'
import type { VisitResult } from '../types'
import { hasUnsafeNullishLogicalMix } from '../core/precedence'
import { VISIT_JS } from '../types'

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
