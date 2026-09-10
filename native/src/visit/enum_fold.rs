//! Numeric constant folding of enum member initializers, like the
//! TypeScript checker: literals, earlier member values (bare or through
//! the enum object), and their unary/binary arithmetic combinations.
//!
//! Name, property and wrapper handling are shared with the string folder
//! (see [`EnumDeclarations::resolve_name`], [`resolve_member`] and
//! [`unwrap_transparent`]); only the arithmetic lives here.

use oxc_ast::ast::*;

use super::enum_model::{
    DeclarationMembers, EnumDeclarations, MemberValue, Wrapper, unwrap_transparent,
};
use super::enum_number::{to_int32, to_uint32};
use super::enum_text::string_literal_value_units;

/// Constant-fold an initializer for the auto-increment chain (JS semantics:
/// all arithmetic happens on f64, bitwise operators go through ToInt32).
/// Type assertions are transparent and sibling references through the enum
/// object itself (`E.A`, `E["A"]`) resolve, like the TypeScript checker.
pub(super) fn eval_constant(
    expr: &Expression<'_>,
    enum_name: &str,
    declarations: &EnumDeclarations<'_, '_>,
    members: &DeclarationMembers<'_>,
    self_name: &[u16],
) -> Option<f64> {
    use BinaryOperator as B;
    use Expression as E;
    // parentheses and bare-operand assertions are transparent to a
    // number; a non-null assertion (or a parenthesized operand under
    // one) reads at runtime
    let (expr, wrapper) = unwrap_transparent(expr);
    if matches!(wrapper, Wrapper::Runtime) {
        return None;
    }
    match expr {
        E::NumericLiteral(literal) => Some(literal.value),
        E::StringLiteral(_) => None,
        E::Identifier(identifier) => {
            let name_str = identifier.name.as_str();
            let name = name_str.encode_utf16().collect::<Vec<u16>>();
            // a member binding its own name never folds — a self
            // reference reads at runtime
            if name != self_name
                && let Some(MemberValue::Number(value)) =
                    declarations.resolve_name(name_str, &name, members)
            {
                Some(value)
            } else {
                None
            }
        }
        // `E.A` / `E["A"]` — through this enum object, or any already
        // expanded enum (TypeScript folds cross-enum member references)
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
            match declarations.resolve_member(object.name.as_str(), &property, enum_name, members) {
                Some(MemberValue::Number(value)) => Some(value),
                _ => None,
            }
        }
        E::ComputedMemberExpression(member) => {
            let (E::Identifier(object), E::StringLiteral(literal)) =
                (&member.object, &member.expression)
            else {
                return None;
            };
            // decode from the raw source: the AST's value is lossy
            // for lone surrogates, which name distinct members
            let property = string_literal_value_units(&declarations.resolver.source, literal);
            match declarations.resolve_member(object.name.as_str(), &property, enum_name, members) {
                Some(MemberValue::Number(value)) => Some(value),
                _ => None,
            }
        }
        E::UnaryExpression(unary) => {
            let value =
                eval_constant(&unary.argument, enum_name, declarations, members, self_name)?;
            match unary.operator {
                UnaryOperator::UnaryNegation => Some(-value),
                UnaryOperator::UnaryPlus => Some(value),
                UnaryOperator::BitwiseNot => Some(!to_int32(value) as f64),
                _ => None,
            }
        }
        E::BinaryExpression(binary) => {
            let l = eval_constant(&binary.left, enum_name, declarations, members, self_name)?;
            let r = eval_constant(&binary.right, enum_name, declarations, members, self_name)?;
            let result = match binary.operator {
                B::Addition => l + r,
                B::Subtraction => l - r,
                B::Multiplication => l * r,
                B::Division => l / r,
                B::Remainder => l % r,
                B::Exponential => {
                    // JS: x ** Infinity is NaN for |x| == 1.
                    if r.is_infinite() && l.abs() == 1.0 {
                        f64::NAN
                    } else {
                        l.powf(r)
                    }
                }
                B::ShiftLeft => to_int32(l).wrapping_shl(to_uint32(r)) as f64,
                B::ShiftRight => (to_int32(l) >> (to_uint32(r) % 32)) as f64,
                B::ShiftRightZeroFill => (to_uint32(l) >> (to_uint32(r) % 32)) as f64,
                B::BitwiseOR => (to_int32(l) | to_int32(r)) as f64,
                B::BitwiseXOR => (to_int32(l) ^ to_int32(r)) as f64,
                B::BitwiseAnd => (to_int32(l) & to_int32(r)) as f64,
                _ => return None,
            };
            Some(result)
        }
        _ => None,
    }
}
