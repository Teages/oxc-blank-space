import type { Node } from 'oxc-parser'
import { parseSync } from 'oxc-parser'
import { SyntaxKind } from 'typescript'
import { isFunctionLikeExpression, isNode, isStatementLike } from './utils/ast'
import { CodeString } from './utils/code-string'
import { firstToken, lastToken, walkTokens } from './utils/token'
import { walk } from './utils/walker'

export function transpile(code: string) {
  const ast = parseSync('code.ts', code)
  if (ast.errors.length) {
    throw new Error('Failed to parse code', { cause: ast.errors })
  }

  const s = new CodeString(code)

  const removeNodeInline = (node: Node) => {
    s.blank(node.start, node.end)
  }

  // mark the node as block, means we need to add a semicolon to keep the behavior
  const removeNodeBlock = (node: Node) => {
    s.blankButStartWithSemicolon(node.start, node.end)
  }

  walk(ast.program, {
    VariableDeclaration: (node) => {
      if (node.declare) {
        removeNodeBlock(node)
        return
      }
      return node.declarations
    },
    ClassDeclaration: (node) => {
      if (node.declare) {
        removeNodeBlock(node)
        return
      }

      const tokenToRemove = new Set<SyntaxKind>()

      if (node.implements?.length) {
        const start = node.implements[0].start
        const end = node.implements[node.implements.length - 1].end
        s.blank(start, end)
        tokenToRemove.add(SyntaxKind.ImplementsKeyword)
      }

      if (node.abstract) {
        tokenToRemove.add(SyntaxKind.AbstractKeyword)
      }

      for (const token of walkTokens(s.getOriginal(node.start, node.end))) {
        if (tokenToRemove.has(token.kind)) {
          tokenToRemove.delete(token.kind)
          s.blank(node.start + token.start, node.start + token.end)
        }
      }

      return [
        ...node.decorators,
        node.id,
        node.typeParameters,
        node.superClass,
        node.superTypeArguments,
        node.body,
      ]
    },
    VariableDeclarator: (node) => {
      if (node.definite) {
        for (const token of walkTokens(s.getOriginal(node.start, node.end))) {
          if (token.kind === SyntaxKind.ExclamationToken) {
            s.blank(node.start + token.start, node.start + token.end)
            break
          }
        }
      }

      return [
        node.id,
        node.init,
      ]
    },
    Identifier: (node) => {
      if (node.optional as boolean) { // FIXME: oxc-parser type is not correct
        for (const token of walkTokens(s.getOriginal(node.start, node.end))) {
          if (token.kind === SyntaxKind.QuestionToken) {
            s.blank(node.start + token.start, node.start + token.end)
            break
          }
        }
      }

      return [
        node.typeAnnotation,
      ]
    },
    ArrowFunctionExpression: (node) => {
      if (node.returnType) {
        removeNodeInline(node.returnType)

        const prevToken = lastToken(s.getOriginal(node.start, node.returnType.start))

        if (prevToken?.kind === SyntaxKind.CloseParenToken) {
          const targetCloseParenPos = node.returnType.end
          const closeParenPos = node.start + prevToken.start

          if (s.isMultiLineInRange(closeParenPos, targetCloseParenPos)) {
            s.override(targetCloseParenPos - 1, targetCloseParenPos, ')')
            s.override(closeParenPos, closeParenPos + 1, ' ')
          }
        }
      }

      return [
        node.typeParameters,
        ...node.params as Node[],
        // node.returnType, // we have already handled it
        node.body,
      ]
    },
    Literal: null,
    ExportNamedDeclaration: (node) => {
      if (node.exportKind === 'type') {
        removeNodeBlock(node)
        return
      }

      if (node.declaration?.type === 'TSModuleDeclaration' && node.declaration.kind === 'namespace') {
        removeNodeBlock(node)
        return
      }

      for (const specifier of node.specifiers) {
        if (specifier.type === 'ExportSpecifier' && specifier.exportKind === 'type') {
          removeNodeInline(specifier)
          // remove its follow ','

          for (const token of walkTokens(s.getOriginal(specifier.end, node.end))) {
            // found '}'
            if (token.kind === SyntaxKind.CloseParenToken) {
              break
            }

            // found ','
            if (token.kind === SyntaxKind.CommaToken) {
              s.blank(specifier.end + token.start, specifier.end + token.end)
              break
            }
          }
        }
      }

      return [
        node.declaration,
        ...node.specifiers.filter(
          specifier => specifier.exportKind !== 'type',
        ),
        node.source,
        ...node.attributes,
      ]
    },
    ImportDeclaration: (node) => {
      if (node.importKind === 'type') {
        removeNodeInline(node)
        return
      }

      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier' && specifier.importKind === 'type') {
          removeNodeInline(specifier)
          // remove its follow ','

          for (const token of walkTokens(s.getOriginal(specifier.end, node.end))) {
            // found '}'
            if (token.kind === SyntaxKind.CloseParenToken) {
              break
            }

            // found ','
            if (token.kind === SyntaxKind.CommaToken) {
              s.blank(specifier.end + token.start, specifier.end + token.end)
              break
            }
          }
        }
      }

      return [
        ...node.specifiers.filter(
          specifier => specifier.type === 'ImportSpecifier'
            && specifier.importKind !== 'type',
        ),
        node.source,
        ...node.attributes,
      ]
    },
    ExportAllDeclaration: (node) => {
      if (node.exportKind === 'type') {
        removeNodeBlock(node)
        return
      }

      return [
        node.exported,
        node.source,
        ...node.attributes,
      ]
    },

    PropertyDefinition: (node, parent) => {
      if (node.declare) {
        removeNodeBlock(node)
        return
      }

      const tokenToRemove = new Set<SyntaxKind>()
      if (node.override) {
        tokenToRemove.add(SyntaxKind.OverrideKeyword)
      }
      if (node.optional) {
        tokenToRemove.add(SyntaxKind.QuestionToken)
      }
      if (node.readonly) {
        tokenToRemove.add(SyntaxKind.ReadonlyKeyword)
      }
      if (node.definite) {
        tokenToRemove.add(SyntaxKind.ExclamationToken)
      }
      if (node.accessibility === 'private') {
        tokenToRemove.add(SyntaxKind.PrivateKeyword)
      }
      if (node.accessibility === 'protected') {
        tokenToRemove.add(SyntaxKind.ProtectedKeyword)
      }
      if (node.accessibility === 'public') {
        tokenToRemove.add(SyntaxKind.PublicKeyword)
      }

      let wantSemicolon = parent?.type === 'ClassBody' && !node.static && !node.decorators.length
      for (const token of walkTokens(s.getOriginal(node.start, node.end))) {
        if (tokenToRemove.has(token.kind)) {
          tokenToRemove.delete(token.kind)
          s.blank(node.start + token.start, node.start + token.end)
          if (wantSemicolon && token.kind !== SyntaxKind.QuestionToken) {
            wantSemicolon = false
            s.override(node.start + token.start, node.start + token.start + 1, ';')
          }
        }
      }

      return [
        ...node.decorators,
        node.key,
        node.typeAnnotation,
        node.value,
      ]
    },
    MethodDefinition: (node, parent) => {
      const tokenToRemove = new Set<SyntaxKind>()
      if (node.override) {
        tokenToRemove.add(SyntaxKind.OverrideKeyword)
      }
      if (node.optional) {
        tokenToRemove.add(SyntaxKind.QuestionToken)
      }
      if (node.static) {
        tokenToRemove.add(SyntaxKind.StaticKeyword)
      }
      if (node.accessibility === 'private') {
        tokenToRemove.add(SyntaxKind.PrivateKeyword)
      }
      if (node.accessibility === 'protected') {
        tokenToRemove.add(SyntaxKind.ProtectedKeyword)
      }
      if (node.accessibility === 'public') {
        tokenToRemove.add(SyntaxKind.PublicKeyword)
      }

      let wantSemicolon = parent?.type === 'ClassBody' && !node.static && !node.decorators.length
      for (const token of walkTokens(s.getOriginal(node.start, node.end))) {
        if (tokenToRemove.has(token.kind)) {
          tokenToRemove.delete(token.kind)
          s.blank(node.start + token.start, node.start + token.end)
          if (wantSemicolon && token.kind !== SyntaxKind.QuestionToken) {
            wantSemicolon = false
            s.override(node.start + token.start, node.start + token.start + 1, ';')
          }
        }
      }

      return [
        ...node.decorators,
        node.key,
        node.value,
      ]
    },

    FunctionExpression: (node) => {
      const thisParam = node.params.find((param, index) =>
        index === 0 && param.type === 'Identifier' && param.name === 'this')
      if (thisParam) {
        // if exist `this` in the function body, remove it
        s.blank(thisParam.start, thisParam.end)

        // remove its follow ','
        for (const token of walkTokens(s.getOriginal(thisParam.end, node.end))) {
          // found ')'
          if (token.kind === SyntaxKind.CloseParenToken) {
            break
          }

          // found ','
          if (token.kind === SyntaxKind.CommaToken) {
            s.blank(thisParam.end + token.start, thisParam.end + token.end)
            break
          }
        }
      }

      return [
        node.id,
        node.typeParameters,
        ...node.params as Node[],
        node.returnType,
        node.body,
      ]
    },

    // remove type import
    ImportSpecifier: (node) => {
      if (node.importKind === 'type') {
        throw new Error('Import type should be handled by `ImportDeclaration`')
      }

      return [
        node.imported,
        node.local,
      ]
    },

    // remove type export
    ExportSpecifier: (node) => {
      if (node.exportKind === 'type') {
        removeNodeInline(node)
        return
      }

      return [
        node.local,
        node.exported,
      ]
    },

    /** TypeScript Syntax, can be simply erased */
    TSTypeAnnotation: removeNodeInline,
    TSTypeParameterInstantiation: removeNodeInline,
    TSIndexSignature: removeNodeInline,
    TSAbstractPropertyDefinition: removeNodeBlock, // it's a inline node, but we need to add a semicolon
    TSAbstractMethodDefinition: removeNodeInline,
    TSDeclareFunction: removeNodeBlock,
    TSInterfaceDeclaration: removeNodeBlock,
    TSTypeAliasDeclaration: removeNodeBlock,
    TSModuleDeclaration: removeNodeBlock,

    // remove the `!` in the expression
    TSNonNullExpression: (node) => {
      for (const token of walkTokens(s.getOriginal(node.start, node.end))) {
        if (token.kind === SyntaxKind.ExclamationToken) {
          s.blank(node.start + token.start, node.start + token.end)
          break
        }
      }
    },

    // `some satisfies Type` -> `some`
    TSSatisfiesExpression: (node, parent) => {
      s.blank(node.expression.end, node.end)
      if (parent && isStatementLike(parent) && node.end === parent.end && s.getOriginalChar(node.end) !== ';') {
        s.override(node.expression.end, node.expression.end + 1, ';')
      }
      return [node.expression]
    },

    // `some as Type` -> `some`
    TSAsExpression: (node, parent) => {
      s.blank(node.expression.end, node.end)
      if (parent && isStatementLike(parent) && node.end === parent.end && s.getOriginalChar(node.end) !== ';') {
        s.override(node.expression.end, node.expression.end + 1, ';')
      }
      return [node.expression]
    },

    // `function foo<T>() {}` -> `function foo   () {}`
    // `<T>() => {}` -> `   () => {}`
    TSTypeParameterDeclaration: (node, parent) => {
      removeNodeInline(node)

      if (parent && isFunctionLikeExpression(parent)) {
        const nextToken = firstToken(s.getOriginal(node.end, parent.end))

        // we need to move the `(` to keep the behavior
        if (nextToken?.kind === SyntaxKind.OpenParenToken) {
          const targetOpenParenPos = node.start
          const openParenPos = node.end + nextToken.start
          if (s.isMultiLineInRange(targetOpenParenPos, openParenPos)) {
            s.override(targetOpenParenPos, targetOpenParenPos + 1, '(')
            s.override(openParenPos, openParenPos + 1, ' ')
          }
        }
      }
    },

    /**
     * Enum
     *
     * ```ts
     * enum A {
     *   X,
     *   "!X",
     *   Y = 1,
     *   "!Y"
     * }
     * ```
     *
     * ```js
     * var  A; (function (A) {
     *   A[A["X"] = 0] = "X";
     *   A[A["!X"] = 1] = "!X";
     *   A[A["Y"] = 1] = "Y";
     *   A[A["!Y"] = 2] = "!Y";
     * })(A || (A = {}));
     * ```
     */
    TSEnumDeclaration: (node) => {
      if (node.declare) {
        removeNodeBlock(node)
        return
      }

      const enumName = node.id.name
      s.overwriteDanger(node.start, node.start + 4, `var `)
      s.overwriteDanger(node.id.start, node.id.end, `${enumName}; (function (${enumName})`)
      s.overwriteDanger(node.end, node.end, `)(${enumName} || (${enumName} = {}));`)

      let lastValue = -1
      for (const member of node.body.members) {
        const hasValue = member.initializer !== undefined
        let memberName
        switch (member.id.type) {
          case 'Identifier': {
            memberName = member.id.name
            break
          }
          case 'Literal': {
            memberName = member.id.value
            break
          }
          default: {
            throw new Error(`Unsupported enum member type: ${member.id.type}`)
          }
        }

        // Handle member value
        if (hasValue) {
          // If member has explicit value, use it
          const value = (member.initializer as any)?.value
          lastValue = typeof value === 'number' ? value : lastValue + 1
        }
        else {
          // Auto-increment value
          lastValue++
        }

        // Generate member assignment
        const assignment = `${enumName}[${enumName}["${memberName}"] = ${lastValue}] = "${memberName}"`

        // try to find the next `,` and remove it
        const nextToken = firstToken(s.getOriginal(member.end, node.end))
        const hasComma = nextToken?.kind === SyntaxKind.CommaToken
        if (hasComma) {
          s.overwriteDanger(member.end + nextToken.start, member.end + nextToken.end, ';')
        }

        s.overwriteDanger(member.start, member.end, assignment)
      }
      return undefined
    },
    TSEnumBody: null,
    TSEnumMember: null,
  }, (node) => {
    const childNodes: Node[] = []
    const pushNode = (node: unknown) => isNode(node) && childNodes.push(node)
    const pushNodes = (node: unknown) => Array.isArray(node)
      ? node.forEach(node => pushNode(node))
      : pushNode(node)

    for (const key in node) {
      pushNodes(node[key as keyof typeof node])
    }

    return childNodes
  })

  return s.toString()
}
