//! Port of `src/visitor/walk.ts`.
//!
//! The JS implementation walks an ESTree-shaped AST generically via
//! `visitorKeys`. In Rust the oxc AST is strongly typed, so instead of dynamic
//! dispatch we run one cheap "flatten" pass over the AST (assigning each node a
//! sequential index and recording its tree children) and then run the exact
//! same recursive algorithm over that flat tree, dispatching on `AstKind`.

use std::mem::take;

use oxc_ast::ast::*;
use oxc_ast::AstKind;
use oxc_parser::Token;
use oxc_ast_visit::Visit;
use oxc_span::{GetSpan, Span};
use oxc_syntax::node::NodeId;

use crate::blanker::{Blanker, UnsupportedSyntax};
use crate::{class, enum_exp, expression, function, namespace, pattern, statement};
/// Result of visiting a node.
/// - `js`: JavaScript was (or may have been) emitted for this node.
/// - `blanked`: the node was fully erased, it contains no runtime code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisitResult {
    Js,
    Blanked,
}

/// One pass over the AST collecting every node in preorder, assigning each a
/// sequential index via its `node_id` cell, and recording tree children as a
/// first-child/next-sibling linked list (flat vectors, no per-node heap
/// allocation — the per-node `Vec` this replaces dominated the flatten pass).
#[derive(Default)]
struct Flattener<'a> {
    nodes: Vec<AstKind<'a>>,
    first_child: Vec<u32>,
    next_sibling: Vec<u32>,
    last_child: Vec<u32>,
    stack: Vec<u32>,
}

impl<'a> Visit<'a> for Flattener<'a> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        let index = self.nodes.len() as u32;
        kind.set_node_id(NodeId::new(index as usize));
        if let Some(&parent) = self.stack.last() {
            let last = self.last_child[parent as usize];
            if last == u32::MAX {
                self.first_child[parent as usize] = index;
            } else {
                self.next_sibling[last as usize] = index;
            }
            self.last_child[parent as usize] = index;
        }
        self.stack.push(index);
        self.nodes.push(kind);
        self.first_child.push(u32::MAX);
        self.next_sibling.push(u32::MAX);
        self.last_child.push(u32::MAX);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.stack.pop();
    }
}

pub struct Walker<'a> {
    pub src: &'a str,
    pub blanker: Blanker<'a>,
    /// Original UTF-16 code units and their byte map when transpiling the
    /// lossless UTF-16 path (None on the regular String path).
    pub(crate) units: Option<&'a [u16]>,
    pub(crate) byte_to_unit: Option<&'a [u32]>,
    nodes: Vec<AstKind<'a>>,
    first_child: Vec<u32>,
    next_sibling: Vec<u32>,
    /// Reusable per-depth buffers for generic child lists (zero-alloc in the
    /// steady state; the pool grows to the maximum nesting depth).
    scratch_pool: Vec<Vec<u32>>,
    /// Statement currently being walked, used by the `as`/`satisfies` rule.
    pub(crate) parent_statement: Option<u32>,
}

/// Iterator over the linked-list children of a node, in visit order.
pub(crate) struct Children<'w, 'a> {
    walker: &'w Walker<'a>,
    next: u32,
}

impl Iterator for Children<'_, '_> {
    type Item = u32;

    fn next(&mut self) -> Option<u32> {
        if self.next == u32::MAX {
            return None;
        }
        let current = self.next;
        self.next = self.walker.next_sibling[current as usize];
        Some(current)
    }
}

/// Blank a whole program: returns the blanked output and the unsupported
/// constructs reported along the way.
pub fn blank_program<'a>(
    program: &Program<'a>,
    src: &'a str,
    tokens: &'a [Token],
) -> (String, Vec<UnsupportedSyntax>) {
    let mut flattener = Flattener::default();
    flattener.visit_program(program);

    let mut walker = Walker {
        src,
        blanker: Blanker::new(src, tokens),
        units: None,
        byte_to_unit: None,
        nodes: flattener.nodes,
        first_child: flattener.first_child,
        next_sibling: flattener.next_sibling,
        scratch_pool: Vec::new(),
        parent_statement: None,
    };

    // Top level: estree's `program.body` contains directives prepended to the
    // statements; mirror that array (all statement-like, not a function body).
    let mut indices = Vec::with_capacity(program.directives.len() + program.body.len());
    for directive in &program.directives {
        indices.push(node_index!(directive));
    }
    for stmt in &program.body {
        indices.push(statement_index(stmt));
    }
    walker.visit_node_array(&indices, true, false);

    let output = walker.blanker.output.build(src);
    (output, take(&mut walker.blanker.reports))
}

