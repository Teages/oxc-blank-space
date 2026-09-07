//! Port of `src/visitor/enum.ts`.
//!
//! Enums have runtime behavior, so instead of being blanked they are expanded
//! in place into the same IIFE shape the TypeScript compiler emits:
//!
//! ```ts
//! enum Color { Red, Green = 5 }
//! ```
//! ```js
//! var  Color; (function (Color) { Color[Color["Red"] = 0] = "Red";
//! Color[Color["Green"] = 5] = "Green" })(Color || (Color = {}));
//! ```
//!
//! The surrounding text (braces, whitespace, comments between members) is kept;
//! only the keyword, the name and the members are rewritten, so the output
//! length may differ from the input. `const enum` is expanded the same way so
//! that untouched use sites (`CE.A`) keep resolving at runtime.

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::*;
use oxc_ast::AstKind;
use oxc_parser::Kind;
use oxc_span::GetSpan;

use crate::walk::Walker;

/// Expand `enum`/`const enum` in place (see [`visit_enum_declaration`]).
pub(crate) fn expand_enum(w: &mut Walker<'_>, node: &TSEnumDeclaration<'_>) {
    let enum_name = node.id.name.as_str().to_string();

    // `enum` keyword — for `const enum` the node span starts at `const`, which
    // is erased together with the keyword.
    let first = w.blanker.tokens.token_from(node.span().start);
    let keyword = match first {
        Some(token) if token.kind() == Kind::Const => {
            w.blanker.tokens.token_from(token.span().end)
        }
        other => other,
    };
    let Some(keyword_token) = keyword.filter(|token| token.kind() == Kind::Enum) else {
        w.blanker.report("TSEnumDeclaration", node.span());
        return;
    };
    w.blanker
        .output
        .override_range(node.span().start, keyword_token.span().end, "var ");
    w.blanker.output.override_range(
        node.id.span().start,
        node.id.span().end,
        format!("{enum_name}; (function ({enum_name})"),
    );

    // Numeric constant of the previous member for auto-increment, plus every
    // member seen so far for qualifying references in member initializers.
    let mut previous: Option<f64> = Some(-1.0);
    let mut constants: HashMap<String, f64> = HashMap::new();
    let mut member_names: HashSet<String> = HashSet::new();

    for member in &node.body.members {
        let member_span = member.span();
        let member_name = member_name_of(w, member);
        let key = json_quote(&member_name);
        let initializer = member.initializer.as_ref();
        let constant = initializer
            .and_then(|init| eval_constant(init, &constants, &member_name));

        if let Some(Expression::StringLiteral(literal)) = initializer {
            // String-valued members emit a plain property assignment without
            // reverse mapping, matching the TypeScript emitter.
            let raw = &w.src[literal.span().start as usize..literal.span().end as usize];
            w.blanker.output.override_range(
                member_span.start,
                member_span.end,
                format!("{enum_name}[{key}] = {raw}"),
            );
            previous = None;
        } else if let Some(value) = constant {
            // Constant initializers are emitted as the computed value,
            // matching the TypeScript emitter.
            constants.insert(member_name.clone(), value);
            previous = Some(value);
            w.blanker.output.override_range(
                member_span.start,
                member_span.end,
                format!("{enum_name}[{enum_name}[{key}] = {}] = {key}", js_number_to_string(value)),
            );
        } else if let Some(init) = initializer {
            // Non-constant initializer: keep its source text, qualifying bare
            // references to sibling members with the enum name.
            previous = None;
            w.blanker.output.override_range(
                member_span.start,
                init.span().start,
                format!("{enum_name}[{enum_name}[{key}] = "),
            );
            qualify_member_references(w, init, &enum_name, &member_names);
            w.blanker.output.override_range(
                init.span().end,
                member_span.end,
                format!("] = {key}"),
            );
        } else if let Some(value) = previous {
            let value = value + 1.0;
            constants.insert(member_name.clone(), value);
            previous = Some(value);
            w.blanker.output.override_range(
                member_span.start,
                member_span.end,
                format!("{enum_name}[{enum_name}[{key}] = {}] = {key}", js_number_to_string(value)),
            );
        } else {
            // Auto-increment after a non-computable member — the input is a
            // TypeScript compile error; mirror tsc's `undefined` emit.
            w.blanker.output.override_range(
                member_span.start,
                member_span.end,
                format!("{enum_name}[{enum_name}[{key}] = undefined] = {key}"),
            );
        }

        member_names.insert(member_name);
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

fn member_name_of(w: &Walker<'_>, member: &TSEnumMember<'_>) -> String {
    match &member.id {
        TSEnumMemberName::Identifier(id) => id.name.as_str().to_string(),
        TSEnumMemberName::String(literal) | TSEnumMemberName::ComputedString(literal) => {
            literal.value.as_str().to_string()
        }
        // Invalid TS (computed template); keep raw text like the JS version.
        TSEnumMemberName::ComputedTemplateString(template) => {
            w.src[template.span().start as usize..template.span().end as usize].to_string()
        }
    }
}

/// `JSON.stringify` of a JS string, used for the quoted member key text.
fn json_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `String(value)` — the JS `Number::toString` algorithm. Rust's `LowerExp`
/// yields the shortest round-trip digits; the digits are then laid out per the
/// ECMAScript specification (decimal form for -6 < n <= 21, exponential
/// otherwise). Exact-value formatting (`{:.0}`) would print
/// `1000000000000000128` where JS prints `1000000000000000100`.
fn js_number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value < 0.0 { "-Infinity" } else { "Infinity" }.to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }

    let negative = value.is_sign_negative();
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').expect("LowerExp form");
    let exponent: i32 = exponent.parse().expect("decimal exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    let k = digits.len() as i32;
    let n = exponent + 1;

    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if -6 < n && n <= 21 {
        if n >= k {
            out.push_str(digits);
            for _ in 0..(n - k) {
                out.push('0');
            }
        } else if n > 0 {
            out.push_str(&digits[..n as usize]);
            out.push('.');
            out.push_str(&digits[n as usize..]);
        } else {
            out.push_str("0.");
            for _ in 0..(-n) {
                out.push('0');
            }
            out.push_str(digits);
        }
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        let exponent = n - 1;
        out.push(if exponent < 0 { '-' } else { '+' });
        out.push_str(&exponent.abs().to_string());
    }
    out
}

fn to_int32(value: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }
    let truncated = value.trunc();
    let modulo = truncated.rem_euclid(4_294_967_296.0);
    if modulo >= 2_147_483_648.0 {
        (modulo - 4_294_967_296.0) as i32
    } else {
        modulo as i32
    }
}

