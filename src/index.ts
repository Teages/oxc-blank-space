import type { Node } from 'oxc-parser'
import { parseSync } from 'oxc-parser'
import { CodeString } from './code-string'
import { walk } from './walker'

export function test() {
  return 'works!'
}

const inlineBracketsLeft = new Set(['(', '['])
const inlineBracketsRight = new Set([')', ']'])

export function transplat(code: string) {
  const ast = parseSync('code.ts', code)
  if (ast.errors.length) {
    throw new Error('Failed to parse code', { cause: ast.errors })
  }

  const s = new CodeString(code)
  const inlineRanges: [number, number][] = []

  /**
   * mark the node as inline, means we need to handle brackets
   *
   * For example:
   * ```ts
   * const a = (): <
   * T
   * > => {}
   * ```
   *
   * after we remove `<T>`, we need to make the function work
   *
   * ```js
   * const a = (
   *
   * ) => {}
   * ```
   */
  const removeNodeInline = (node: Node) => {
    inlineRanges.push([node.start, node.end])
    s.blank(node.start, node.end)
  }

  // mark the node as block, means we need to
  const removeNodeBlock = (node: Node) => {
    s.blankButStartWithSemicolon(node.start, node.end)
  }

  walk(ast.program, {
    Program: node => node.body,

    /** Search Nodes */
    VariableDeclaration: (node) => {
      if (node.declare) {
        removeNodeBlock(node)
        return
      }
      return node.declarations
    },
    ExpressionStatement: node => node.expression,
    ClassDeclaration: (node) => {
      if (node.declare) {
        removeNodeBlock(node)
        return
      }

      if (node.implements?.length) {
        const start = node.implements[0].start
        const end = node.implements[node.implements.length - 1].end
        s.blank(start, end)

        // we also need to remove the implements keyword
        const keywordIndex = s.searchPrev('implements', start)
        if (keywordIndex !== null) {
          s.blank(keywordIndex, keywordIndex + 'implements'.length)
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
    CallExpression: node => [
      node.callee,
      node.typeArguments,
      ...node.arguments,
    ],
    VariableDeclarator: node => [
      node.id,
      node.init,
    ],
    Identifier: (node) => {
      // if (node.optional) {
      // }

      return [
        node.typeAnnotation,
      ]
    },
    ClassBody: node => node.body,
    ParenthesizedExpression: node => node.expression,
    BlockStatement: node => node.body,
    UnaryExpression: node => node.argument,
    FunctionDeclaration: node => [
      node.id,
      node.typeParameters,
      ...node.params as Node[],
      node.returnType,
      node.body,
    ] satisfies (Node | null | undefined)[],
    EmptyStatement: null,
    ArrowFunctionExpression: node => [
      node.typeParameters,
      ...node.params as Node[],
      node.returnType,
      node.body,
    ],
    Literal: null,
    TemplateLiteral: node => [
      ...node.quasis,
      ...node.expressions,
    ],
    ArrayExpression: node => node.elements,
    BinaryExpression: node => [
      node.left,
      node.right,
    ],
    ObjectPattern: node => [
      ...node.properties,
      node.typeAnnotation,
    ],
    LogicalExpression: node => [
      node.left,
      node.right,
    ],
    Decorator: node => [
      node.expression,
    ],
    ExportNamedDeclaration: (node) => {
      if (node.exportKind === 'type') {
        removeNodeBlock(node)
        return
      }

      if (node.declaration?.type === 'TSModuleDeclaration' && node.declaration.kind === 'namespace') {
        removeNodeBlock(node)
        return
      }

      return [
        node.declaration,
        ...node.specifiers,
        node.source,
        ...node.attributes,
      ]
    },
    ImportDeclaration: (node) => {
      if (node.importKind === 'type') {
        removeNodeInline(node)
        return
      }

      return [
        ...node.specifiers,
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
    ExportDefaultDeclaration: node => [
      node.declaration,
    ],
    MemberExpression: node => [
      node.object,
      node.property,
    ],
    PropertyDefinition: (node) => {
      if (node.declare) {
        removeNodeBlock(node)
        return
      }

      return [
        ...node.decorators,
        node.key,
        node.typeAnnotation,
        node.value,
      ]
    },
    AccessorProperty: (node) => {
      return [
        ...node.decorators,
        node.key,
        node.typeAnnotation,
        node.value,
      ]
    },
    MethodDefinition: (node) => {
      return [
        ...node.decorators,
        node.key,
        node.value,
      ]
    },
    NewExpression: node => [
      node.callee,
      node.typeArguments,
      ...node.arguments,
    ],
    FunctionExpression: (node) => {
      // const thisParam = node.params.find((param, index) =>
      //   index === 0 && param.type === 'Identifier' && param.name === 'this')
      // if (thisParam) {
      //   s.blank(thisParam.start, thisParam.end)
      // }

      return [
        node.id,
        node.typeParameters,
        ...node.params as Node[],
        node.returnType,
        node.body,
      ]
    },
    AssignmentPattern: node => [
      node.left,
      node.right,
    ],
    ReturnStatement: node => [
      node.argument,
    ],
    TemplateElement: null,
    IfStatement: node => [
      node.test,
      node.consequent,
      node.alternate,
    ],
    Property: node => [
      node.key,
      node.value,
    ],
    ObjectExpression: node => node.properties,
    ClassExpression: node => [
      ...node.decorators,
      node.id,
      node.typeParameters,
      node.superClass,
      node.superTypeArguments,
      node.body,
    ],
    TaggedTemplateExpression: node => [
      node.tag,
      node.typeArguments,
      node.quasi,
    ],
    ImportDefaultSpecifier: node => [
      node.local,
    ],
    ImportSpecifier: (node) => {
      if (node.importKind === 'type') {
        s.blank(node.start, node.end)
        return
      }

      return [
        node.imported,
        node.local,
      ]
    },
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
    RestElement: node => [
      node.argument,
      node.typeAnnotation,
    ],
    YieldExpression: node => [
      node.argument,
    ],
    ThrowStatement: node => [
      node.argument,
    ],

    /** TypeScript Syntax */
    TSTypeAnnotation: removeNodeInline,
    TSNonNullExpression: node =>
      s.removeButKeep(node.start, node.end, node.expression.start, node.expression.end),
    TSSatisfiesExpression: (node) => {
      s.removeButKeep(node.start, node.end, node.expression.start, node.expression.end)

      return [node.expression]
    },
    TSTypeParameterDeclaration: removeNodeInline,
    TSTypeParameterInstantiation: removeNodeInline,
    TSIndexSignature: removeNodeInline,
    TSAsExpression: node =>
      s.removeButKeep(node.start, node.end, node.expression.start, node.expression.end),
    TSInstantiationExpression: (node) => {
      s.removeButKeep(node.start, node.end, node.expression.start, node.expression.end)

      return [node.expression]
    },
    TSAbstractPropertyDefinition: removeNodeInline,
    TSAbstractMethodDefinition: removeNodeInline,
    TSDeclareFunction: removeNodeBlock,
    TSInterfaceDeclaration: removeNodeBlock,
    TSTypeAliasDeclaration: removeNodeBlock,
    TSModuleDeclaration: removeNodeBlock,

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
     * var A; (function (A) {
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
      s.overwrite(node.start, node.id.end, `var  ${enumName}; (function (${enumName})`)
      s.overwrite(node.end, node.end, `)(${enumName} || (${enumName} = {}));`)

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
        const assignment = `${enumName}[${enumName}["${memberName}"] = ${lastValue}] = "${memberName}";`
        s.overwrite(member.start, member.end, assignment)
      }
      return undefined
    },
    TSEnumBody: null,
    TSEnumMember: null,
  })

  for (const [start, end] of inlineRanges) {
    // TODO: handle inline brackets
  }

  return s.toString()
}