/// UTF-16 variant of [`blank_program`] for the lossless path: `units` is the
/// original input, `parse_copy` the lossy UTF-8 copy handed to the parser, and
/// `byte_to_unit` maps every copy byte offset to its unit index. The output is
/// the blanked source in code units — raw lone surrogates survive untouched.
pub fn blank_program_utf16<'a>(
    program: &'a Program<'a>,
    units: &'a [u16],
    parse_copy: &'a str,
    byte_to_unit: &'a [u32],
    tokens: &'a [Token],
) -> (Vec<u16>, Vec<UnsupportedSyntax>) {
    let mut flattener = Flattener::default();
    flattener.visit_program(program);

    let mut walker = Walker {
        src: parse_copy,
        blanker: Blanker::new(parse_copy, tokens),
        units: Some(units),
        byte_to_unit: Some(byte_to_unit),
        nodes: flattener.nodes,
        first_child: flattener.first_child,
        next_sibling: flattener.next_sibling,
        scratch_pool: Vec::new(),
        parent_statement: None,
    };

    let mut indices = Vec::with_capacity(program.directives.len() + program.body.len());
    for directive in &program.directives {
        indices.push(node_index!(directive));
    }
    for stmt in &program.body {
        indices.push(statement_index(stmt));
    }
    walker.visit_node_array(&indices, true, false);

    let output = walker.blanker.output.build_units(units, byte_to_unit);
    (output, take(&mut walker.blanker.reports))
}

/// Flat index of a `Statement` (which inherits `Declaration` and
/// `ModuleDeclaration` variants in the native AST).
pub(crate) fn statement_index(stmt: &Statement<'_>) -> u32 {
    if let Some(decl) = stmt.as_declaration() {
        return declaration_index(decl);
    }
    if let Some(module) = stmt.as_module_declaration() {
        return module_declaration_index(module);
    }
    match stmt {
        Statement::BlockStatement(n) => node_index!(n),
        Statement::BreakStatement(n) => node_index!(n),
        Statement::ContinueStatement(n) => node_index!(n),
        Statement::DebuggerStatement(n) => node_index!(n),
        Statement::DoWhileStatement(n) => node_index!(n),
        Statement::EmptyStatement(n) => node_index!(n),
        Statement::ExpressionStatement(n) => node_index!(n),
        Statement::ForInStatement(n) => node_index!(n),
        Statement::ForOfStatement(n) => node_index!(n),
        Statement::ForStatement(n) => node_index!(n),
        Statement::IfStatement(n) => node_index!(n),
        Statement::LabeledStatement(n) => node_index!(n),
        Statement::ReturnStatement(n) => node_index!(n),
        Statement::SwitchStatement(n) => node_index!(n),
        Statement::ThrowStatement(n) => node_index!(n),
        Statement::TryStatement(n) => node_index!(n),
        Statement::WhileStatement(n) => node_index!(n),
        Statement::WithStatement(n) => node_index!(n),
        _ => unreachable!("all statement kinds are handled above"),
    }
}

pub(crate) fn declaration_index(decl: &Declaration<'_>) -> u32 {
    match decl {
        Declaration::VariableDeclaration(n) => node_index!(n),
        Declaration::FunctionDeclaration(n) => node_index!(n),
        Declaration::ClassDeclaration(n) => node_index!(n),
        Declaration::TSTypeAliasDeclaration(n) => node_index!(n),
        Declaration::TSInterfaceDeclaration(n) => node_index!(n),
        Declaration::TSEnumDeclaration(n) => node_index!(n),
        Declaration::TSExternalModuleDeclaration(n) => node_index!(n),
        Declaration::TSNamespaceDeclaration(n) => node_index!(n),
        Declaration::TSGlobalDeclaration(n) => node_index!(n),
        Declaration::TSImportEqualsDeclaration(n) => node_index!(n),
    }
}

