import type {
  Node,
  TSGlobalDeclaration,
  TSModuleDeclaration,
} from 'oxc-parser'
import type { Blanker } from '../core/blanker'
import type { VisitResult } from '../types'
import { VISIT_BLANKED, VISIT_JS } from '../types'

type ModuleDeclarationNode = TSModuleDeclaration | TSGlobalDeclaration

/**
 * TypeScript's `NodeFlags.Namespace` is only set for the `namespace` keyword:
 * `module Foo {}` (identifier name) is never erased, only
 * `namespace`-declared modules without runtime values are, and
 * `module`/`declare module` with a string name is ambient.
 */
export function shouldBlankModule(node: ModuleDeclarationNode): boolean {
  if (node.kind === 'global') {
    return true
  }
  if (node.id.type === 'Literal') {
    return true
  }
  return (
    node.kind === 'namespace' && (node.declare || !namespaceHasValues(node))
  )
}

/** Statement-level handling for `namespace`/`module`/`declare global`. */
export function visitModuleStatement(
  blanker: Blanker,
  node: ModuleDeclarationNode,
): VisitResult {
  if (shouldBlankModule(node)) {
    blanker.blankStatement(node)
    return VISIT_BLANKED
  }
  blanker.report(node)
  return VISIT_JS
}

function namespaceHasValues(node: ModuleDeclarationNode): boolean {
  const { body } = node
  if (!body) {
    return false
  }
  return body.body.some(statementHasValue)
}

function statementHasValue(statement: Node): boolean {
  switch (statement.type) {
    case 'TSTypeAliasDeclaration':
    case 'TSInterfaceDeclaration':
      return false
    case 'TSImportEqualsDeclaration':
      // `import x = y` without `export` is type-only in this position.
      return false
    case 'ExportNamedDeclaration':
      return exportDeclarationHasValue(statement)
    case 'TSModuleDeclaration':
      if (statement.kind === 'global') {
        return true
      }
      if (statement.id.type === 'Literal' || statement.kind === 'module') {
        return true
      }
      return namespaceHasValues(statement)
    default:
      return true
  }
}

function exportDeclarationHasValue(
  statement: Extract<Node, { type: 'ExportNamedDeclaration' }>,
): boolean {
  if (statement.exportKind === 'type') {
    return false
  }
  const declaration = statement.declaration
  if (!declaration) {
    return true
  }
  if (declaration.type === 'TSImportEqualsDeclaration') {
    return true
  }
  return statementHasValue(declaration)
}
