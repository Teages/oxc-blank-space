//! String constant folding of enum member initializers, like the
//! TypeScript checker: string literals, earlier string members (bare or
//! through the enum object), template literals and concatenations, with
//! embedded numbers rendered by JS number formatting.
//!
//! Folded values carry the TypeScript literal-ness of their source
//! ([`StringMember`]): assertions fold to their value but lose the
//! literal type, and only literal-typed strings emit the plain assignment
//! shape — or fold at all when referenced from another declaration.

use oxc_ast::ast::*;
use oxc_span::GetSpan;

use super::fold::eval_constant;
use super::model::{
    DeclarationMembers, EnumDeclarations, MemberValue, StringMember, Wrapper, unwrap_transparent,
};
use super::number::js_number_to_string;
use super::text::{SourceText, decode_template_units, string_literal_value_units};

/// Constant-fold an initializer to a string value over UTF-16 units, like
/// the TypeScript checker: string literals, earlier string members (bare
/// or through the enum object itself), and their parenthesized/
/// concatenation combinations. Mixed string/number concatenations fold
/// too, with numbers rendered by JS number formatting. A value folds only
/// if its source type is a string literal: references to non-literal
/// members (an asserted string) and to `let`/`var` bindings stay runtime
/// reads, and assertions demote the folded value to non-literal.
pub(super) fn eval_string_constant(
    source: &SourceText<'_>,
    expr: &Expression<'_>,
    enum_name: &str,
    declarations: &EnumDeclarations<'_, '_>,
    members: &DeclarationMembers<'_>,
) -> Option<StringMember> {
    // parentheses stay transparent; a bare-operand assertion widens the
    // type away from a string literal — the value still folds, but the
    // member is no longer literal; a non-null assertion (or a
    // parenthesized operand under an assertion) reads at runtime
    let (expr, wrapper) = unwrap_transparent(expr);
    let member = match wrapper {
        Wrapper::Runtime => return None,
        _ => fold_string(source, expr, enum_name, declarations, members)?,
    };
    Some(if matches!(wrapper, Wrapper::TypeAssertion) {
        StringMember {
            literal: false,
            ..member
        }
    } else {
        member
    })
}