pub(crate) fn module_declaration_index(decl: &ModuleDeclaration<'_>) -> u32 {
    match decl {
        ModuleDeclaration::ImportDeclaration(n) => node_index!(n),
        ModuleDeclaration::ExportAllDeclaration(n) => node_index!(n),
        ModuleDeclaration::ExportDefaultDeclaration(n) => node_index!(n),
        ModuleDeclaration::ExportDeclaration(n) => node_index!(n),
        ModuleDeclaration::ExportNamedDeclaration(n) => node_index!(n),
        ModuleDeclaration::ExportFromDeclaration(n) => node_index!(n),
        ModuleDeclaration::TSExportAssignment(n) => node_index!(n),
        ModuleDeclaration::TSNamespaceExportDeclaration(n) => node_index!(n),
    }
}

/// Flat index of an `Expression` (the one wrapper enum oxc provides a
/// generated `AstKind` conversion for).
pub(crate) fn expr_index(expr: &Expression<'_>) -> u32 {
    AstKind::from_expression(expr).node_id().index() as u32
}

/// Flat index of an `Argument` (which inherits `Expression` variants).
pub(crate) fn argument_index(arg: &Argument<'_>) -> u32 {
    match arg {
        Argument::SpreadElement(n) => node_index!(n),
        _ => expr_index(arg.as_expression().expect("argument is an expression")),
    }
}

impl<'a> Walker<'a> {
    /// End offset of the statement currently being walked, if any.
    pub(crate) fn parent_statement_end(&self) -> Option<u32> {
        self.parent_statement
            .map(|idx| self.nodes[idx as usize].span().end)
    }

    /// Byte at `pos`, if any (mirrors `src[pos]` being `undefined` in JS).
    pub(crate) fn src_byte(&self, pos: u32) -> Option<u8> {
        self.src.as_bytes().get(pos as usize).copied()
    }

