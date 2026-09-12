//! Enums have runtime behavior, so instead of being blanked they are expanded
//! in place into the same IIFE shape the TypeScript compiler emits:
//!
//! ```js
//! var  Color; (function (Color) { Color[Color["Red"] = 0] = "Red";
//! Color[Color["Green"] = 5] = "Green" })(Color || (Color = {}));
//! ```
//!
//! Surrounding text (braces, whitespace, comments between members) is kept —
//! only the keyword, the name and the members are rewritten, so the output
//! length may differ from the input. `const enum` expands the same way so
//! untouched use sites (`CE.A`) keep resolving at runtime.

use std::rc::Rc;

use oxc_ast::AstKind;
use oxc_ast::ast::*;
use oxc_parser::Kind;
use oxc_span::GetSpan;

use super::fold_string::is_string_typed;
use super::model::MemberValue;
use super::model::{DeclarationMembers, enum_group_scope, is_block_scoped};
use super::number::js_number_to_string;
use super::qualify::{QualifyContext, QualifyState, qualify_expr};
use super::text::{json_quote, json_quote_utf16, string_literal_value_units};
use crate::visit::walk::{Walker, expr_index};

pub(crate) fn expand_enum(w: &mut Walker<'_>, node: &TSEnumDeclaration<'_>) {
    let enum_index = node.node_id.get().index() as u32;
    let enum_name = node.id.name.as_str().to_string();
    let declaration_start = node.span().start;
    let key = (enum_group_scope(w, enum_index), enum_name.clone());
    let entry = w.enum_members.get(&key);

    // `let` at any container but the program — a shadowing enum must not
    // clobber the outer binding through var hoisting (mirrors tsc).
    let keyword = if is_block_scoped(w, enum_index) {
        "let "
    } else {
        "var "
    };

    // TypeScript exports a merged enum once: only the group's first exported
    // declaration keeps `export`, only the first declaration emits the binding.
    let exported = matches!(
        w.node_kind(w.parent_of(enum_index)),
        AstKind::ExportDeclaration(_)
    );
    let carries_export =
        exported && entry.and_then(|members| members.first_export_start) == Some(declaration_start);
    let is_first_declaration =
        entry.and_then(|members| members.first_declaration_start) == Some(declaration_start);

    // for `const enum` the node span starts at `const`, erased with the keyword
    let first = w.blanker.tokens.token_from(node.span().start);
    let keyword_token = match first {
        Some(token) if token.kind() == Kind::Const => w.blanker.tokens.token_from(token.span().end),
        other => other,
    };
    let Some(keyword_token) = keyword_token.filter(|token| token.kind() == Kind::Enum) else {
        w.blanker.report("TSEnumDeclaration", node.span());
        return;
    };

    if is_first_declaration {
        w.blanker
            .output
            .override_range(node.span().start, keyword_token.span().end, keyword);
        w.blanker.output.override_range(
            node.id.span().start,
            node.id.span().end,
            format!("{enum_name}; (function ({enum_name})"),
        );
    } else if carries_export {
        // a later declaration carrying the group's export: emit the binding here
        w.blanker
            .output
            .override_range(node.span().start, keyword_token.span().end, "var ");
        w.blanker.output.override_range(
            node.id.span().start,
            node.id.span().end,
            format!("{enum_name}; (function ({enum_name})"),
        );
    } else {
        // a later declaration appends only its members: the binding belongs
        // to an earlier declaration
        let head_start = if exported {
            w.node_kind(w.parent_of(enum_index)).span().start
        } else {
            node.span().start
        };
        w.blanker
            .output
            .override_range(head_start, node.id.span().start, "");
        // ASI protection: the appended IIFE starts with `(`, which would
        // continue a preceding statement lacking `;` (`const x = 1 (function
        // ...) ...`) — a leading `;` starts a fresh statement
        let separator = if w.blanker.semicolon_needed { ";" } else { "" };
        w.blanker.output.override_range(
            node.id.span().start,
            node.id.span().end,
            format!("{separator} (function ({enum_name})"),
        );
    }

    // each declaration emits once: take its records instead of cloning
    let records = w.enum_folds.remove(&enum_index).unwrap_or_default();
    // clones of the shared tables keep the mutable walk below free of
    // borrows on `w`
    let enum_table = Rc::clone(&w.enum_members);
    let const_bindings = Rc::clone(&w.const_bindings);
    let declaration = DeclarationMembers {
        shared: enum_table.get(&key),
        // qualification only checks membership, never values
        shared_group: None,
        ..Default::default()
    };

    for (member, record) in node.body.members.iter().zip(records) {
        let member_span = member.span;
        let key = member_key(w, member);
        let initializer = member.initializer.as_ref();

        match record.fold {
            Some(MemberValue::Str(value)) => {
                // String-literal members keep their raw source text (the lossy
                // parse copy would corrupt lone surrogates) and emit the plain
                // assignment shape; a folded non-literal (asserted) string
                // keeps the numeric reverse-mapping form.
                if let Some(Expression::StringLiteral(literal)) = initializer {
                    let raw_units = w.original_span_units(literal.span);
                    w.blanker.output.override_range_units(
                        member_span.start,
                        member_span.end,
                        &format!("{enum_name}[{key}] = "),
                        &raw_units,
                    );
                } else {
                    let folded = json_quote_utf16(&value.units);
                    let shape = if value.literal {
                        format!("{enum_name}[{key}] = {folded}")
                    } else {
                        format!("{enum_name}[{enum_name}[{key}] = {folded}] = {key}")
                    };
                    w.blanker
                        .output
                        .override_range(member_span.start, member_span.end, shape);
                }
            }
            Some(MemberValue::Number(value)) => {
                w.blanker.output.override_range(
                    member_span.start,
                    member_span.end,
                    format!(
                        "{enum_name}[{enum_name}[{key}] = {}] = {key}",
                        js_number_to_string(value)
                    ),
                );
            }
            None if initializer.is_some() => {
                // Non-constant initializer: erase TS-only syntax with the
                // normal walk, then qualify bare sibling references — except
                // ones an inner scope binds. A string-typed initializer keeps
                // the plain assignment shape, like the TypeScript emitter.
                let init = initializer.expect("checked is_some");
                let string_typed = is_string_typed(init);
                let head = if string_typed {
                    format!("{enum_name}[{key}] = ")
                } else {
                    format!("{enum_name}[{enum_name}[{key}] = ")
                };
                w.blanker
                    .output
                    .override_range(member_span.start, init.span().start, head);
                w.visit_node(expr_index(init));
                let mut state = QualifyState::default();
                qualify_expr(
                    &QualifyContext {
                        w,
                        enum_name: &enum_name,
                        self_member: &record.name,
                        members: &declaration,
                        bindings: &const_bindings,
                        group_key: (enum_group_scope(w, enum_index), enum_name.clone()),
                    },
                    init,
                    &mut state,
                );
                for (start, end, text) in state.edits {
                    w.blanker.output.override_range_sorted(start, end, text);
                }
                let tail = if string_typed {
                    String::new()
                } else {
                    format!("] = {key}")
                };
                w.blanker
                    .output
                    .override_range(init.span().end, member_span.end, tail);
            }
            None => {
                // Auto-increment after a non-computable member — a TypeScript
                // compile error; mirror tsc's `undefined` emit.
                w.blanker.output.override_range(
                    member_span.start,
                    member_span.end,
                    format!("{enum_name}[{enum_name}[{key}] = undefined] = {key}"),
                );
            }
        }

        if let Some(comma) = w.blanker.tokens.token_from(member_span.end)
            && comma.kind() == Kind::Comma
        {
            w.blanker
                .output
                .override_range(comma.span().start, comma.span().end, ";");
        }
    }

    w.blanker.output.override_range(
        node.span().end,
        node.span().end,
        format!(")({enum_name} || ({enum_name} = {{}}));"),
    );
}

/// The quoted enum property key (`JSON.stringify(memberName)` shape). The
/// member name is decoded from the raw literal source — the AST's lossy
/// `value` replaces lone-surrogate escapes with U+FFFD — so `"\uD800"`
/// re-emits exactly like `JSON.stringify`: lowercase `\udXXXX`.
fn member_key<'a>(w: &Walker<'a>, member: &'a TSEnumMember<'a>) -> String {
    let source = super::text::SourceText {
        src: w.src,
        units: w.units,
        byte_to_unit: w.byte_to_unit,
    };
    match &member.id {
        TSEnumMemberName::Identifier(id) => json_quote(id.name.as_str()),
        TSEnumMemberName::String(literal) | TSEnumMemberName::ComputedString(literal) => {
            json_quote_utf16(&string_literal_value_units(&source, literal))
        }
        TSEnumMemberName::ComputedTemplateString(template) => {
            // raw span text, quoted like any other name
            json_quote(&w.src[template.span().start as usize..template.span().end as usize])
        }
    }
}
