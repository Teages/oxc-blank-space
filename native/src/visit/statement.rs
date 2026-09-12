use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};

use super::walk::{VisitResult, Walker};
use super::{class, enums, function, namespace};

pub(crate) fn visit_import_declaration<'a>(
    w: &mut Walker<'a>,
    node: &'a ImportDeclaration<'a>,
) -> VisitResult {
    if node.import_kind == ImportOrExportKind::Type {
        w.blanker.blank_statement(node.span());
        return VisitResult::Blanked;
    }
    for specifier in node.specifiers.iter().flatten() {
        if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
            && specifier.import_kind == ImportOrExportKind::Type
        {
            w.blanker
                .blank_exact_and_optional_trailing_comma(specifier.span());
        }
    }
    VisitResult::Js
}

/// Specifier-only export declarations: `export { a }` and `export { a } from
/// 'mod'` are distinct shapes in the native AST.
pub(crate) fn visit_export_specifiers(
    w: &mut Walker<'_>,
    span: Span,
    export_kind: ImportOrExportKind,
    specifiers: &[ExportSpecifier<'_>],
) -> VisitResult {
    if export_kind == ImportOrExportKind::Type {
        w.blanker.blank_statement(span);
        return VisitResult::Blanked;
    }

    for specifier in specifiers {
        if specifier.export_kind == ImportOrExportKind::Type {
            w.blanker
                .blank_exact_and_optional_trailing_comma(specifier.span());
        }
    }
    VisitResult::Js
}

/// `export <declaration>` (native `ExportDeclaration`).
pub(crate) fn visit_exported_declaration<'a>(
    w: &mut Walker<'a>,
    node: &'a ExportDeclaration<'a>,
) -> VisitResult {
    let wrapper = node.span();
    match &node.declaration {
        Declaration::TSTypeAliasDeclaration(_) | Declaration::TSInterfaceDeclaration(_) => {
            w.blanker.blank_statement(wrapper);
            VisitResult::Blanked
        }
        Declaration::VariableDeclaration(declaration) => {
            if declaration.declare {
                w.blanker.blank_statement(wrapper);
                VisitResult::Blanked
            } else {
                visit_variable_declaration(w, declaration)
            }
        }
        Declaration::ClassDeclaration(declaration) => {
            if declaration.declare {
                w.blanker.blank_statement(wrapper);
                VisitResult::Blanked
            } else {
                class::visit_class_like(w, declaration)
            }
        }
        Declaration::FunctionDeclaration(declaration) => {
            // overload signatures and ambient functions erase the whole
            // `export` statement — the keyword would otherwise be stranded
            if declaration.r#type == FunctionType::TSDeclareFunction || declaration.declare {
                w.blanker.blank_statement(wrapper);
                VisitResult::Blanked
            } else {
                function::visit_function_like(w, declaration)
            }
        }
        Declaration::TSEnumDeclaration(declaration) => {
            if declaration.declare {
                w.blanker.blank_statement(wrapper);
                VisitResult::Blanked
            } else {
                enums::exp::expand_enum(w, declaration);
                VisitResult::Js
            }
        }
        Declaration::TSNamespaceDeclaration(declaration) => {
            visit_exported_module(w, wrapper, namespace::Module::Namespace(declaration))
        }
        Declaration::TSExternalModuleDeclaration(declaration) => {
            visit_exported_module(w, wrapper, namespace::Module::External(declaration))
        }
        Declaration::TSGlobalDeclaration(declaration) => {
            visit_exported_module(w, wrapper, namespace::Module::Global(declaration))
        }
        Declaration::TSImportEqualsDeclaration(declaration) => {
            w.blanker
                .report("TSImportEqualsDeclaration", declaration.span());
            VisitResult::Js
        }
    }
}

fn visit_exported_module(
    w: &mut Walker<'_>,
    wrapper: Span,
    module: namespace::Module<'_>,
) -> VisitResult {
    if namespace::should_blank_module(&module) {
        w.blanker.blank_statement(wrapper);
        VisitResult::Blanked
    } else {
        w.blanker.report("TSModuleDeclaration", module.span());
        VisitResult::Js
    }
}

pub(crate) fn visit_variable_declaration<'a>(
    w: &mut Walker<'a>,
    node: &'a VariableDeclaration<'a>,
) -> VisitResult {
    if node.declare {
        w.blanker.blank_statement(node.span());
        return VisitResult::Blanked;
    }
    let indices: Vec<u32> = node.declarations.iter().map(|d| node_index!(d)).collect();
    w.visit_node_array(&indices, false, false);
    VisitResult::Js
}
