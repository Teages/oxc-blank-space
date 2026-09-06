//! Port of `src/visitor/namespace.ts`.
//!
//! TypeScript's `NodeFlags.Namespace` is only set for the `namespace` keyword:
//! `module Foo {}` (identifier name) is never erased, only `namespace`-declared
//! modules without runtime values are, and `module`/`declare module` with a
//! string name is ambient. The native AST splits the estree
//! `TSModuleDeclaration` into three shapes, all reported under the estree
//! `TSModuleDeclaration` name.

use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};

use crate::walk::{VisitResult, Walker};

pub(crate) enum Module<'a> {
    Namespace(&'a TSNamespaceDeclaration<'a>),
    External(&'a TSExternalModuleDeclaration<'a>),
    Global(&'a TSGlobalDeclaration<'a>),
}

impl Module<'_> {
    pub(crate) fn span(&self) -> Span {
        match self {
            Module::Namespace(n) => n.span(),
            Module::External(n) => n.span(),
            Module::Global(n) => n.span(),
        }
    }
}

pub(crate) fn should_blank_module(module: &Module<'_>) -> bool {
    match module {
        Module::Global(_) => true,
        // `module "..."` with a string name is ambient.
        Module::External(_) => true,
        Module::Namespace(node) => {
            node.kind == TSNamespaceDeclarationKind::Namespace
                && (node.declare || !namespace_has_values(node))
        }
    }
}

/// Statement-level handling for `namespace`/`module`/`declare global`.
pub(crate) fn visit_module_statement<'a>(w: &mut Walker<'a>, module: Module<'a>) -> VisitResult {
    if should_blank_module(&module) {
        w.blanker.blank_statement(module.span());
        return VisitResult::Blanked;
    }
    w.blanker.report("TSModuleDeclaration", module.span());
    VisitResult::Js
}

fn namespace_has_values(node: &TSNamespaceDeclaration<'_>) -> bool {
    match &node.body {
        TSNamespaceDeclarationBody::TSModuleBlock(body) => {
            body.body.iter().any(statement_has_value)
        }
        // `namespace A.B { ... }` nests directly.
        TSNamespaceDeclarationBody::TSNamespaceDeclaration(inner) => namespace_has_values(inner),
    }
}

fn statement_has_value(statement: &Statement<'_>) -> bool {
    if let Some(declaration) = statement.as_declaration() {
        return declaration_has_value(declaration);
    }
    if let Some(module) = statement.as_module_declaration() {
        return match module {
            ModuleDeclaration::ExportDeclaration(export) => match &export.declaration {
                // `export import x = y` keeps runtime behavior.
                Declaration::TSImportEqualsDeclaration(_) => true,
                declaration => declaration_has_value(declaration),
            },
            // `export { a }`, re-exports, `export default`, `export *` all
            // keep runtime behavior (estree's ExportNamedDeclaration without
            // a declaration returns true).
            _ => true,
        };
    }
    true
}

fn declaration_has_value(declaration: &Declaration<'_>) -> bool {
    match declaration {
        Declaration::TSTypeAliasDeclaration(_) | Declaration::TSInterfaceDeclaration(_) => false,
        // `import x = y` without `export` is type-only in this position.
        Declaration::TSImportEqualsDeclaration(_) => false,
        Declaration::TSNamespaceDeclaration(statement) => {
            if statement.kind == TSNamespaceDeclarationKind::Module {
                return true;
            }
            namespace_has_values(statement)
        }
        // `module "..."` with a string name and `declare global` have ambient
        // (value-less) bodies but mirror the JS rules: kind global / literal id
        // are treated as having values.
        Declaration::TSExternalModuleDeclaration(_) | Declaration::TSGlobalDeclaration(_) => true,
        _ => true,
    }
}
