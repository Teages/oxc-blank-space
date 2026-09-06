import type { Comment, Node, Program } from 'oxc-parser'
import type { OnError, VisitResult } from '../types.js'
import { visitorKeys } from 'oxc-parser'
import { Blanker } from '../core/blanker.js'
import {

  VISIT_BLANKED,
  VISIT_JS,

} from '../types.js'
import { visitClassLike, visitClassMember } from './class.js'
import { visitEnumDeclaration } from './enum.js'
import {
  visitCallOrNew,
  visitLogicalExpression,
  visitNonNullExpression,
  visitTaggedTemplate,
  visitTypeAssertion,
  visitTypeAssertionStatement,
} from './expression.js'
import { visitFunctionLike } from './function.js'
import { visitModuleStatement } from './namespace.js'
import { visitPattern, visitVariableDeclarator } from './pattern.js'
import {
  visitExportNamedDeclaration,
  visitImportDeclaration,
  visitVariableDeclaration,
} from './statement.js'

/**
 * Statement and declaration kinds, mirroring TypeScript's `isStatement`: the
 * first element of a child array decides whether the array is walked with
 * statement tracking (`parentStatement`).
 */
const STATEMENT_LIKE = new Set([
  'BlockStatement',
  'BreakStatement',
  'ContinueStatement',
  'DebuggerStatement',
  'DoStatement',
  'EmptyStatement',
  'ExpressionStatement',
  'ForInStatement',
  'ForOfStatement',
  'ForStatement',
  'IfStatement',
  'LabeledStatement',
  'ReturnStatement',
  'SwitchStatement',
  'ThrowStatement',
  'TryStatement',
  'VariableDeclaration',
  'WhileStatement',
  'WithStatement',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'ExportAllDeclaration',
  'ImportDeclaration',
  'TSImportEqualsDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSEnumDeclaration',
  'TSModuleDeclaration',
  'TSExportAssignment',
])

export function blankProgram(
  program: Program,
  src: string,
  comments: readonly Comment[],
  onError: OnError | undefined,
): string {
  const blanker = new Blanker(src, comments, onError)
  blanker.visitNode = node => visitNode(blanker, node)
  blanker.visitNodeArray(program.body, true, false, node =>
    blanker.visitNode(node))
  return blanker.output.toString()
}

function visitNode(blanker: Blanker, node: Node): VisitResult {
  switch (node.type) {
    case 'Identifier':
      return VISIT_JS
    case 'ImportDeclaration':
      return visitImportDeclaration(blanker, node)
    case 'ExportAllDeclaration':
      // `export type * from "mod"` — value form is plain JS.
      if (node.exportKind === 'type') {
        blanker.blankStatement(node)
        return VISIT_BLANKED
      }
      return VISIT_JS
    case 'ExportNamedDeclaration':
      return visitExportNamedDeclaration(blanker, node)
    case 'TSExportAssignment':
    case 'TSImportEqualsDeclaration':
      // `export = ...` / `import x = require(...)` have runtime behavior.
      blanker.report(node)
      return VISIT_JS
    case 'ExportDefaultDeclaration':
      return blanker.visitNested(node.declaration)
    case 'VariableDeclaration':
      return visitVariableDeclaration(blanker, node)
    case 'VariableDeclarator':
      return visitVariableDeclarator(blanker, node)
    case 'CallExpression':
    case 'NewExpression':
      return visitCallOrNew(blanker, node)
    case 'TaggedTemplateExpression':
      return visitTaggedTemplate(blanker, node)
    case 'TSTypeAliasDeclaration':
    case 'TSInterfaceDeclaration':
      blanker.blankStatement(node)
      return VISIT_BLANKED
    case 'LogicalExpression':
      return visitLogicalExpression(blanker, node)
    case 'ClassDeclaration':
    case 'ClassExpression':
      return visitClassLike(blanker, node)
    case 'TSInstantiationExpression':
      blanker.visitNested(node.expression)
      if (node.typeArguments) {
        blanker.blankRange(
          node.typeArguments.start,
          node.typeArguments.end,
        )
      }
      return VISIT_JS
    case 'PropertyDefinition':
    case 'TSAbstractPropertyDefinition':
    case 'AccessorProperty':
    case 'TSAbstractAccessorProperty':
    case 'MethodDefinition':
    case 'TSAbstractMethodDefinition':
      return visitClassMember(blanker, node)
    case 'TSNonNullExpression':
      return visitNonNullExpression(blanker, node)
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return visitTypeAssertion(blanker, node)
    case 'TSTypeAssertion':
      return visitTypeAssertionStatement(blanker, node)
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'TSDeclareFunction':
      return visitFunctionLike(blanker, node)
    case 'TSEnumDeclaration':
      return visitEnumDeclaration(blanker, node)
    case 'TSModuleDeclaration':
      return visitModuleStatement(blanker, node)
    case 'TSIndexSignature':
      blanker.blankExact(node)
      return VISIT_BLANKED
    case 'CatchClause': {
      if (node.param) {
        visitPattern(blanker, node.param)
      }
      return blanker.visitNested(node.body)
    }
    default:
      return visitChildren(blanker, node)
  }
}

function visitChildren(blanker: Blanker, node: Node): VisitResult {
  const keys = visitorKeys[node.type]
  if (!keys || keys.length === 0) {
    return VISIT_JS
  }

  const children: Node[] = []
  for (const key of keys) {
    const value = (node as Node & Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          children.push(item)
        }
      }
    }
    else if (isNode(value)) {
      children.push(value)
    }
  }
  if (children.length === 0) {
    return VISIT_JS
  }

  children.sort((a, b) => a.start - b.start)
  const isStatementLike = STATEMENT_LIKE.has(children[0]?.type ?? '')
  return blanker.visitNodeArray(children, isStatementLike, false, child =>
    blanker.visitNode(child))
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
    && typeof (value as { start?: unknown }).start === 'number'
}
