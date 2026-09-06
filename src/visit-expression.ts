import type {
    CallExpression,
    NewExpression,
    Node,
    TaggedTemplateExpression,
} from "oxc-parser";
import type { Blanker } from "./blanker.js";
import {
    getBinaryOperatorPrecedence,
    hasUnsafeNullishLogicalMix,
    nextOperatorAfter,
} from "./precedence.js";
import { VISIT_JS, type VisitResult } from "./types.js";

type Assertion = Extract<
    Node,
    { type: "TSAsExpression" | "TSSatisfiesExpression" }
>;
type LogicalExpression = Extract<Node, { type: "LogicalExpression" }>;
type BinaryExpression = Extract<Node, { type: "BinaryExpression" }>;

const isAssertion = (node: Node): node is Assertion =>
    node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression";

/** Strip a chain of `as`/`satisfies` down to the wrapped expression. */
function stripAssertionChain(node: Node): Node {
    let current = node;
    while (isAssertion(current)) {
        current = current.expression;
    }
    return current;
}

export function visitCallOrNew(
    blanker: Blanker,
    node: CallExpression | NewExpression,
): VisitResult {
    blanker.visitNested(node.callee);
    if (node.typeArguments) {
        blanker.blankRange(node.typeArguments.start, node.typeArguments.end);
    }
    for (const argument of node.arguments) {
        blanker.visitNested(argument);
    }
    return VISIT_JS;
}

export function visitTaggedTemplate(
    blanker: Blanker,
    node: TaggedTemplateExpression,
): VisitResult {
    blanker.visitNested(node.tag);
    if (node.typeArguments) {
        blanker.blankRange(node.typeArguments.start, node.typeArguments.end);
    }
    blanker.visitNested(node.quasi);
    return VISIT_JS;
}

export function visitNonNullExpression(
    blanker: Blanker,
    node: Extract<Node, { type: "TSNonNullExpression" }>,
): VisitResult {
    blanker.visitNested(node.expression);
    blanker.blankRange(node.end - 1, node.end);
    return VISIT_JS;
}

/**
 * `expr as T` / `expr satisfies T`. When erasing the assertion would change
 * operator grouping — a following operator outranking the base expression
 * (`1 + 1 as T / 2`) — the base expression is wrapped in parentheses so the
 * output keeps the TypeScript semantics: `(1 + 1) / 2`.
 */
export function visitTypeAssertion(
    blanker: Blanker,
    node: Assertion,
): VisitResult {
    const baseExpr = stripAssertionChain(node.expression);
    if (
        baseExpr.type === "BinaryExpression" &&
        wouldChangeBinaryGrouping(blanker, node.end, baseExpr)
    ) {
        pushOpenParen(blanker, baseExpr.start);
        pushCloseParen(blanker, baseExpr.end, node.end);
    }

    const result = blanker.visitNested(node.expression);
    const nodeEnd = node.end;
    if (
        blanker.parentStatement &&
        nodeEnd === blanker.parentStatement.end &&
        blanker.src[nodeEnd] !== ";"
    ) {
        blanker.output.blankButStartWithSemi(node.expression.end, nodeEnd);
    } else {
        blanker.blankRange(node.expression.end, nodeEnd);
    }
    return result;
}

/**
 * Detect if erasing a type assertion would change the runtime semantics due to
 * operator re-grouping. e.g. In `1 + 1 as T / 2` erasing `as T` would rebind
 * the `/` onto `2` instead of onto `(1 + 1)`.
 */
function wouldChangeBinaryGrouping(
    blanker: Blanker,
    assertionEnd: number,
    baseExpr: BinaryExpression,
): boolean {
    const nextToken = nextOperatorAfter(
        blanker.src,
        blanker.trivia,
        assertionEnd,
    );
    const basePrecedence = getBinaryOperatorPrecedence(baseExpr.operator);
    const nextPrecedence =
        nextToken === undefined
            ? undefined
            : getBinaryOperatorPrecedence(nextToken);
    if (basePrecedence === undefined || nextPrecedence === undefined) {
        return false;
    }

    if (nextPrecedence > basePrecedence) {
        return true; // higher next precedence is unsafe, the grouping would change
    }

    if (nextPrecedence === basePrecedence) {
        // Exponentiation is unsafe as it is right-associative. `(2 ** 2) ** 3` !== `2 ** 2 ** 3`.
        return baseExpr.operator === "**" || nextToken === "**";
    }

    return false;
}

