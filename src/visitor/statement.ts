import type {
  ExportNamedDeclaration,
  ImportDeclaration,
  Node,
  VariableDeclaration,
} from 'oxc-parser'
import type { Blanker } from '../core/blanker'
import type { VisitResult } from '../types'
import { VISIT_BLANKED, VISIT_JS } from '../types'
import { visitClassLike } from './class'
import { expandEnum } from './enum'
import { visitFunctionLike } from './function'
import { shouldBlankModule } from './namespace'

export function visitImportDeclaration(
  blanker: Blanker,
  node: ImportDeclaration,
): VisitResult {
  if (node.importKind === 'type') {
    blanker.blankStatement(node)
    return VISIT_BLANKED
  }
  for (const specifier of node.specifiers) {
    if (
      specifier.type === 'ImportSpecifier'
      && specifier.importKind === 'type'
    ) {
      blanker.blankExactAndOptionalTrailingComma(specifier)
    }
  }
  return VISIT_JS
}

export function visitExportNamedDeclaration(
  blanker: Blanker,
  node: ExportNamedDeclaration,
): VisitResult {
  if (node.exportKind === 'type') {
    blanker.blankStatement(node)
    return VISIT_BLANKED
  }

  const declaration = node.declaration
  if (declaration) {
    return visitExportedDeclaration(blanker, node, declaration)
  }

  for (const specifier of node.specifiers) {
    if (specifier.exportKind === 'type') {
      blanker.blankExactAndOptionalTrailingComma(specifier)
    }
  }
  return VISIT_JS
}

/**
 * Declarations wrapped in `export` that get fully erased must take the whole
 * statement with them — erasing only the declaration would strand the `export`
 * keyword.
 */
function visitExportedDeclaration(
  blanker: Blanker,
  wrapper: ExportNamedDeclaration,
  declaration: Node,
): VisitResult {
  switch (declaration.type) {
    case 'TSTypeAliasDeclaration':
    case 'TSInterfaceDeclaration':
    case 'VariableDeclaration': {
      if (
        declaration.type === 'VariableDeclaration'
        && !declaration.declare
      ) {
        return visitVariableDeclaration(blanker, declaration)
      }
      blanker.blankStatement(wrapper)
      return VISIT_BLANKED
    }
    case 'ClassDeclaration': {
      if (declaration.declare) {
        blanker.blankStatement(wrapper)
        return VISIT_BLANKED
      }
      return visitClassLike(blanker, declaration)
    }
    case 'FunctionDeclaration': {
      if (declaration.declare) {
        blanker.blankStatement(wrapper)
        return VISIT_BLANKED
      }
      return visitFunctionLike(blanker, declaration)
    }
    case 'TSDeclareFunction':
      // An exported overload signature must take the whole `export` statement
      // with it — erasing only the declaration would strand the keyword.
      blanker.blankStatement(wrapper)
      return VISIT_BLANKED
    case 'TSEnumDeclaration': {
      if (declaration.declare) {
        blanker.blankStatement(wrapper)
        return VISIT_BLANKED
      }
      expandEnum(blanker, declaration)
      return VISIT_JS
    }
    case 'TSModuleDeclaration': {
      if (shouldBlankModule(declaration)) {
        blanker.blankStatement(wrapper)
        return VISIT_BLANKED
      }
      blanker.report(declaration)
      return VISIT_JS
    }
    case 'TSImportEqualsDeclaration': {
      blanker.report(declaration)
      return VISIT_JS
    }
    default:
      return blanker.visitNested(declaration)
  }
}

export function visitVariableDeclaration(
  blanker: Blanker,
  node: VariableDeclaration,
): VisitResult {
  if (node.declare) {
    blanker.blankStatement(node)
    return VISIT_BLANKED
  }
  blanker.visitNodeArray(node.declarations, false, false, declarator =>
    blanker.visitNode(declarator))
  return VISIT_JS
}
