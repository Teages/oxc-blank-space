import type {
    AccessorProperty,
    Class,
    MethodDefinition,
    Node,
    PropertyDefinition,
    TSClassImplements,
} from "oxc-parser";
import type { Blanker } from "./blanker.js";
import { VISIT_BLANKED, VISIT_JS, type VisitResult } from "./types.js";
import { blankTypeParameters } from "./visit-function.js";

type ClassMember = PropertyDefinition | AccessorProperty | MethodDefinition;

const REMOVED_MEMBER_KEYWORDS = new Set([
    "public",
    "protected",
    "private",
    "readonly",
    "override",
    "abstract",
    "declare",
]);

export function visitClassLike(blanker: Blanker, node: Class): VisitResult {
    // The declare check comes first: an erased class takes its decorators with
    // it, so they must not be visited (and partially kept) beforehand.
    if (node.declare) {
        blanker.blankStatement(node);
        return VISIT_BLANKED;
    }

    for (const decorator of node.decorators) {
        blanker.visitNested(decorator);
    }

    if (node.abstract) {
        blankAbstractKeyword(blanker, node);
    }

    if (node.typeParameters && node.typeParameters.params.length > 0) {
        blankTypeParameters(blanker, node.typeParameters, -1);
    }

    if (node.superClass) {
        blanker.visitNested(node.superClass);
    }
    if (node.superTypeArguments) {
        blanker.blankRange(
            node.superTypeArguments.start,
            node.superTypeArguments.end,
        );
    }
    const implementsClause = node.implements;
    if (implementsClause && implementsClause.length > 0) {
        blankImplementsClause(blanker, node, implementsClause);
    }

    blanker.visitNodeArray(node.body.body, true, false, (member) =>
        visitClassMember(blanker, member),
    );
    return VISIT_JS;
}

export function visitClassMember(blanker: Blanker, member: Node): VisitResult {
    switch (member.type) {
        case "StaticBlock":
            blanker.visitNodeArray(member.body, true, false, (child) =>
                blanker.visitNode(child),
            );
            return VISIT_JS;
        case "TSIndexSignature":
            blanker.blankExact(member);
            return VISIT_BLANKED;
        case "PropertyDefinition":
        case "TSAbstractPropertyDefinition":
        case "AccessorProperty":
        case "TSAbstractAccessorProperty":
            return visitProperty(blanker, member);
        case "MethodDefinition":
        case "TSAbstractMethodDefinition":
            return visitMethod(blanker, member);
        default:
            return VISIT_JS;
    }
}

function visitProperty(
    blanker: Blanker,
    member: PropertyDefinition | AccessorProperty,
): VisitResult {
    // Abstract/declare properties have no runtime behavior.
    if (member.type.startsWith("TSAbstract") || member.declare) {
        blanker.blankStatement(member);
        return VISIT_BLANKED;
    }

    blankRemovedMemberKeywords(blanker, member, member.computed);
    blanker.visitNested(member.key);

    const anchor =
        member.typeAnnotation?.start ?? member.value?.start ?? member.end;
    if (member.definite) blankMarkerAfterKey(blanker, anchor, "!");
    if (member.optional) blankMarkerAfterKey(blanker, anchor, "?");

    if (member.typeAnnotation) {
        blanker.blankTypeAnnotation(member.typeAnnotation);
    }
    if (member.value) {
        blanker.visitNested(member.value);
    }
    return VISIT_JS;
}

function visitMethod(blanker: Blanker, member: MethodDefinition): VisitResult {
    // Abstract methods and overload signatures are erased entirely.
    if (member.type.startsWith("TSAbstract") || member.value.body === null) {
        blanker.blankExact(member);
        return VISIT_BLANKED;
    }

    blankRemovedMemberKeywords(blanker, member, member.computed);
    blanker.visitNested(member.key);
    if (member.optional) {
        blankMarkerAfterKey(blanker, member.value.start, "?");
    }
    return blanker.visitNode(member.value);
}

function blankAbstractKeyword(blanker: Blanker, node: Class): void {
    const word = blanker.trivia.scanWord(node.start);
    if (word && word.word === "abstract") {
        blanker.blankRange(word.start, word.start + word.word.length);
    }
}

function blankImplementsClause(
    blanker: Blanker,
    node: Class,
    clause: readonly TSClassImplements[],
): void {
    // Anchor after the pieces that can precede `implements`.
    const anchor =
        node.superTypeArguments?.end ??
        node.superClass?.end ??
        node.typeParameters?.end ??
        node.id?.end ??
        node.start + 5;
    const word = blanker.trivia.scanWord(anchor);
    if (word?.word !== "implements") return;
    const last = clause[clause.length - 1] as TSClassImplements;
    blanker.blankRange(word.start, last.end);
}

function blankMarkerAfterKey(
    blanker: Blanker,
    anchor: number,
    marker: string,
): void {
    const position = blanker.trivia.skipBackward(anchor);
    if (blanker.src[position] === marker) {
        blanker.blankRange(position, position + 1);
    }
}

/**
 * Erase the TypeScript-only keywords (accessibility, `readonly`, `override`,
 * `abstract`, `declare`) in the modifier region before the member key while
 * keeping JavaScript keywords (`static`, `async`, `get`, `set`, `accessor`,
 * `*`) and decorators. oxc exposes modifiers as flags without positions, so
 * the region is tokenized: every word is classified, decorators are skipped by
 * their spans. When `addSemi` is set (computed keys, an ASI hazard), a leading
 * erased keyword is replaced by a `;` — but only when nothing (decorator or
 * kept keyword) precedes it, mirroring ts-blank-space's modifiers[0] check.
 */
function blankRemovedMemberKeywords(
    blanker: Blanker,
    member: ClassMember,
    addSemi: boolean,
): void {
    const keyStart = member.key.start;
    const src = blanker.src;
    const decorators = member.decorators;
    let removedCount = 0;
    let sawPrecedingItem = false;
    let pos = member.start;

    while (pos < keyStart) {
        pos = blanker.trivia.skipForward(pos);
        if (pos >= keyStart) break;

        const decorator = decorators.find((d) => d.start <= pos && pos < d.end);
        if (decorator) {
            blanker.visitNested(decorator);
            pos = decorator.end;
            sawPrecedingItem = true;
            continue;
        }

        const char = src[pos];
        if (char === undefined) break;
        if (/[A-Za-z_$]/.test(char)) {
            let end = pos;
            while (end < keyStart && /[A-Za-z0-9_$]/.test(src[end] as string))
                end += 1;
            const word = src.slice(pos, end);
            if (REMOVED_MEMBER_KEYWORDS.has(word)) {
                if (addSemi && removedCount === 0 && !sawPrecedingItem) {
                    blanker.output.blankButStartWithSemi(pos, end);
                } else {
                    blanker.blankRange(pos, end);
                }
                removedCount += 1;
            }
            sawPrecedingItem = true;
            pos = end;
            continue;
        }

        // `*` (generator) and anything unexpected stays as-is.
        pos += 1;
    }
}
