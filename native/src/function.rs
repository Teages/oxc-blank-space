//! Port of `src/visitor/function.ts`.

use oxc_ast::ast::*;
use oxc_span::GetSpan;

use crate::pattern;
use crate::trivia::is_word_char;
use crate::walk::{VisitResult, Walker, statement_index};

pub(crate) fn visit_function_like<'a>(w: &mut Walker<'a>, node: &'a Function<'a>) -> VisitResult {
    if node.body.is_none() {
        // Overload signature or `declare function` — erased entirely.
        if node.declare {
            w.blanker.blank_statement(node.span());
        } else {
            w.blanker.blank_exact(node.span());
        }
        return VisitResult::Blanked;
    }

    visit_function_parts(
        w,
        node.span().start,
        node.id.as_ref(),
        node.type_parameters.as_deref(),
        node.this_param.as_deref(),
        &node.params,
        node.return_type.as_deref(),
        false,
        node.body.as_deref().map(BodyRef::Block),
    )
}

pub(crate) fn visit_arrow_function_like<'a>(
    w: &mut Walker<'a>,
    node: &'a ArrowFunctionExpression<'a>,
) -> VisitResult {
    let body = match &node.body {
        ArrowFunctionBody::FunctionBody(fb) => BodyRef::Block(fb.as_ref()),
        _ => BodyRef::Expr(
            node.body
                .as_expression()
                .expect("arrow body is block or expression"),
        ),
    };
    visit_function_parts(
        w,
        node.span().start,
        None,
        node.type_parameters.as_deref(),
        None,
        &node.params,
        node.return_type.as_deref(),
        true,
        Some(body),
    )
}

enum BodyRef<'a> {
    Block(&'a FunctionBody<'a>),
    Expr(&'a Expression<'a>),
}

#[expect(clippy::too_many_arguments)]
fn visit_function_parts<'a>(
    w: &mut Walker<'a>,
    node_start: u32,
    id: Option<&'a BindingIdentifier<'a>>,
    type_parameters: Option<&'a TSTypeParameterDeclaration<'a>>,
    this_param: Option<&'a TSThisParameter<'a>>,
    params: &'a FormalParameters<'a>,
    return_type: Option<&'a TSTypeAnnotation<'a>>,
    is_arrow: bool,
    body: Option<BodyRef<'a>>,
) -> VisitResult {
    if let Some(id) = id {
        w.visit_nested(node_index!(id));
    }

    let mut open_paren: i64 = -1;
    if let Some(tp) = type_parameters
        && !tp.params.is_empty()
    {
        open_paren = find_params_open_paren(w, type_parameters, id, node_start);
        blank_type_parameters(w, tp, open_paren);
    }

    // A `this` pseudo-parameter is erased entirely.
    if let Some(this) = this_param {
        w.blanker.blank_exact_and_optional_trailing_comma(this.span());
    }

    for item in &params.items {
        pattern::visit_formal_parameter(w, item);
    }
    // Rest parameters live in a separate field in the native AST; estree
    // appends them as the last (RestElement) parameter.
    if let Some(rest) = &params.rest {
        // estree RestElement: visitPattern(argument) then blankOwnAnnotation.
        let result = pattern::visit_pattern(w, &rest.rest.argument);
        if let Some(ta) = &rest.type_annotation {
            w.blanker.blank_type_annotation(ta.span());
        }
        let _ = result;
    }

    if let Some(rt) = return_type {
        if open_paren < 0 {
            open_paren = find_params_open_paren(w, type_parameters, id, node_start);
        }
        if is_arrow && arrow_return_type_spans_lines(w, params, rt, open_paren, node_start) {
            // Danger! A newline between the parameters and `=>` would make the
            // output an invalid arrow function, so move the `)` next to `=>`.
            let closing_paren = find_closing_paren(w, params, open_paren, node_start);
            if closing_paren >= 0 {
                w.blanker
                    .output
                    .blank_but_end_with_close_paren(closing_paren as u32, rt.span().end);
                visit_body(w, body.as_ref());
                return VisitResult::Js;
            }
        }
        w.blanker.blank_span(rt.span());
    }

    visit_body(w, body.as_ref());
    VisitResult::Js
}

