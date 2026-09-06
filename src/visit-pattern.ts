import type { Node } from "oxc-parser";
import type { Blanker } from "./blanker.js";
import { VISIT_JS, type VisitResult } from "./types.js";

export function visitVariableDeclarator(
    blanker: Blanker,
    node: Extract<Node, { type: "VariableDeclarator" }>,
): VisitResult {
    if (node.definite) {
        blankMarkerChar(
            blanker,
            node.id.typeAnnotation?.start ?? node.id.end,
            "!",
        );
    }
    visitPattern(blanker, node.id);
    if (node.init) {
        blanker.visitNested(node.init);
    }
    return VISIT_JS;
}

/**
 * Visit a binding pattern (function parameter, catch variable, declarator id).
 * Annotations and `?`/`!` markers hanging on the pattern are erased; the
 * pattern's names and defaults stay.
 */
export function visitPattern(blanker: Blanker, node: Node): VisitResult {
    switch (node.type) {
        case "TSParameterProperty": {
            // Constructor parameter properties create runtime members.
            blanker.report(node);
            return visitPattern(blanker, node.parameter);
        }
        case "RestElement": {
            const result = visitPattern(blanker, node.argument);
            blankOwnAnnotation(blanker, node);
            return result;
        }
        case "AssignmentPattern": {
            const result = visitPattern(blanker, node.left);
            blankOwnAnnotation(blanker, node);
            blanker.visitNested(node.right);
            return result;
        }
        case "Property": {
            // Binding property: `{ a: b = 1 }` or shorthand `{ a }`.
            blanker.visitNested(node.key);
            return visitPattern(blanker, node.value);
        }
        case "ArrayPattern": {
            for (const element of node.elements) {
                if (element) visitPattern(blanker, element);
            }
            blankOwnAnnotation(blanker, node);
            return VISIT_JS;
        }
        case "ObjectPattern": {
            for (const property of node.properties) {
                visitPattern(blanker, property);
            }
            blankOwnAnnotation(blanker, node);
            return VISIT_JS;
        }
        default: {
            // Identifiers and anything else that can carry an annotation.
            blankOwnAnnotation(blanker, node);
            return VISIT_JS;
        }
    }
}

/**
 * Erase the `?` / `!` marker that sits directly before the pattern's type
 * annotation (or at the end of the pattern span). oxc exposes only an
 * `optional`/`definite` flag, so the character is located by scanning trivia
 * backwards from the annotation's colon.
 */
function blankPatternMarkers(blanker: Blanker, node: Node): void {
    const { optional, definite } = node as Node & {
        optional?: boolean;
        definite?: boolean;
    };
    if (!optional && !definite) return;
    const annotation = (node as Node & { typeAnnotation?: Node | null })
        .typeAnnotation;
    blankMarkerChar(
        blanker,
        annotation?.start ?? node.end,
        optional ? "?" : "!",
    );
}

function blankMarkerChar(
    blanker: Blanker,
    anchor: number,
    marker: string,
): void {
    const position = blanker.trivia.skipBackward(anchor);
    if (blanker.src[position] === marker) {
        blanker.blankRange(position, position + 1);
    }
}

function blankOwnAnnotation(blanker: Blanker, node: Node): void {
    blankPatternMarkers(blanker, node);
    const annotation = (node as Node & { typeAnnotation?: Node | null })
        .typeAnnotation;
    if (annotation) {
        blanker.blankTypeAnnotation(annotation);
    }
}
