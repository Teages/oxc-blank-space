import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import tsBlankSpace from "ts-blank-space";
import { transpile } from "../src/index.js";

const fixtureDir = join(import.meta.dir, "fixture");

for (const filename of readdirSync(fixtureDir).filter((f) =>
    f.endsWith(".ts"),
)) {
    test(`fixture: ${filename}`, () => {
        // Given: a case file from the ts-blank-space fixture corpus and its
        // committed expected output
        const input = readFileSync(join(fixtureDir, filename), "utf8");
        const expected = readFileSync(
            join(fixtureDir, filename.replace(/\.ts$/, ".js")),
            "utf8",
        );
        // When: transpiled with this library and with ts-blank-space
        const output = transpile(input);
        const reference = tsBlankSpace(input);
        // Then: all three agree byte for byte
        expect(output).toBe(reference);
        expect(output).toBe(expected);
    });
}
