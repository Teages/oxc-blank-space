//! Port of `src/visitor/class.ts`.

use oxc_ast::ast::*;
use oxc_ast::AstKind;
use oxc_parser::Kind;
use oxc_span::{GetSpan, Span};

use crate::function;
use crate::walk::{VisitResult, Walker};

pub(crate) fn visit_class_like<'a>(w: &mut Walker<'a>, node: &'a Class<'a>) -> VisitResult {
    // The declare check comes first: an erased class takes its decorators with
    // it, so they must not be visited (and partially kept) beforehand.
    if node.declare {
        w.blanker.blank_statement(node.span());
        return VisitResult::Blanked;
    }

    for decorator in &node.decorators {
        w.visit_nested(node_index!(decorator));
    }

    if node.r#abstract {
        blank_abstract_keyword(w, node);
    }

    if let Some(type_parameters) = &node.type_parameters
        && !type_parameters.params.is_empty()
    {
        function::blank_type_parameters(w, type_parameters, -1);
    }

    if let Some(heritage) = &node.heritage {
        w.visit_nested_expr(&heritage.expression);
        if let Some(ta) = &heritage.type_arguments {
            w.blanker.blank_span(ta.span());
        }
    }
    if !node.implements.is_empty() {
        blank_implements_clause(w, node, &node.implements);
    }

    visit_members(w, &node.body.body);
    VisitResult::Js
}

fn visit_members<'a>(w: &mut Walker<'a>, elements: &'a [ClassElement<'a>]) {
    // Port of `blanker.visitNodeArray(body.body, true, false, visitClassMember)`:
    // each member is tracked as `parentStatement` and updates the semicolon
    // state after being visited.
    let previous_parent_statement = w.parent_statement.take();
    for element in elements {
        let idx = class_element_index(element);
        w.parent_statement = Some(idx);
        let kind = w.node_kind(idx);
        if visit_class_member(w, kind) == VisitResult::Js {
            w.update_semicolon(idx);
        }
    }
    w.parent_statement = previous_parent_statement;
}

fn class_element_index(element: &ClassElement<'_>) -> u32 {
    match element {
        ClassElement::StaticBlock(n) => node_index!(n),
        ClassElement::MethodDefinition(n) => node_index!(n),
        ClassElement::PropertyDefinition(n) => node_index!(n),
        ClassElement::AccessorProperty(n) => node_index!(n),
        ClassElement::TSIndexSignature(n) => node_index!(n),
    }
}

/// Dispatch mirroring `visitClassMember`; `kind` is one of the five class
/// element kinds (other kinds are kept verbatim, mirroring the JS default arm).
pub(crate) fn visit_class_member<'a>(w: &mut Walker<'a>, kind: AstKind<'a>) -> VisitResult {
    match kind {
        AstKind::StaticBlock(n) => {
            w.visit_statement_slice(&n.body, true, false);
            VisitResult::Js
        }
        AstKind::TSIndexSignature(n) => {
            w.blanker.blank_exact(n.span());
            VisitResult::Blanked
        }
        AstKind::PropertyDefinition(n) => visit_property_definition(w, n),
        AstKind::AccessorProperty(n) => visit_accessor_property(w, n),
        AstKind::MethodDefinition(n) => visit_method_definition(w, n),
        _ => VisitResult::Js,
    }
}

/// The pieces `visitProperty` needs, shared by property definitions and
/// accessor properties (the native AST keeps them as distinct structs).
struct PropertyParts<'a> {
    member_index: u32,
    span: Span,
    /// estree type starts with `TSAbstract`, or the member is `declare`d.
    abstract_or_declare: bool,
    computed: bool,
    decorators: &'a [Decorator<'a>],
    key: &'a PropertyKey<'a>,
    type_annotation: Option<&'a TSTypeAnnotation<'a>>,
    value: Option<&'a Expression<'a>>,
    definite: bool,
    optional: bool,
}

fn visit_property<'a>(w: &mut Walker<'a>, member: PropertyParts<'a>) -> VisitResult {
    // Abstract/declare properties have no runtime behavior.
    if member.abstract_or_declare {
        w.blanker.blank_statement(member.span);
        return VisitResult::Blanked;
    }

    let key_start = member.key.span().start;
    blank_removed_member_keywords(
        w,
        member.span.start,
        key_start,
        member.decorators,
        member.computed,
    );
    if let Some(key_index) = w.child_with_span(member.member_index, member.key.span()) {
        w.visit_nested(key_index);
    }

    let anchor = member
        .type_annotation
        .map(|t| t.span().start)
        .or_else(|| member.value.map(|v| v.span().start))
        .unwrap_or(member.span.end);
    if member.definite {
        blank_marker_after_key(w, anchor, Kind::Bang);
    }
    if member.optional {
        blank_marker_after_key(w, anchor, Kind::Question);
    }

    if let Some(ta) = member.type_annotation {
        w.blanker.blank_type_annotation(ta.span());
    }
    if let Some(value) = member.value {
        w.visit_nested_expr(value);
    }
    VisitResult::Js
}

fn visit_property_definition<'a>(w: &mut Walker<'a>, member: &'a PropertyDefinition<'a>) -> VisitResult {
    let member_index = node_index!(member);
    visit_property(
        w,
        PropertyParts {
            member_index,
            span: member.span(),
            abstract_or_declare: member.r#type == PropertyDefinitionType::TSAbstractPropertyDefinition
                || member.declare,
            computed: member.computed,
            decorators: &member.decorators,
            key: &member.key,
            type_annotation: member.type_annotation.as_deref(),
            value: member.value.as_ref(),
            definite: member.definite,
            optional: member.optional,
        },
    )
}