    /// The flat node at `idx`.
    pub(crate) fn node_kind(&self, idx: u32) -> AstKind<'a> {
        self.nodes[idx as usize]
    }

    /// Tree children of the node at `idx` (in visit order).
    pub(crate) fn children_of(&self, idx: u32) -> Children<'_, 'a> {
        Children {
            walker: self,
            next: self.first_child[idx as usize],
        }
    }

    /// Visit a nested node, keeping the semicolon state up to date.
    pub(crate) fn visit_nested(&mut self, idx: u32) -> VisitResult {
        let result = self.visit_node(idx);
        if result == VisitResult::Js {
            self.update_semicolon(idx);
        }
        result
    }

    pub(crate) fn visit_nested_expr(&mut self, expr: &'a Expression<'a>) -> VisitResult {
        let idx = expr_index(expr);
        self.visit_nested(idx)
    }

    /// Whether the node ends with `;` or a same-line `;` directly follows it.
    pub(crate) fn update_semicolon(&mut self, idx: u32) {
        let span = self.nodes[idx as usize].span();
        self.blanker.semicolon_needed = !self.blanker.ends_with_semicolon(span);
    }

    /// Port of `Blanker.visitNodeArray`.
    pub(crate) fn visit_node_array(
        &mut self,
        indices: &[u32],
        is_statement_like: bool,
        is_function_body: bool,
    ) -> VisitResult {
        let previous_parent_statement = self.parent_statement;
        let previous_semicolon_needed = self.blanker.semicolon_needed;
        if is_function_body {
            self.blanker.semicolon_needed = false;
        }
        for &idx in indices {
            if is_statement_like {
                self.parent_statement = Some(idx);
            }
            if self.visit_node(idx) == VisitResult::Js {
                self.update_semicolon(idx);
            }
        }
        self.parent_statement = previous_parent_statement;
        if is_function_body {
            self.blanker.semicolon_needed = previous_semicolon_needed;
        }
        if self.blanker.semicolon_needed {
            VisitResult::Js
        } else {
            VisitResult::Blanked
        }
    }

    /// Port of `Blanker.visitNodeArray` over a typed statement slice.
    pub(crate) fn visit_statement_slice(
        &mut self,
        statements: &'a [Statement<'a>],
        is_statement_like: bool,
        is_function_body: bool,
    ) -> VisitResult {
        let indices: Vec<u32> = statements.iter().map(statement_index).collect();
        self.visit_node_array(&indices, is_statement_like, is_function_body)
    }

    /// The child of `parent` whose span equals `span`.
    pub(crate) fn child_with_span(&self, parent: u32, span: Span) -> Option<u32> {
        self.children_of(parent)
            .find(|&c| self.nodes[c as usize].span() == span)
    }

    fn visit_children(&mut self, idx: u32) -> VisitResult {
        let mut children = self.scratch_pool.pop().unwrap_or_default();
        children.clear();

        let mut child = self.first_child[idx as usize];
        let mut sorted = true;
        let mut previous_start = 0u32;
        while child != u32::MAX {
            let start = self.nodes[child as usize].span().start;
            if start < previous_start {
                sorted = false;
            }
            previous_start = start;
            children.push(child);
            child = self.next_sibling[child as usize];
        }
        if children.is_empty() {
            self.scratch_pool.push(children);
            return VisitResult::Js;
        }

        if !sorted {
            children.sort_by_key(|&c| self.nodes[c as usize].span().start);
        }
        // The first element of a child array decides whether the array is
        // walked with statement tracking (`parentStatement`).
        let is_statement_like = is_statement_like(self.nodes[children[0] as usize]);
        let result = self.visit_node_array(&children, is_statement_like, false);
        self.scratch_pool.push(children);
        result
    }

    pub(crate) fn visit_node(&mut self, idx: u32) -> VisitResult {
        let kind = self.nodes[idx as usize];
        match kind {
            // estree `Identifier` (references, bindings, names, labels).
            AstKind::IdentifierReference(_)
            | AstKind::IdentifierName(_)
            | AstKind::BindingIdentifier(_)
            | AstKind::LabelIdentifier(_) => VisitResult::Js,

            AstKind::ImportDeclaration(n) => statement::visit_import_declaration(self, n),

            AstKind::ExportAllDeclaration(n) => {
                // `export type * from "mod"` — value form is plain JS.
                if n.export_kind == ImportOrExportKind::Type {
                    self.blanker.blank_statement(n.span());
                    VisitResult::Blanked
                } else {
                    VisitResult::Js
                }
            }

            AstKind::ExportDeclaration(n) => statement::visit_exported_declaration(self, n),

            AstKind::ExportNamedDeclaration(n) => statement::visit_export_specifiers(
                self,
                n.span(),
                n.export_kind,
                &n.specifiers,
            ),

            AstKind::ExportFromDeclaration(n) => statement::visit_export_specifiers(
                self,
                n.span(),
                n.export_kind,
                &n.specifiers,
            ),

            AstKind::TSExportAssignment(n) => {
                // `export = ...` has runtime behavior.
                self.blanker.report("TSExportAssignment", n.span());
                VisitResult::Js
            }

            AstKind::TSImportEqualsDeclaration(n) => {
                // `import x = require(...)` has runtime behavior.
                self.blanker.report("TSImportEqualsDeclaration", n.span());
                VisitResult::Js
            }

            AstKind::ExportDefaultDeclaration(n) => match &n.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(f)
                    if f.r#type == FunctionType::TSDeclareFunction =>
                {
                    // `export default function f(): void;` — visiting the
                    // declaration alone would strand the `export default`
                    // keyword.
                    self.blanker.blank_statement(n.span());
                    VisitResult::Blanked
                }
                ExportDefaultDeclarationKind::FunctionDeclaration(f) => {
                    self.visit_nested(node_index!(f))
                }
                ExportDefaultDeclarationKind::ClassDeclaration(c) => {
                    self.visit_nested(node_index!(c))
                }
                ExportDefaultDeclarationKind::TSInterfaceDeclaration(i) => {
                    self.visit_nested(node_index!(i))
                }
                _ => {
                    let expr = n
                        .declaration
                        .as_expression()
                        .expect("default export declaration is an expression");
                    self.visit_nested_expr(expr)
                }
            },

            AstKind::VariableDeclaration(n) => statement::visit_variable_declaration(self, n),

            AstKind::VariableDeclarator(n) => pattern::visit_variable_declarator(self, n),

            AstKind::CallExpression(n) => expression::visit_call_or_new(
                self,
                &n.callee,
                n.type_arguments.as_deref(),
                &n.arguments,
            ),

            AstKind::NewExpression(n) => expression::visit_call_or_new(
                self,
                &n.callee,
                n.type_arguments.as_deref(),
                &n.arguments,
            ),

            AstKind::TaggedTemplateExpression(n) => expression::visit_tagged_template(self, n),

            AstKind::TSTypeAliasDeclaration(_) | AstKind::TSInterfaceDeclaration(_) => {
                self.blanker.blank_statement(kind.span());
                VisitResult::Blanked
            }

            AstKind::LogicalExpression(n) => expression::visit_logical_expression(self, n),

            AstKind::Class(n) => class::visit_class_like(self, n),

            AstKind::TSInstantiationExpression(n) => {
                self.visit_nested_expr(&n.expression);
                self.blanker.blank_span(n.type_arguments.span());
                VisitResult::Js
            }

            AstKind::PropertyDefinition(_) | AstKind::AccessorProperty(_)
            | AstKind::MethodDefinition(_) => class::visit_class_member(self, kind),

            AstKind::TSNonNullExpression(n) => expression::visit_non_null_expression(self, n),

            AstKind::TSAsExpression(n) => expression::visit_type_assertion(self, n.span(), &n.expression),

            AstKind::TSSatisfiesExpression(n) => {
                expression::visit_type_assertion(self, n.span(), &n.expression)
            }

            AstKind::TSTypeAssertion(n) => expression::visit_type_assertion_statement(self, n),

            AstKind::Function(n) => function::visit_function_like(self, n),

            AstKind::ArrowFunctionExpression(n) => function::visit_arrow_function_like(self, n),

            AstKind::TSEnumDeclaration(n) => {
                if n.declare {
                    self.blanker.blank_statement(n.span());
                    VisitResult::Blanked
                } else {
                    enum_exp::expand_enum(self, n);
                    VisitResult::Js
                }
            }

            AstKind::TSNamespaceDeclaration(n) => {
                namespace::visit_module_statement(self, namespace::Module::Namespace(n))
            }

            AstKind::TSExternalModuleDeclaration(n) => {
                namespace::visit_module_statement(self, namespace::Module::External(n))
            }

            AstKind::TSGlobalDeclaration(n) => {
                namespace::visit_module_statement(self, namespace::Module::Global(n))
            }

            AstKind::TSIndexSignature(n) => {
                self.blanker.blank_exact(n.span());
                VisitResult::Blanked
            }

            AstKind::CatchClause(n) => {
                if let Some(param) = &n.param {
                    if let Some(ta) = &param.type_annotation {
                        self.blanker.blank_type_annotation(ta.span());
                    }
                    pattern::visit_pattern(self, &param.pattern);
                }
                let body = node_index!(n.body);
                self.visit_nested(body)
            }

            _ => self.visit_children(idx),
        }
    }
}