fn to_uint32(value: f64) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    value.trunc().rem_euclid(4_294_967_296.0) as u32
}

/// Constant-fold an initializer for the auto-increment chain (JS semantics:
/// all arithmetic happens on f64, bitwise operators go through ToInt32).
fn eval_constant(
    expr: &Expression<'_>,
    constants: &HashMap<String, f64>,
    self_name: &str,
) -> Option<f64> {
    use BinaryOperator as B;
    use Expression as E;
    match expr {
        E::NumericLiteral(literal) => Some(literal.value),
        E::StringLiteral(_) => None,
        E::Identifier(identifier) => {
            if identifier.name.as_str() == self_name {
                None
            } else {
                constants.get(identifier.name.as_str()).copied()
            }
        }
        E::ParenthesizedExpression(paren) => {
            eval_constant(&paren.expression, constants, self_name)
        }
        E::UnaryExpression(unary) => {
            let value = eval_constant(&unary.argument, constants, self_name)?;
            match unary.operator {
                UnaryOperator::UnaryNegation => Some(-value),
                UnaryOperator::UnaryPlus => Some(value),
                UnaryOperator::BitwiseNot => Some(!to_int32(value) as f64),
                _ => None,
            }
        }
        E::BinaryExpression(binary) => {
            let l = eval_constant(&binary.left, constants, self_name)?;
            let r = eval_constant(&binary.right, constants, self_name)?;
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

/// Rewrite bare references to this enum's members inside a non-constant
/// initializer (`B = A + f()` → `B = E.A + f()`): inside the IIFE only the
/// enum binding itself is in scope.
fn qualify_member_references(
    w: &mut Walker<'_>,
    expr: &Expression<'_>,
    enum_name: &str,
    member_names: &HashSet<String>,
) {
    let start = AstKind::from_expression(expr).node_id().index() as u32;
    qualify_index(w, start, enum_name, member_names);
}

fn qualify_index(
    w: &mut Walker<'_>,
    idx: u32,
    enum_name: &str,
    member_names: &HashSet<String>,
) {
    let kind = w.node_kind(idx);
    match kind {
        AstKind::IdentifierReference(identifier) => {
            if member_names.contains(identifier.name.as_str()) {
                w.blanker.output.override_range(
                    identifier.span().start,
                    identifier.span().end,
                    format!("{enum_name}.{}", identifier.name),
                );
            }
        }
        // Property access: only the object (and computed keys) are value
        // positions; the static property name is never a reference.
        AstKind::ComputedMemberExpression(member) => {
            qualify_expr(w, &member.object, enum_name, member_names);
            qualify_expr(w, &member.expression, enum_name, member_names);
        }
        AstKind::StaticMemberExpression(member) => {
            qualify_expr(w, &member.object, enum_name, member_names);
        }
        AstKind::PrivateFieldExpression(member) => {
            qualify_expr(w, &member.object, enum_name, member_names);
        }
        // Object literal properties: computed keys and values are value
        // positions; static keys are not.
        AstKind::ObjectProperty(property) => {
            if property.computed
                && let Some(key_index) = w.child_with_span(idx, property.key.span())
            {
                qualify_index(w, key_index, enum_name, member_names);
            }
            qualify_expr(w, &property.value, enum_name, member_names);
        }
        _ => {
            for child in w.children_of(idx).collect::<Vec<_>>() {
                qualify_index(w, child, enum_name, member_names);
            }
        }
    }
}

fn qualify_expr(
    w: &mut Walker<'_>,
    expr: &Expression<'_>,
    enum_name: &str,
    member_names: &HashSet<String>,
) {
    let start = AstKind::from_expression(expr).node_id().index() as u32;
    qualify_index(w, start, enum_name, member_names);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_number_formatting() {
        assert_eq!(js_number_to_string(0.0), "0");
        assert_eq!(js_number_to_string(5.0), "5");
        assert_eq!(js_number_to_string(-1.0), "-1");
        assert_eq!(js_number_to_string(1.5), "1.5");
        // shortest round-trip digits, not the exact binary value
        assert_eq!(
            js_number_to_string(1000000000000000128.0),
            "1000000000000000100"
        );
        assert_eq!(js_number_to_string(1e20), "100000000000000000000");
        assert_eq!(js_number_to_string(1e21), "1e+21");
        assert_eq!(js_number_to_string(1e-6), "0.000001");
        assert_eq!(js_number_to_string(1e-7), "1e-7");
    }
}