/// Fold an already-unwrapped initializer to a string value. Name,
/// property and wrapper handling are shared with the numeric folder (see
/// [`EnumDeclarations::resolve_name`] and [`resolve_member`]); the
/// template and concatenation logic lives here.
fn fold_string(
    source: &SourceText<'_>,
    expr: &Expression<'_>,
    enum_name: &str,
    declarations: &EnumDeclarations<'_, '_>,
    members: &DeclarationMembers<'_>,
) -> Option<StringMember> {
    use BinaryOperator as B;
    use Expression as E;
    match expr {
        E::StringLiteral(literal) => Some(StringMember {
            units: string_literal_value_units(source, literal),
            literal: true,
        }),
        E::Identifier(identifier) => {
            let name_str = identifier.name.as_str();
            let name = name_str.encode_utf16().collect::<Vec<u16>>();
            // a non-literal member is not a constant for referencing
            // declarations — tsc keeps the runtime read
            literal_member(declarations.resolve_name(name_str, &name, members))
        }
        // `E.A` / `E["A"]` — through this enum object, or any already
        // expanded enum
        E::StaticMemberExpression(member) => {
            let E::Identifier(object) = &member.object else {
                return None;
            };
            let property = member
                .property
                .name
                .as_str()
                .encode_utf16()
                .collect::<Vec<u16>>();
            literal_member(declarations.resolve_member(
                object.name.as_str(),
                &property,
                enum_name,
                members,
            ))
        }
        E::ComputedMemberExpression(member) => {
            let (E::Identifier(object), E::StringLiteral(literal)) =
                (&member.object, &member.expression)
            else {
                return None;
            };
            // decode from the raw source: the AST's value is lossy
            // for lone surrogates, which name distinct members
            let property = string_literal_value_units(source, literal);
            literal_member(declarations.resolve_member(
                object.name.as_str(),
                &property,
                enum_name,
                members,
            ))
        }
        // cooked quasis interleaved with folded expressions; an expression
        // folding to a number renders with JS number formatting. Quasis
        // decode from the raw source — their span is exactly the raw text —
        // because `cooked` is lossy for lone surrogates (they cannot exist
        // in a Rust string). A template's type is a literal even with
        // interpolations, but any non-foldable expression keeps the whole
        // initializer a runtime read.
        E::TemplateLiteral(template) => {
            let mut units = Vec::new();
            for (index, quasi) in template.quasis.iter().enumerate() {
                units.extend(decode_template_units(
                    &source.original_span_units(quasi.span()),
                ));
                if let Some(expression) = template.expressions.get(index) {
                    let expression_units =
                        eval_string_constant(source, expression, enum_name, declarations, members)
                            .map(|member| member.units)
                            .or_else(|| {
                                eval_constant(expression, enum_name, declarations, members, &[])
                                    .map(|number| {
                                        js_number_to_string(number)
                                            .encode_utf16()
                                            .collect::<Vec<u16>>()
                                    })
                            })?;
                    units.extend(expression_units);
                }
            }
            Some(StringMember {
                units,
                literal: true,
            })
        }
        E::BinaryExpression(binary) if binary.operator == B::Addition => {
            // JS `+` concatenates as soon as either side is a string; a
            // numeric side folds through the numeric checker and renders
            // with JS number formatting. The result is literal only when
            // the string side is — a widened operand widens the sum.
            if let Some(value) =
                eval_string_constant(source, &binary.left, enum_name, declarations, members)
            {
                let right =
                    eval_string_constant(source, &binary.right, enum_name, declarations, members)
                        .or_else(|| {
                        eval_constant(&binary.right, enum_name, declarations, members, &[]).map(
                            |number| StringMember {
                                units: js_number_to_string(number)
                                    .encode_utf16()
                                    .collect::<Vec<u16>>(),
                                literal: true,
                            },
                        )
                    })?;
                let units = [value.units, right.units].concat();
                return Some(StringMember {
                    units,
                    literal: value.literal && right.literal,
                });
            }
            if let Some(number) = eval_constant(&binary.left, enum_name, declarations, members, &[])
                && let Some(right) =
                    eval_string_constant(source, &binary.right, enum_name, declarations, members)
            {
                let mut units = js_number_to_string(number)
                    .encode_utf16()
                    .collect::<Vec<u16>>();
                units.extend(right.units);
                return Some(StringMember {
                    units,
                    literal: right.literal,
                });
            }
            None
        }
        _ => None,
    }
}

/// A resolved member value, kept only when it is a literal string — a
/// non-literal member is not a constant for referencing declarations;
/// tsc keeps the runtime read.
fn literal_member(value: Option<MemberValue>) -> Option<StringMember> {
    match value {
        Some(MemberValue::Str(member)) if member.literal => Some(member),
        _ => None,
    }
}

/// Whether the initializer's static type is a string, regardless of
/// whether its value folds: a string literal, a template, or a
/// concatenation with a string-typed side, not wrapped in an assertion
/// (an assertion widens the type away). Non-foldable string-typed
/// initializers emit the plain assignment shape — no reverse mapping over
/// a runtime string — like the TypeScript emitter.
pub(super) fn is_string_typed(expr: &Expression<'_>) -> bool {
    use Expression as E;
    match expr {
        E::StringLiteral(_) | E::TemplateLiteral(_) => true,
        E::BinaryExpression(binary) if binary.operator == BinaryOperator::Addition => {
            is_string_typed(&binary.left) || is_string_typed(&binary.right)
        }
        E::ParenthesizedExpression(paren) => is_string_typed(&paren.expression),
        // assertions widen the type away from string, and a non-null
        // assertion's operand keeps only its runtime type — tsc emits
        // the numeric reverse-mapping shape over the read
        E::TSNonNullExpression(_) | E::TSAsExpression(_) | E::TSSatisfiesExpression(_) => false,
        _ => false,
    }
}
