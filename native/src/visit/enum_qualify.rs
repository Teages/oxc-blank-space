//! Reference qualification inside non-constant enum member initializers:
//! rewriting bare member references (`B = A + f()` → `B = E.A + f()`),
//! leaving references an inner scope binds untouched, like the TypeScript
//! emitter.
//!
//! Binding resolution is not modeled here: the flattener's scope tree
//! (one serial per lexical scope) and the binding registry the collection
//! pass built ([`ConstBindings`]) already encode parameters, `var`
//! hoisting, block scopes, loop heads, class names and catch clauses —
//! this walk only decides *where* a rewrite applies. A reference rewrites
//! when it names a member of the enum being emitted, no scope from the
//! reference's position out to the program binds the name, and the
//! erasure pass has not blanked its position. Rewrites are collected and
//! applied in source order by the caller: they interleave by position
//! with the erasure blanks the normal walk pushed over the same
//! initializer.

use oxc_ast::AstKind;
use oxc_ast::ast::*;
use oxc_span::GetSpan;

use super::enum_model::{ConstBindings, DeclarationMembers, scope_above};
use super::walk::Walker;

/// The fixed qualifiers of one qualification walk: the enum whose members
/// are rewritten, the member being initialized, the walker, and the
/// binding registry its scope lookups read.
pub(super) struct QualifyContext<'a> {
    pub w: &'a Walker<'a>,
    pub enum_name: &'a str,
    pub self_member: &'a [u16],
    pub members: &'a DeclarationMembers<'a>,
    pub bindings: &'a ConstBindings<'a>,
    /// The merge-group key of the enum being emitted — where its member
    /// bindings live in the scope chain.
    pub group_key: (u32, String),
}

/// The rewrites collected so far, applied by the caller in source order.
#[derive(Default)]
pub(super) struct QualifyState {
    pub edits: Vec<(u32, u32, String)>,
}

pub(super) fn qualify_expr<'a>(
    ctx: &QualifyContext<'a>,
    expr: &Expression<'_>,
    state: &mut QualifyState,
) {
    let start = AstKind::from_expression(expr).node_id().index() as u32;
    qualify_index(ctx, start, state);
}

pub(super) fn qualify_index(ctx: &QualifyContext<'_>, idx: u32, state: &mut QualifyState) {
    let w = ctx.w;
    match w.node_kind(idx) {
        AstKind::IdentifierReference(identifier) => qualify_identifier(ctx, idx, identifier, state),
        // Property access: only the object (and computed keys) are value
        // positions; the static property name is never a reference.
        AstKind::ComputedMemberExpression(member) => {
            qualify_expr(ctx, &member.object, state);
            qualify_expr(ctx, &member.expression, state);
        }
        AstKind::StaticMemberExpression(member) => {
            qualify_expr(ctx, &member.object, state);
        }
        AstKind::PrivateFieldExpression(member) => {
            qualify_expr(ctx, &member.object, state);
        }
        // The type side of an assertion is erased by the normal walk; its
        // names stand in type positions and are never member references.
        AstKind::TSAsExpression(n) => qualify_expr(ctx, &n.expression, state),
        AstKind::TSSatisfiesExpression(n) => qualify_expr(ctx, &n.expression, state),
        AstKind::TSNonNullExpression(n) => qualify_expr(ctx, &n.expression, state),
        // Other type positions never contain value references either, and the
        // normal walk erases them — nothing inside may be rewritten.
        AstKind::TSTypeAnnotation(_)
        | AstKind::TSTypeParameterDeclaration(_)
        | AstKind::TSTypeParameterInstantiation(_)
        | AstKind::TSClassImplements(_) => {}
        // Object literal properties: computed keys and values are value
        // positions; static keys are not.
        AstKind::ObjectProperty(property) => {
            if property.computed
                && let Some(key_index) = w.child_with_span(idx, property.key.span())
            {
                qualify_index(ctx, key_index, state);
            }
            qualify_expr(ctx, &property.value, state);
        }
        _ => {
            for child in w.children_of(idx).collect::<Vec<_>>() {
                qualify_index(ctx, child, state);
            }
        }
    }
}

/// The member rewrite itself: a bare reference to a sibling member (one
/// no scope from the reference's position outward binds) becomes
/// `EnumName.member`.
fn qualify_identifier(
    ctx: &QualifyContext<'_>,
    idx: u32,
    identifier: &IdentifierReference<'_>,
    state: &mut QualifyState,
) {
    let w = ctx.w;
    let name_str = identifier.name.as_str();
    let name = name_str.encode_utf16().collect::<Vec<u16>>();
    // the erasure pass may have blanked the region this reference
    // sits in (a type alias, an annotation): its content is gone,
    // and rewriting it would splice member text back into erased
    // positions
    // a shorthand property's key shares the value's token: tsc
    // leaves the shorthand as-is (rewriting it would corrupt the
    // key into `{ E.A }`), and the bare name keeps resolving
    // through the runtime scope chain
    let is_shorthand_value = matches!(
        w.node_kind(w.parent_of(idx)),
        AstKind::ObjectProperty(property) if property.shorthand
    );
    if ctx.members.has_member(&name)
        && name != ctx.self_member
        && !is_shorthand_value
        && resolves_to_this_member(ctx, idx, name_str, &name)
        && !w
            .blanker
            .output
            .overlaps_pushed_range(identifier.span().start, identifier.span().end)
    {
        state.edits.push((
            identifier.span().start,
            identifier.span().end,
            format!("{}.{}", ctx.enum_name, String::from_utf16_lossy(&name)),
        ));
    }
}

/// Whether the name resolves from this position to a member of the enum
/// being emitted: walking the scope tree outward, the emitted enum's own
/// member scope must bind the name before any other binding (a scope
/// binding, or an outer enum's member — whose own declaration's pass
/// qualifies it) does. The same scope tree and registry the constant
/// folders resolve through, so the two passes agree on shadowing.
fn resolves_to_this_member(
    ctx: &QualifyContext<'_>,
    idx: u32,
    name_str: &str,
    name: &[u16],
) -> bool {
    if ctx.w.node_scope.is_empty() {
        // no scope model: only self-contained enums skip it, and their
        // qualification walks never reach here
        return false;
    }
    let mut scope = ctx.w.node_scope(idx);
    loop {
        if let Some(group) = ctx.bindings.enum_scopes.get(&scope) {
            let member = if *group == ctx.group_key {
                ctx.members.has_member(name)
            } else {
                ctx.w
                    .enum_members
                    .get(group)
                    .is_some_and(|members| members.names.contains(name))
            };
            if member {
                return *group == ctx.group_key;
            }
        }
        if ctx.bindings.binding_at(scope, name_str).is_some() {
            return false;
        }
        if scope == 0 {
            return false;
        }
        scope = scope_above(ctx.w, scope);
    }
}