// Statement and declaration kinds, mirroring TypeScript's `isStatement`: the
/// first element of a child array decides whether the array is walked with
/// statement tracking (`parentStatement`). Native `Function`/`Class` map to
/// the estree `FunctionDeclaration`/`ClassDeclaration` names only when their
/// type flag says so (`TSDeclareFunction` is deliberately *not* included,
/// matching the JS set).
fn is_statement_like(kind: AstKind<'_>) -> bool {
    match kind {
        AstKind::Function(f) => f.r#type == FunctionType::FunctionDeclaration,
        AstKind::Class(c) => c.r#type == ClassType::ClassDeclaration,
        other => matches!(
            other,
            AstKind::BlockStatement(_)
                | AstKind::BreakStatement(_)
                | AstKind::ContinueStatement(_)
                | AstKind::DebuggerStatement(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::EmptyStatement(_)
                | AstKind::ExpressionStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::IfStatement(_)
                | AstKind::LabeledStatement(_)
                | AstKind::ReturnStatement(_)
                | AstKind::SwitchStatement(_)
                | AstKind::ThrowStatement(_)
                | AstKind::TryStatement(_)
                | AstKind::VariableDeclaration(_)
                | AstKind::WhileStatement(_)
                | AstKind::WithStatement(_)
                | AstKind::ExportNamedDeclaration(_)
                | AstKind::ExportDeclaration(_)
                | AstKind::ExportFromDeclaration(_)
                | AstKind::ExportDefaultDeclaration(_)
                | AstKind::ExportAllDeclaration(_)
                | AstKind::ImportDeclaration(_)
                | AstKind::TSImportEqualsDeclaration(_)
                | AstKind::TSInterfaceDeclaration(_)
                | AstKind::TSTypeAliasDeclaration(_)
                | AstKind::TSEnumDeclaration(_)
                | AstKind::TSNamespaceDeclaration(_)
                | AstKind::TSExternalModuleDeclaration(_)
                | AstKind::TSGlobalDeclaration(_)
                | AstKind::TSExportAssignment(_)
        ),
    }
}

