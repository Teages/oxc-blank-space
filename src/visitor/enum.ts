import type { Node, TSEnumDeclaration, TSEnumMember } from 'oxc-parser'
import type { Blanker } from '../core/blanker'
import type { VisitResult } from '../types'
import { visitorKeys } from 'oxc-parser'
import { VISIT_BLANKED, VISIT_JS } from '../types'

/**
 * Enums have runtime behavior, so instead of being blanked they are expanded
 * in place into the same IIFE shape the TypeScript compiler emits:
 *
 * ```ts
 * enum Color { Red, Green = 5 }
 * ```
 * ```js
 * var  Color; (function (Color) { Color[Color["Red"] = 0] = "Red";
 * Color[Color["Green"] = 5] = "Green" })(Color || (Color = {}));
 * ```
 *
 * The surrounding text (braces, whitespace, comments between members) is kept;
 * only the keyword, the name and the members are rewritten, so the output
 * length may differ from the input. `const enum` is expanded the same way so
 * that untouched use sites (`CE.A`) keep resolving at runtime.
 */
export function visitEnumDeclaration(
  blanker: Blanker,
  node: TSEnumDeclaration,
): VisitResult {
  if (node.declare) {
    blanker.blankStatement(node)
    return VISIT_BLANKED
  }
  expandEnum(blanker, node)
  return VISIT_JS
}

/** Expand `enum`/`const enum` in place (see visitEnumDeclaration). */
export function expandEnum(blanker: Blanker, node: TSEnumDeclaration): void {
  const enumName = node.id.name

  // `enum` keyword — for `const enum` the node span starts at `const`, which
  // is erased together with the keyword.
  const first = blanker.trivia.scanWord(node.start)
  const keyword
    = first?.word === 'const'
      ? blanker.trivia.scanWord(first.start + first.word.length)
      : first
  if (keyword === undefined || keyword.word !== 'enum') {
    blanker.report(node)
    return
  }
  blanker.output.override(node.start, keyword.start + 4, 'var ')
  blanker.output.override(
    node.id.start,
    node.id.end,
    `${enumName}; (function (${enumName})`,
  )

  // Numeric constant of the previous member for auto-increment, plus every
  // member seen so far for qualifying references in member initializers.
  let previous: number | undefined = -1
  const constants = new Map<string, number>()
  const memberNames = new Set<string>()

  for (const member of node.body.members) {
    const memberName = memberNameOf(blanker, member)
    const key = JSON.stringify(memberName)
    const initializer = member.initializer
    const constant = initializer
      ? evalConstant(initializer, constants, memberName)
      : undefined

    if (
      initializer?.type === 'Literal'
      && typeof initializer.value === 'string'
    ) {
      // String-valued members emit a plain property assignment without
      // reverse mapping, matching the TypeScript emitter.
      blanker.output.override(
        member.start,
        member.end,
        `${enumName}[${key}] = ${blanker.src.slice(initializer.start, initializer.end)}`,
      )
      previous = undefined
    }
    else if (initializer && typeof constant === 'number') {
      // Constant initializers are emitted as the computed value,
      // matching the TypeScript emitter.
      constants.set(memberName, constant)
      previous = constant
      blanker.output.override(
        member.start,
        member.end,
        `${enumName}[${enumName}[${key}] = ${constant}] = ${key}`,
      )
    }
    else if (initializer) {
      // Non-constant initializer: keep its source text, qualifying bare
      // references to sibling members with the enum name.
      previous = undefined
      blanker.output.override(
        member.start,
        initializer.start,
        `${enumName}[${enumName}[${key}] = `,
      )
      qualifyMemberReferences(
        blanker,
        initializer,
        enumName,
        memberNames,
      )
      blanker.output.override(initializer.end, member.end, `] = ${key}`)
    }
    else if (typeof previous === 'number') {
      previous += 1
      constants.set(memberName, previous)
      blanker.output.override(
        member.start,
        member.end,
        `${enumName}[${enumName}[${key}] = ${previous}] = ${key}`,
      )
    }
    else {
      // Auto-increment after a non-computable member — the input is a
      // TypeScript compile error; mirror tsc's `undefined` emit.
      blanker.output.override(
        member.start,
        member.end,
        `${enumName}[${enumName}[${key}] = undefined] = ${key}`,
      )
    }

    memberNames.add(memberName)
    const comma = blanker.trivia.scanChar(member.end)
    if (blanker.src[comma] === ',') {
      blanker.output.override(comma, comma + 1, ';')
    }
  }

  blanker.output.override(
    node.end,
    node.end,
    `)(${enumName} || (${enumName} = {}));`,
  )
}

function memberNameOf(blanker: Blanker, member: TSEnumMember): string {
  const id = member.id
  if (id.type === 'Identifier') {
    return id.name
  }
  if (id.type === 'Literal') {
    return String(id.value)
  }
  return blanker.src.slice(id.start, id.end) // invalid TS; keep raw text
}

/** Constant-fold an initializer for the auto-increment chain. */
function evalConstant(
  expr: Node,
  constants: Map<string, number>,
  self: string,
): number | undefined {
  switch (expr.type) {
    case 'Literal':
      return typeof expr.value === 'number' ? expr.value : undefined
    case 'Identifier':
      return expr.name === self ? undefined : constants.get(expr.name)
    case 'ParenthesizedExpression':
      return evalConstant(expr.expression, constants, self)
    case 'UnaryExpression': {
      const value = evalConstant(expr.argument, constants, self)
      if (value === undefined) {
        return undefined
      }
      switch (expr.operator) {
        case '-':
          return -value
        case '+':
          return value
        case '~':
          return ~value
        default:
          return undefined
      }
    }
    case 'BinaryExpression': {
      const l = evalConstant(expr.left, constants, self)
      const r = evalConstant(expr.right, constants, self)
      if (l === undefined || r === undefined) {
        return undefined
      }
      switch (expr.operator) {
        case '+':
          return l + r
        case '-':
          return l - r
        case '*':
          return l * r
        case '/':
          return l / r
        case '%':
          return l % r
        case '**':
          return l ** r
        case '<<':
          return l << r
        case '>>':
          return l >> r
        case '>>>':
          return l >>> r
        case '|':
          return l | r
        case '&':
          return l & r
        case '^':
          return l ^ r
        default:
          return undefined
      }
    }
    default:
      return undefined
  }
}

/**
 * Rewrite bare references to this enum's members inside a non-constant
 * initializer (`B = A + f()` → `B = E.A + f()`): inside the IIFE only the
 * enum binding itself is in scope.
 */
function qualifyMemberReferences(
  blanker: Blanker,
  expr: Node,
  enumName: string,
  memberNames: Set<string>,
): void {
  const visit = (node: Node, isPropertyPosition: boolean): void => {
    if (node.type === 'Identifier') {
      if (!isPropertyPosition && memberNames.has(node.name)) {
        blanker.output.override(
          node.start,
          node.end,
          `${enumName}.${node.name}`,
        )
      }
      return
    }
    if (node.type === 'MemberExpression') {
      visit(node.object, false)
      if (node.computed) {
        visit(node.property, false)
      }
      return
    }
    if (node.type === 'Property') {
      if (node.computed) {
        visit(node.key, false)
      }
      visit(node.value, false)
      return
    }
    const keys = visitorKeys[node.type]
    if (!keys) {
      return
    }
    for (const key of keys) {
      const value = (node as Node & Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item)) {
            visit(item, false)
          }
        }
      }
      else if (isNode(value)) {
        visit(value, false)
      }
    }
  }
  visit(expr, false)
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
    && typeof (value as { start?: unknown }).start === 'number'
}
