import type { Node, Statement } from 'oxc-parser'

export function isFunctionLikeExpression(node: Node): boolean {
  return node.type === 'ArrowFunctionExpression'
    || node.type === 'FunctionDeclaration'
    || node.type === 'MethodDefinition'
    || node.type === 'FunctionExpression'
}

export function isStatementLike(node: Node): boolean {
  return isStatement(node)
    || node.type === 'VariableDeclarator'

    // ClassElement
    || node.type === 'StaticBlock'
    || node.type === 'MethodDefinition'
    || node.type === 'PropertyDefinition'
    || node.type === 'AccessorProperty'
    || node.type === 'TSIndexSignature'
}

export function isStatement(node: Node): node is Statement {
  return node.type === 'BlockStatement'
    || node.type === 'BreakStatement'
    || node.type === 'ContinueStatement'
    || node.type === 'DebuggerStatement'
    || node.type === 'DoWhileStatement'
    || node.type === 'EmptyStatement'
    || node.type === 'ExpressionStatement'
    || node.type === 'ForInStatement'
    || node.type === 'ForOfStatement'
    || node.type === 'ForStatement'
    || node.type === 'IfStatement'
    || node.type === 'LabeledStatement'
    || node.type === 'ReturnStatement'
    || node.type === 'SwitchStatement'
    || node.type === 'ThrowStatement'
    || node.type === 'TryStatement'
    || node.type === 'WhileStatement'
    || node.type === 'WithStatement'

    // Declaration
    || node.type === 'VariableDeclaration'
    || node.type === 'FunctionDeclaration'
    || node.type === 'FunctionExpression'
    || node.type === 'TSDeclareFunction'
    || node.type === 'TSEmptyBodyFunctionExpression'
    || node.type === 'ClassDeclaration'
    || node.type === 'ClassExpression'
    || node.type === 'TSTypeAliasDeclaration'
    || node.type === 'TSInterfaceDeclaration'
    || node.type === 'TSEnumDeclaration'
    || node.type === 'TSModuleDeclaration'
    || node.type === 'TSImportEqualsDeclaration'

    // ModuleDeclaration
    || node.type === 'ImportDeclaration'
    || node.type === 'ExportAllDeclaration'
    || node.type === 'ExportDefaultDeclaration'
    || node.type === 'ExportNamedDeclaration'
    || node.type === 'TSExportAssignment'
    || node.type === 'TSNamespaceExportDeclaration'
}

export function isNode(target: unknown): target is Node {
  return typeof target === 'object'
    && target !== null
    && 'type' in target
    && typeof target.type === 'string'
    && 'start' in target
    && typeof target.start === 'number'
    && 'end' in target
    && typeof target.end === 'number'
}
