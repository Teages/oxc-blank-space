import type { Comment, Node } from "oxc-parser";
import BlankString from "./blank-string.js";
import { Trivia } from "./trivia.js";
import {
    type OnError,
    VISIT_BLANKED,
    VISIT_JS,
    type VisitResult,
} from "./types.js";

/**
 * Per-run state plus the primitive blanking operations. The walk logic lives in
 * walk.ts and friends; they coordinate through an instance of this class.
 */
export class Blanker {
    readonly output: BlankString;
    readonly trivia: Trivia;

    /** True while the previously emitted JS did not end with a `;`. */
    semicolonNeeded = false;
    /** Statement currently being walked, used by the `as`/`satisfies` rule. */
    parentStatement: Node | undefined;
    /** Set by walk.ts; the recursive dispatch over AST nodes. */
    visitNode: (node: Node) => VisitResult = () => VISIT_JS;

    constructor(
        readonly src: string,
        comments: readonly Comment[],
        private readonly onError: OnError | undefined,
    ) {
        this.output = new BlankString(src);
        this.trivia = new Trivia(src, comments);
    }

    /** Report an unsupported construct; its source stays in the output. */
    report(node: Node): void {
        this.onError?.({ type: node.type, start: node.start, end: node.end });
    }

    blankRange(start: number, end: number): void {
        this.output.blank(start, end);
    }

    /** Blank [node.start, node.end). */
    blankExact(node: Node): void {
        this.output.blank(node.start, node.end);
    }

    /**
     * Blank a statement-like node that is being fully erased. A leading `;` is
     * emitted when the previous emitted JS lacks one, so that a following
     * statement cannot merge into it (ASI protection).
     */
    blankStatement(node: Node): void {
        if (this.semicolonNeeded) {
            this.output.blankButStartWithSemi(node.start, node.end);
        } else {
            this.output.blank(node.start, node.end);
        }
    }

    /** Blank a `: T` type annotation; oxc spans include the colon. */
    blankTypeAnnotation(annotation: Node): void {
        this.output.blank(annotation.start, annotation.end);
    }

    /** Blank a node and, when directly followed by a comma, the comma too. */
    blankExactAndOptionalTrailingComma(node: Node): void {
        const comma = this.trivia.scanChar(node.end);
        this.output.blank(
            node.start,
            this.src[comma] === "," ? comma + 1 : node.end,
        );
    }

    /**
     * Whether the node text ends with `;` or a same-line `;` directly follows
     * it. Parity helper: the TypeScript AST counts trailing semicolons as part
     * of statement spans, oxc does not.
     */
    endsWithSemicolon(node: Node): boolean {
        return this.trivia.endsWithSemicolon(node.start, node.end);
    }

    /** Visit a nested node, keeping the semicolon state up to date. */
    visitNested(node: Node): VisitResult {
        const result = this.visitNode(node);
        if (result === VISIT_JS) {
            this.semicolonNeeded = !this.endsWithSemicolon(node);
        }
        return result;
    }

    /**
     * Visit an array of children. When `isStatementLike` is set, each child is
     * tracked as `parentStatement` (used by the `as`/`satisfies` rule) and
     * updates the semicolon state after each visited child. Entering a function
     * body resets the semicolon state, mirroring the nested execution context.
     */
    visitNodeArray(
        nodes: readonly Node[],
        isStatementLike: boolean,
        isFunctionBody: boolean,
        visitChild: (node: Node) => VisitResult,
    ): VisitResult {
        const previousParentStatement = this.parentStatement;
        const previousSemicolonNeeded = this.semicolonNeeded;
        if (isFunctionBody) {
            this.semicolonNeeded = false;
        }
        for (const node of nodes) {
            if (isStatementLike) {
                this.parentStatement = node;
            }
            if (visitChild(node) === VISIT_JS) {
                this.semicolonNeeded = !this.endsWithSemicolon(node);
            }
        }
        this.parentStatement = previousParentStatement;
        if (isFunctionBody) {
            this.semicolonNeeded = previousSemicolonNeeded;
        }
        return this.semicolonNeeded ? VISIT_JS : VISIT_BLANKED;
    }
}
