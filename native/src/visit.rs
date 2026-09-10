//! Per-construct visitors, dispatched from [`visit::walk`](self::walk).
//!
//! The enum pipeline is split by responsibility: [`enum_collect`]
//! registers bindings and gathers members, [`enum_exp`] emits, [`enum_model`]
//! holds the scope/binding registry and merge-group tables, [`enum_fold`]
//! and [`enum_fold_string`] fold initializers, [`enum_qualify`] rewrites
//! member references, and [`enum_number`]/[`enum_text`] provide the JS
//! value semantics those passes share.

pub mod class;
pub mod enum_collect;
pub mod enum_exp;
pub mod enum_fold;
pub mod enum_fold_string;
pub mod enum_model;
pub mod enum_number;
pub mod enum_qualify;
pub mod enum_register;
pub mod enum_text;
pub mod expression;
pub mod function;
pub mod namespace;
pub mod pattern;
pub mod precedence;
pub mod statement;
pub mod walk;