fn visit_body<'a>(w: &mut Walker<'a>, body: Option<&BodyRef<'a>>) {
    match body {
        Some(BodyRef::Block(fb)) => {
            // estree's BlockStatement body has directives prepended to the
            // statements; visit the same array.
            let mut indices = Vec::with_capacity(fb.directives.len() + fb.statements.len());
            for directive in &fb.directives {
                indices.push(node_index!(directive));
            }
            for statement in &fb.statements {
                indices.push(statement_index(statement));
            }
            w.visit_node_array(&indices, true, true);
        }
        Some(BodyRef::Expr(expr)) => {
            w.visit_nested_expr(expr);
        }
        None => {}
    }
}

/// Erase a `<T>` span; when it spans lines before the parameter list, start the
/// blank with `(` and blank the original `(` so the parens stay balanced on the
/// first line.
pub(crate) fn blank_type_parameters(
    w: &mut Walker<'_>,
    type_parameters: &TSTypeParameterDeclaration<'_>,
    open_paren: i64,
) {
    let span = type_parameters.span();
    if open_paren >= 0 && w.blanker.trivia.spans_lines(span.start + 1, open_paren as u32 + 1) {
        w.blanker.output.blank_but_start_with_open_paren(span.start, span.end);
        w.blanker.blank_range(open_paren as u32, open_paren as u32 + 1);
    } else {
        w.blanker.blank_span(span);
    }
}

fn arrow_return_type_spans_lines(
    w: &Walker<'_>,
    params: &FormalParameters<'_>,
    return_type: &TSTypeAnnotation<'_>,
    open_paren: i64,
    node_start: u32,
) -> bool {
    let return_type_end = return_type.span().end;
    let params_end = last_param_end(params, open_paren, node_start);
    w.blanker.trivia.spans_lines(params_end, return_type_end)
}

/// End of the last parameter (rest included, matching the estree array), or
/// the position right after `(` / the node start when there are none.
fn last_param_end(
    params: &FormalParameters<'_>,
    open_paren: i64,
    node_start: u32,
) -> u32 {
    params
        .rest
        .as_ref()
        .map(|r| r.span().end)
        .or_else(|| params.items.last().map(|p| p.span().end))
        .unwrap_or_else(|| {
            if open_paren >= 0 {
                open_paren as u32 + 1
            } else {
                node_start
            }
        })
}

fn find_params_open_paren(
    w: &Walker<'_>,
    type_parameters: Option<&TSTypeParameterDeclaration<'_>>,
    id: Option<&BindingIdentifier<'_>>,
    node_start: u32,
) -> i64 {
    if let Some(tp) = type_parameters {
        let paren = w.blanker.trivia.scan_char(tp.span().end);
        return if w.blanker.trivia.byte_at(paren) == Some(b'(') {
            paren as i64
        } else {
            -1
        };
    }
    if let Some(id) = id {
        let paren = w.blanker.trivia.scan_char(id.span().end);
        return if w.blanker.trivia.byte_at(paren) == Some(b'(') {
            paren as i64
        } else {
            -1
        };
    }
    // Anonymous function or arrow: skip `async`/`function`/`*` before the `(`.
    let mut pos = w.blanker.trivia.skip_forward(node_start, false);
    loop {
        match w.blanker.trivia.byte_at(pos) {
            Some(b'(') => return pos as i64,
            Some(c) if is_word_char(c) => {
                while w.blanker.trivia.byte_at(pos).is_some_and(is_word_char) {
                    pos += 1;
                }
            }
            Some(b'*') => pos += 1,
            _ => return -1,
        }
    }
}

fn find_closing_paren(
    w: &Walker<'_>,
    params: &FormalParameters<'_>,
    open_paren: i64,
    node_start: u32,
) -> i64 {
    // With no parameters, scanning starts right after the `(` like
    // TypeScript's empty NodeArray position does.
    let mut pos = last_param_end(params, open_paren, node_start);
    // Skip the parameter-list trailing comma; only `,` or `)` can follow.
    loop {
        pos = w.blanker.trivia.scan_char(pos);
        match w.blanker.trivia.byte_at(pos) {
            Some(b')') => return pos as i64,
            Some(b',') => pos += 1,
            _ => return -1,
        }
    }
}