fn visit_accessor_property<'a>(w: &mut Walker<'a>, member: &'a AccessorProperty<'a>) -> VisitResult {
    let member_index = node_index!(member);
    visit_property(
        w,
        PropertyParts {
            member_index,
            span: member.span(),
            abstract_or_declare: member.r#type == AccessorPropertyType::TSAbstractAccessorProperty,
            computed: member.computed,
            decorators: &member.decorators,
            key: &member.key,
            type_annotation: member.type_annotation.as_deref(),
            value: member.value.as_ref(),
            definite: member.definite,
            // Accessor properties cannot be optional.
            optional: false,
        },
    )
}

fn visit_method_definition<'a>(w: &mut Walker<'a>, member: &'a MethodDefinition<'a>) -> VisitResult {
    // Abstract methods and overload signatures are erased entirely.
    if member.r#type == MethodDefinitionType::TSAbstractMethodDefinition
        || member.value.body.is_none()
    {
        w.blanker.blank_exact(member.span());
        return VisitResult::Blanked;
    }

    blank_removed_member_keywords(
        w,
        member.span().start,
        member.key.span().start,
        &member.decorators,
        member.computed,
    );
    let member_index = node_index!(member);
    if let Some(key_index) = w.child_with_span(member_index, member.key.span()) {
        w.visit_nested(key_index);
    }
    if member.optional {
        blank_marker_after_key(w, member.value.span().start, Kind::Question);
    }
    // JS calls `blanker.visitNode(member.value)` — no semicolon update here.
    w.visit_node(node_index!(member.value))
}

fn blank_abstract_keyword(w: &mut Walker<'_>, node: &Class<'_>) {
    if let Some(token) = w.blanker.tokens.token_from(node.span().start)
        && token.kind() == Kind::Abstract
    {
        let span = token.span();
        w.blanker.blank_range(span.start, span.end);
    }
}

fn blank_implements_clause(
    w: &mut Walker<'_>,
    node: &Class<'_>,
    clause: &[TSClassImplements<'_>],
) {
    // Anchor after the pieces that can precede `implements`.
    let anchor = node
        .heritage
        .as_ref()
        .and_then(|h| h.type_arguments.as_ref().map(|t| t.span().end))
        .or_else(|| node.heritage.as_ref().map(|h| h.expression.span().end))
        .or_else(|| node.type_parameters.as_ref().map(|t| t.span().end))
        .or_else(|| node.id.as_ref().map(|i| i.span().end))
        .unwrap_or_else(|| node.span().start + 5);
    let Some(token) = w.blanker.tokens.token_from(anchor) else {
        return;
    };
    if token.kind() != Kind::Implements {
        return;
    }
    let last = clause.last().expect("implements clause is non-empty").span();
    w.blanker.blank_range(token.span().start, last.end);
}

fn blank_marker_after_key(w: &mut Walker<'_>, anchor: u32, marker: Kind) {
    w.blanker.blank_marker_char(anchor, marker);
}

/// Erase the TypeScript-only keywords (accessibility, `readonly`, `override`,
/// `abstract`, `declare`) in the modifier region before the member key while
/// keeping JavaScript keywords (`static`, `async`, `get`, `set`, `accessor`,
/// `*`) and decorators. oxc exposes modifiers as flags without positions, so
/// the region is tokenized: every word is classified, decorators are skipped by
/// their spans. When `add_semi` is set (computed keys, an ASI hazard), a leading
/// erased keyword is replaced by a `;` — but only when nothing (decorator or
/// kept keyword) precedes it, mirroring ts-blank-space's modifiers[0] check.
fn blank_removed_member_keywords<'a>(
    w: &mut Walker<'a>,
    member_start: u32,
    key_start: u32,
    decorators: &'a [Decorator<'a>],
    add_semi: bool,
) {
    /// Modifier keywords erased by ts-blank-space, as token kinds.
    const REMOVED: [Kind; 7] = [
        Kind::Public,
        Kind::Protected,
        Kind::Private,
        Kind::Readonly,
        Kind::Override,
        Kind::Abstract,
        Kind::Declare,
    ];

    let mut removed_count = 0;
    let mut saw_preceding_item = false;
    let mut token = w.blanker.tokens.token_from(member_start);

    while let Some(current) = token {
        if current.span().start >= key_start {
            break;
        }

        if let Some(decorator) = decorators
            .iter()
            .find(|d| d.span().start <= current.span().start && current.span().start < d.span().end)
        {
            w.visit_nested(node_index!(decorator));
            saw_preceding_item = true;
            token = w.blanker.tokens.token_from(decorator.span().end);
            continue;
        }

        let kind = current.kind();
        if REMOVED.contains(&kind) {
            let span = current.span();
            if add_semi && removed_count == 0 && !saw_preceding_item {
                w.blanker.output.blank_but_start_with_semi(span.start, span.end);
            } else {
                w.blanker.blank_range(span.start, span.end);
            }
            removed_count += 1;
            saw_preceding_item = true;
        } else if kind == Kind::Star {
            // `*` (generator) and anything unexpected stays as-is and does not
            // count as a preceding item.
        } else {
            // kept keywords (`static`, `async`, `get`, `set`, `accessor`, ...)
            // and any other word
            saw_preceding_item = true;
        }
        token = w.blanker.tokens.token_from(current.span().end);
    }
}