/**
 * Wrap the expression starting at `wrapStart` and ending at `baseEnd` in
 * parentheses. `(` is inserted at `wrapStart`; `)` is inserted at `baseEnd`
 * and consumes up to two characters after it (part of the erased ` as` span,
 * whose blank op is then clamped shorter), so the output length usually stays
 * unchanged. Newlines are never consumed; in that case the output grows by at
 * most two characters.
 *
 * Because every later op is clamped against the consumed range, callers must
 * visit children inside the wrapped region between the two pushes and
 * children after `baseEnd` after the second push.
 */
function pushOpenParen(blanker: Blanker, wrapStart: number): void {
    blanker.output.override(wrapStart, wrapStart, "(");
}

function pushCloseParen(
    blanker: Blanker,
    baseEnd: number,
    limit: number,
): void {
    let closeEnd = baseEnd;
    for (let i = 0; i < 2 && closeEnd < limit; i++) {
        const char = blanker.src[closeEnd];
        if (char === "\n" || char === "\r") break;
        closeEnd += 1;
    }
    blanker.output.override(baseEnd, closeEnd, ")");
}

/**
 * Detect cases where erasing an assertion inside a logical chain would produce
 * a syntax error because `??` may not be mixed with `||`/`&&` unparenthesized.
 * e.g. `a ?? b as T && c` parses as `??[a, &&[as[b, T], c]]` and erasing the
 * assertion would leave `a ?? b && c`; the inner logical expression is wrapped
 * so the output keeps the TypeScript semantics: `a ?? (b && c)`.
 */
export function visitLogicalExpression(
    blanker: Blanker,
    node: LogicalExpression,
): VisitResult {
    const { operator, left, right } = node;
    if (
        right.type === "LogicalExpression" &&
        hasUnsafeNullishLogicalMix(operator, right.operator) &&
        isAssertion(right.left)
    ) {
        return visitMixedLogical(blanker, node, right, right.left, true);
    }
    if (
        left.type === "LogicalExpression" &&
        hasUnsafeNullishLogicalMix(operator, left.operator) &&
        isAssertion(left.right)
    ) {
        return visitMixedLogical(blanker, node, left, left.right, false);
    }
    blanker.visitNested(left);
    blanker.visitNested(right);
    return VISIT_JS;
}

/**
 * The parse shape is `outer[operandOutside, inner[assertion, rest]]`; wrapping
 * `inner` keeps the grouping. Children are visited so their ops stay in source
 * order with the inserted parens: the operand before `inner` first, then the
 * parens, then the assertion erasure (clamped after the inserted `)`), then
 * the remaining operand.
 */
function visitMixedLogical(
    blanker: Blanker,
    node: LogicalExpression,
    inner: LogicalExpression,
    assertion: Assertion,
    innerIsRight: boolean,
): VisitResult {
    const baseExpr = stripAssertionChain(assertion);
    if (innerIsRight) {
        // `left ?? (assertion && inner.right)` — nothing of `inner` precedes
        // the assertion, so both paren pushes happen up front.
        blanker.visitNested(node.left);
        pushOpenParen(blanker, inner.start);
        pushCloseParen(blanker, baseExpr.end, inner.end);
        blanker.visitNode(assertion);
        blanker.visitNested(inner.right);
        return VISIT_JS;
    }
    // `inner.left && (assertion) ?? right` — `inner.left` lies inside the
    // parens and must be erased between the two pushes.
    pushOpenParen(blanker, inner.start);
    blanker.visitNested(inner.left);
    pushCloseParen(blanker, baseExpr.end, inner.end);
    blanker.visitNode(assertion);
    blanker.visitNested(node.right);
    return VISIT_JS;
}

export function visitTypeAssertionStatement(
    blanker: Blanker,
    node: Extract<Node, { type: "TSTypeAssertion" }>,
): VisitResult {
    blanker.report(node);
    return blanker.visitNested(node.expression);
}
