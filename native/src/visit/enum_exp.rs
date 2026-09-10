//! Enums have runtime behavior, so instead of being blanked they are
//! expanded in place into the same IIFE shape the TypeScript compiler
//! emits:
//!
//! ```ts
//! enum Color { Red, Green = 5 }
//! ```
//! ```js
//! var  Color; (function (Color) { Color[Color["Red"] = 0] = "Red";
//! Color[Color["Green"] = 5] = "Green" })(Color || (Color = {}));
//! ```
//!
//! This module emits each declaration's IIFE — folding initializers
//! through [`super::enum_fold`]/[`super::enum_fold_string`] and qualifying
//! member references through [`super::enum_qualify`], over the group
//! tables [`super::enum_collect`] gathered. The surrounding text (braces,
//! whitespace, comments between members) is kept; only the keyword, the
//! name and the members are rewritten, so the output length may differ
//! from the input. `const enum` is expanded the same way so that
//! untouched use sites (`CE.A`) keep resolving at runtime.

use std::rc::Rc;

use oxc_ast::AstKind;
use oxc_ast::ast::*;
use oxc_parser::Kind;
use oxc_span::GetSpan;

use super::enum_fold_string::is_string_typed;
use super::enum_model::MemberValue;
use super::enum_model::{DeclarationMembers, enum_group_scope, is_block_scoped};
use super::enum_number::js_number_to_string;
use super::enum_qualify::{QualifyContext, QualifyState, qualify_expr};
use super::enum_text::{json_quote, json_quote_utf16, string_literal_value_units};
use super::walk::{Walker, expr_index};

pub(crate) fn expand_enum(w: &mut Walker<'_>, node: &TSEnumDeclaration<'_>) {
    let enum_index = node.node_id.get().index() as u32;
    let enum_name = node.id.name.as_str().to_string();
    let declaration_start = node.span().start;
    let key = (enum_group_scope(w, enum_index), enum_name.clone());
    let entry = w.enum_members.get(&key);

    // `let` for enums directly inside a block, function body, namespace or
    // catch clause — any container but the program — so a shadowing enum
    // cannot clobber the outer binding through var hoisting; `var` at
    // program scope. Mirrors the TypeScript emitter.
    let keyword = if is_block_scoped(w, enum_index) {
        "let "
    } else {
        "var "
    };

    // TypeScript exports a merged enum once: only the group's first
    // exported declaration keeps its `export` keyword, and only the
    // group's first declaration emits the binding.
    let exported = matches!(
        w.node_kind(w.parent_of(enum_index)),
        AstKind::ExportDeclaration(_)
    );
    let carries_export =
        exported && entry.and_then(|members| members.first_export_start) == Some(declaration_start);
    let is_first_declaration =
        entry.and_then(|members| members.first_declaration_start) == Some(declaration_start);

    // `enum` keyword — for `const enum` the node span starts at `const`, which
    // is erased together with the keyword.
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
        // a later exported declaration in a group whose export landed here:
        // emit the binding with this declaration's `export` keyword
        w.blanker
            .output
            .override_range(node.span().start, keyword_token.span().end, "var ");
        w.blanker.output.override_range(
            node.id.span().start,
            node.id.span().end,
            format!("{enum_name}; (function ({enum_name})"),
        );
    } else {
        // a later declaration appends only its members: the binding (and
        // its export, if any) belong to an earlier declaration
        let head_start = if exported {
            w.node_kind(w.parent_of(enum_index)).span().start
        } else {
            node.span().start
        };
        w.blanker
            .output
            .override_range(head_start, node.id.span().start, "");
        // ASI protection: the appended IIFE starts with `(`, which would
        // continue a preceding statement that lacks a trailing semicolon
        // (`const x = 1 (function ...) ...`) — a leading `;` starts a fresh
        // statement, the same guard erased statements emit
        let separator = if w.blanker.semicolon_needed { ";" } else { "" };
        w.blanker.output.override_range(
            node.id.span().start,
            node.id.span().end,
            format!("{separator} (function ({enum_name})"),
        );
    }

    // Member emission reads the folds the collection pass decided (see
    // [`super::enum_collect::MemberFold`]) — only the runtime branch
    // re-walks its initializer, erasing TS syntax and qualifying member
    // references. The group table is shared through the walker's `Rc`
    // (cheap refcount, no per-declaration deep clone); this declaration's
    // members resolve through it — earlier declarations of the same enum
    // merged into it already.
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
                // String-valued members emit a plain property assignment
                // without reverse mapping when their type is a string
                // literal (TypeScript emitter shape); the raw value text
                // of a plain literal comes from the original code units on
                // the UTF-16 path — the lossy parse copy would corrupt raw
                // lone surrogates. A folded non-literal (asserted) string
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
                // Constant initializers are emitted as the computed value.
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
                // normal walk (its blanks land between the two member text
                // overrides below), then qualify bare references to
                // sibling members with the enum name — except references
                // an inner scope binds. A string-typed initializer (a
                // template, a concatenation) keeps the plain assignment
                // shape — no reverse mapping over its runtime string
                // result, like the TypeScript emitter.
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
                // Auto-increment after a non-computable member — the input
                // is a TypeScript compile error; mirror tsc's `undefined`
                // emit.
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
/// member name is decoded from the raw literal source — not the AST's lossy
/// `value` string, which replaces lone-surrogate escapes with U+FFFD — as
/// UTF-16 code units, so escaped lone surrogates (`"\uD800"`) re-emit exactly
/// like `JSON.stringify` does: lowercase `\udXXXX`.
fn member_key<'a>(w: &Walker<'a>, member: &'a TSEnumMember<'a>) -> String {
    let source = super::enum_text::SourceText {
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
