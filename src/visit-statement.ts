import type {
  ExportNamedDeclaration,
  ImportDeclaration,
  Node,
  VariableDeclaration,
} from 'oxc-parser'
import type { Blanker } from './blanker.js'
import type { VisitResult } from './types.js'
import { shouldBlankModule } from './namespace-value.js'
import { VISIT_BLANKED, VISIT_JS } from './types.js'
import { visitClassLike } from './visit-class.js'
import { expandEnum } from './visit-enum.js'
import { visitFunctionLike } from './visit-function.js'

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
      if (declaration.body === null) {
        // Overload signatures are erased plainly, `declare` gets the
        // ASI-protected variant — mirroring ts-blank-space.
        if (declaration.declare) {
          blanker.blankStatement(wrapper)
        }
        else {
          blanker.blankExact(wrapper)
        }
        return VISIT_BLANKED
      }
      return visitFunctionLike(blanker, declaration)
    }
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
