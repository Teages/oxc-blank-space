import type { Trivia } from "./trivia.js";

/**
 * Binary operator precedence, mirroring TypeScript's
 * `getBinaryOperatorPrecedence` (see ts-blank-space for the numeric values).
 */
const PRECEDENCE = new Map<string, number>([
    ["**", 15],
    ["*", 14],
    ["/", 14],
    ["%", 14],
    ["+", 13],
    ["-", 13],
    ["<<", 12],
    [">>", 12],
    [">>>", 12],
    ["<", 11],
    ["<=", 11],
    [">", 11],
    [">=", 11],
    ["instanceof", 11],
    ["in", 11],
    ["==", 10],
    ["!=", 10],
    ["===", 10],
    ["!==", 10],
    ["&", 9],
    ["^", 8],
    ["|", 7],
    ["&&", 6],
    ["||", 5],
    ["??", 4],
]);

export const getBinaryOperatorPrecedence = (
    operator: string,
): number | undefined => PRECEDENCE.get(operator);

const isNullishOrLogical = (operator: string): boolean =>
    operator === "??" || operator === "||" || operator === "&&";

/** JavaScript requires explicit parentheses when mixing `??` with `||`/`&&`. */
export const hasUnsafeNullishLogicalMix = (
    left: string,
    right: string,
): boolean => {
    if (left === right) return false;
    if (left === "??") return isNullishOrLogical(right);
    if (right === "??") return isNullishOrLogical(left);
    return false;
};

const OPERATOR_SYMBOLS = "+-*/%<>=!&|^~?";
const SYMBOL_OPERATORS = [
    ">>>",
    "===",
    "!==",
    "**",
    "<<",
    ">>",
    "<=",
    ">=",
    "==",
    "!=",
    "&&",
    "||",
    "??",
];

const isWordStart = (char: string | undefined): boolean =>
    char !== undefined && /[A-Za-z]/.test(char);

/**
 * The binary operator token starting at or after `pos`, or `undefined` when the
 * next token is not a binary operator (punctuation, keyword, literal, ...).
 */
export function nextOperatorAfter(
    src: string,
    trivia: Trivia,
    pos: number,
): string | undefined {
    const start = trivia.skipForward(pos);
    const char = src[start];
    if (char === undefined) return undefined;
    if (isWordStart(char)) {
        const word = trivia.scanWord(start);
        return word && (word.word === "instanceof" || word.word === "in")
            ? word.word
            : undefined;
    }
    if (!OPERATOR_SYMBOLS.includes(char)) return undefined;
    let end = start;
    while (
        src[end] !== undefined &&
        OPERATOR_SYMBOLS.includes(src[end] as string)
    )
        end += 1;
    const run = src.slice(start, end);
    return SYMBOL_OPERATORS.find((candidate) => run === candidate) ?? run;
}
