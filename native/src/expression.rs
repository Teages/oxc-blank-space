//! Port of `src/visitor/expression.ts`.

use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};

use crate::precedence::has_unsafe_nullish_logical_mix;
use crate::walk::{VisitResult, Walker, argument_index};

pub(crate) fn visit_call_or_new<'a>(
    w: &mut Walker<'a>,
    callee: &'a Expression<'a>,
    type_arguments: Option<&'a TSTypeParameterInstantiation<'a>>,
    arguments: &'a [Argument<'a>],
) -> VisitResult {
    w.visit_nested_expr(callee);
    if let Some(ta) = type_arguments {
        w.blanker.blank_span(ta.span());
    }
    for argument in arguments {
        let idx = argument_index(argument);
        w.visit_nested(idx);
    }
    VisitResult::Js
}

pub(crate) fn visit_tagged_template<'a>(
    w: &mut Walker<'a>,
    node: &'a TaggedTemplateExpression<'a>,
) -> VisitResult {
    w.visit_nested_expr(&node.tag);
    if let Some(ta) = &node.type_arguments {
        w.blanker.blank_span(ta.span());
    }
    let quasi = node_index!(node.quasi);
    w.visit_nested(quasi);
    VisitResult::Js
}

pub(crate) fn visit_non_null_expression<'a>(
    w: &mut Walker<'a>,
    node: &'a TSNonNullExpression<'a>,
) -> VisitResult {
    let result = w.visit_nested_expr(&node.expression);
    let span = node.span();
    w.blanker.blank_range(span.end - 1, span.end);
    result
}

/// `expr as T` / `expr satisfies T`. When the assertion ends the enclosing
/// statement without a trailing `;`, the blank starts with a `;` so that a
/// following `(`- or `[`-headed statement cannot merge into the expression.
pub(crate) fn visit_type_assertion<'a>(
    w: &mut Walker<'a>,
    node_span: Span,
    expression: &'a Expression<'a>,
) -> VisitResult {
    let result = w.visit_nested_expr(expression);
    let node_end = node_span.end;
    let parent_matches = w
        .parent_statement_end()
        .is_some_and(|end| node_end == end)
        && w.src_byte(node_end) != Some(b';');
    if parent_matches {
        let expression_end = expression.span().end;
        w.blanker
            .output
            .blank_but_start_with_semi(expression_end, node_end);
    } else {
        w.blanker.blank_range(expression.span().end, node_end);
    }
    result
}

/// Detect cases where erasing an assertion inside a logical chain would produce
/// a syntax error because `??` may not be mixed with `||`/`&&` unparenthesized.
/// e.g. `a ?? b as T && c` parses as `??[a, &&[as[b, T], c]]` and erasing the
/// assertion would leave `a ?? b && c`.
pub(crate) fn visit_logical_expression<'a>(
    w: &mut Walker<'a>,
    node: &'a LogicalExpression<'a>,
) -> VisitResult {
    // Whether an expression is an `as`/`satisfies` assertion.
    fn is_assertion(expr: &Expression<'_>) -> bool {
        matches!(
            expr,
            Expression::TSAsExpression(_) | Expression::TSSatisfiesExpression(_)
        )
    }

    if let Expression::LogicalExpression(right) = &node.right
        && has_unsafe_nullish_logical_mix(node.operator, right.operator)
        && is_assertion(&right.left)
    {
        w.visit_nested_expr(&node.left);
        report_assertion(w, &right.left);
        w.visit_nested_expr(&right.right);
        return VisitResult::Js;
    }
    if let Expression::LogicalExpression(left) = &node.left
        && has_unsafe_nullish_logical_mix(node.operator, left.operator)
        && is_assertion(&left.right)
    {
        w.visit_nested_expr(&left.left);
        report_assertion(w, &left.right);
        w.visit_nested_expr(&node.right);
        return VisitResult::Js;
    }
    w.visit_nested_expr(&node.left);
    w.visit_nested_expr(&node.right);
    VisitResult::Js
}

fn report_assertion(w: &mut Walker<'_>, expr: &Expression<'_>) {
    match expr {
        Expression::TSAsExpression(n) => {
            w.blanker.report("TSAsExpression", n.span());
        }
        Expression::TSSatisfiesExpression(n) => {
            w.blanker.report("TSSatisfiesExpression", n.span());
        }
        _ => unreachable!("caller checked is_assertion"),
    }
}

pub(crate) fn visit_type_assertion_statement<'a>(
    w: &mut Walker<'a>,
    node: &'a TSTypeAssertion<'a>,
) -> VisitResult {
    w.blanker.report("TSTypeAssertion", node.span());
    w.visit_nested_expr(&node.expression)
}
