//! The enum pipeline, split by responsibility: [`collect`]
//! registers bindings and gathers members, [`exp`] emits, [`model`]
//! holds the scope/binding registry and merge-group tables, [`fold`]
//! and [`fold_string`] fold initializers, [`qualify`] rewrites
//! member references, and [`number`]/[`text`] provide the JS
//! value semantics those passes share.

pub mod collect;
pub mod exp;
pub mod fold;
pub mod fold_string;
pub mod model;
pub mod number;
pub mod qualify;
pub mod register;
pub mod text;
