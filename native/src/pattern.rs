//! Port of `src/visitor/pattern.ts`.
//!
//! In the estree view the type annotations and `?`/`!` markers hang on the
//! pattern nodes themselves; the native AST hoists them onto the pattern's
//! holder (`VariableDeclarator`, `FormalParameter`, `CatchParameter`,
//! `FormalParameterRest`). [`HeldPattern`] re-attaches those fields to the
//! pattern node so the blanking happens at exactly the point in the walk order
//! where the JS implementation emits it.

use oxc_ast::ast::*;
use oxc_span::GetSpan;

use crate::walk::{VisitResult, Walker};

/// A pattern node plus the annotation/optional fields the estree view would
/// carry on it.
#[derive(Clone, Copy)]
pub(crate) struct HeldPattern<'a, 'b> {
    pub pattern: &'b BindingPattern<'a>,
    pub type_annotation: Option<&'b TSTypeAnnotation<'a>>,
    pub optional: bool,
}

pub(crate) fn visit_variable_declarator<'a>(
    w: &mut Walker<'a>,
    node: &'a VariableDeclarator<'a>,
) -> VisitResult {
    let type_annotation = node.type_annotation.as_deref();
    if node.definite {
        let anchor = type_annotation
            .map(|t| t.span().start)
            .unwrap_or_else(|| node.id.span().end);
        w.blanker.blank_marker_char(anchor, b'!');
    }
    visit_held(
        w,
        HeldPattern {
            pattern: &node.id,
            type_annotation,
            optional: false,
        },
    );
    if let Some(init) = &node.init {
        w.visit_nested_expr(init);
    }
    VisitResult::Js
}

/// Visit a binding pattern (function parameter, catch variable, declarator id).
/// Annotations and `?`/`!` markers hanging on the pattern are erased by the
/// holder; the pattern's names and defaults stay.
pub(crate) fn visit_pattern<'a>(
    w: &mut Walker<'a>,
    pattern: &'a BindingPattern<'a>,
) -> VisitResult {
    visit_held(
        w,
        HeldPattern {
            pattern,
            type_annotation: None,
            optional: false,
        },
    )
}

/// Port of `visitPattern(node)` where `node` is the estree pattern carrying
/// `held`'s annotation and optional flag.
fn visit_held<'a>(w: &mut Walker<'a>, held: HeldPattern<'a, 'a>) -> VisitResult {
    match held.pattern {
        BindingPattern::BindingIdentifier(_) => {
            blank_own_annotation(w, held, held.pattern.span().end);
            VisitResult::Js
        }
        BindingPattern::ObjectPattern(o) => {
            for property in &o.properties {
                visit_binding_property(w, property);
            }
            if let Some(rest) = &o.rest {
                visit_pattern(w, &rest.argument);
            }
            // JS blankOwnAnnotation runs after the properties loop.
            blank_own_annotation(w, held, o.span().end);
            VisitResult::Js
        }
        BindingPattern::ArrayPattern(a) => {
            for element in a.elements.iter().flatten() {
                visit_pattern(w, element);
            }
            if let Some(rest) = &a.rest {
                visit_pattern(w, &rest.argument);
            }
            blank_own_annotation(w, held, a.span().end);
            VisitResult::Js
        }
        BindingPattern::AssignmentPattern(ap) => {
            // estree AssignmentPattern: the left side carries the holder's
            // annotation; the AssignmentPattern node itself carries only the
            // optional flag (never an annotation in binding position).
            let result = visit_held(
                w,
                HeldPattern {
                    pattern: &ap.left,
                    type_annotation: held.type_annotation,
                    optional: false,
                },
            );
            blank_own_annotation(
                w,
                HeldPattern {
                    type_annotation: None,
                    optional: held.optional,
                    pattern: held.pattern,
                },
                ap.span().end,
            );
            w.visit_nested_expr(&ap.right);
            result
        }
    }
}

/// Port of `blankOwnAnnotation`: erase the `?`/`!` marker sitting directly
/// before the annotation (or at the end of the pattern span), then the
/// annotation itself.
fn blank_own_annotation<'a, 'b>(w: &mut Walker<'a>, held: HeldPattern<'a, 'b>, node_end: u32) {
    if held.optional {
        let anchor = held
            .type_annotation
            .map(|t| t.span().start)
            .unwrap_or(node_end);
        w.blanker.blank_marker_char(anchor, b'?');
    }
    if let Some(ta) = held.type_annotation {
        w.blanker.blank_type_annotation(ta.span());
    }
}

/// estree `Property` in a binding position: `{ a: b = 1 }` or shorthand `{ a }`.
fn visit_binding_property<'a>(
    w: &mut Walker<'a>,
    property: &'a BindingProperty<'a>,
) -> VisitResult {
    let property_index = node_index!(property);
    if let Some(key_index) = w.child_with_span(property_index, property.key.span()) {
        w.visit_nested(key_index);
    }
    visit_pattern(w, &property.value)
}

/// Visit a function parameter: reports constructor parameter properties, then
/// mirrors the estree converter's shape for the parameter.
pub(crate) fn visit_formal_parameter<'a>(w: &mut Walker<'a>, param: &'a FormalParameter<'a>) {
    if param.has_modifier() {
        // Constructor parameter properties create runtime members.
        w.blanker.report("TSParameterProperty", param.span());
    }

    if let Some(init) = &param.initializer {
        // estree AssignmentPattern: left = pattern with the annotation
        // attached, right = default; the AssignmentPattern itself has no
        // annotation and never gets a marker (optional-with-default is a
        // TypeScript error).
        visit_held(
            w,
            HeldPattern {
                pattern: &param.pattern,
                type_annotation: param.type_annotation.as_deref(),
                optional: false,
            },
        );
        blank_own_annotation(
            w,
            HeldPattern {
                pattern: &param.pattern,
                type_annotation: None,
                optional: param.optional,
            },
            param.span().end,
        );
        w.visit_nested_expr(init);
    } else {
        // estree flattens the pattern with the annotation and `?` attached.
        visit_held(
            w,
            HeldPattern {
                pattern: &param.pattern,
                type_annotation: param.type_annotation.as_deref(),
                optional: param.optional,
            },
        );
    }
}
