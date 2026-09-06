const REPLACE_WITH_OPEN_PAREN = 1;
const REPLACE_WITH_CLOSE_PAREN = 2;
const REPLACE_WITH_SEMI = 3;

function getSpace(input: string, start: number, end: number): string {
    let out = "";
    for (let i = start; i < end; i++) {
        const charCode = input.charCodeAt(i);
        switch (charCode) {
            case 10 /* \n */:
                out += "\n";
                break;
            case 13 /* \r */:
                out += "\r";
                break;
            default:
                out += " ";
        }
    }
    return out;
}

/** Like magic-string but with only one feature. */
export default class BlankString {
    private readonly input: string;
    private readonly ranges: number[] = [];

    constructor(input: string) {
        this.input = input;
    }

    blankButStartWithOpenParen(start: number, end: number): void {
        this.ranges.push(REPLACE_WITH_OPEN_PAREN, start, end);
    }

    blankButEndWithCloseParen(start: number, end: number): void {
        this.ranges.push(0, start, end - 1);
        this.ranges.push(REPLACE_WITH_CLOSE_PAREN, end - 1, end);
    }

    blankButStartWithSemi(start: number, end: number): void {
        this.ranges.push(REPLACE_WITH_SEMI, start, end);
    }

    blank(start: number, end: number): void {
        this.ranges.push(0, start, end);
    }

    toString(): string {
        const ranges = this.ranges;
        const input = this.input;
        if (ranges.length === 0) {
            return input;
        }

        let out = "";
        let previousEnd = 0;
        const max = Math.max;

        for (let i = 0; i < ranges.length; i += 3) {
            const flags = ranges[i] as number;
            let rangeStart = ranges[i + 1] as number;
            const rangeEnd = ranges[i + 2] as number;

            rangeStart = max(rangeStart, previousEnd);
            out += input.slice(previousEnd, rangeStart);

            if (flags === REPLACE_WITH_CLOSE_PAREN) {
                out += ")";
                rangeStart += 1;
            } else if (flags === REPLACE_WITH_SEMI) {
                out += ";";
                rangeStart += 1;
            } else if (flags === REPLACE_WITH_OPEN_PAREN) {
                out += "(";
                rangeStart += 1;
            }

            previousEnd = rangeEnd;
            out += getSpace(input, rangeStart, previousEnd);
        }

        return out + input.slice(previousEnd);
    }
}
