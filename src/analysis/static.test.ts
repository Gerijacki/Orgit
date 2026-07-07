import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLongFunctions, runStaticAnalyzers, stripNonCode } from "./static.js";
import { buildMentalModel } from "./model.js";
import { DEFAULT_CONFIG } from "../config/config.js";

describe("findLongFunctions", () => {
  it("flags a long brace-language function", () => {
    const body = Array.from({ length: 80 }, (_, i) => `  const v${i} = ${i};`).join("\n");
    const code = `function big(x) {\n${body}\n  return x;\n}\n`;
    const hits = findLongFunctions(code, "ts");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe("big");
    expect(hits[0]!.length).toBeGreaterThan(60);
  });

  it("ignores short functions", () => {
    const code = `function small(x) {\n  return x + 1;\n}\n`;
    expect(findLongFunctions(code, "ts")).toHaveLength(0);
  });

  it("does not flag long control-flow blocks as functions", () => {
    const body = Array.from({ length: 80 }, (_, i) => `    total += arr[${i}];`).join("\n");
    const code = `let total = 0;\nif (ready) {\n${body}\n}\n`;
    // `if (...) {` must not be mistaken for a function named "if".
    expect(findLongFunctions(code, "ts")).toHaveLength(0);
  });

  it("flags a long Python function via indentation", () => {
    const body = Array.from({ length: 80 }, (_, i) => `    v${i} = ${i}`).join("\n");
    const code = `def big(x):\n${body}\n    return x\n`;
    const hits = findLongFunctions(code, "py");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe("big");
  });

  it("stops a Python function at a dedent", () => {
    const longBody = Array.from({ length: 80 }, (_, i) => `    a${i} = ${i}`).join("\n");
    const code = `def big(x):\n${longBody}\n\ndef small(y):\n    return y\n`;
    const hits = findLongFunctions(code, "py");
    expect(hits.map((h) => h.name)).toEqual(["big"]);
  });

  it("ignores braces inside strings and comments when measuring length", () => {
    const body = Array.from({ length: 80 }, (_, i) => `  const v${i} = ${i};`).join("\n");
    // A `}` in a string and a `}` in a block comment must not close the function early.
    const code =
      `function big(x) {\n` +
      `  const s = "a } b";\n` +
      `  /* a stray } brace\n     spanning } lines */\n` +
      `${body}\n` +
      `  return x;\n}\n`;
    const hits = findLongFunctions(code, "ts");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe("big");
    expect(hits[0]!.length).toBeGreaterThan(80);
  });

  it("does not report a function whose only closing brace is inside a string", () => {
    // Without the string/comment strip, the `}` in the string would falsely close it.
    const code = `function f() {\n  const s = "}";\n  return s;\n}\n`;
    expect(findLongFunctions(code, "ts")).toHaveLength(0);
  });
});

describe("stripNonCode", () => {
  it("removes string, line-comment and block-comment content", () => {
    expect(stripNonCode('a { "x } y" } // } tail', false).code).toBe("a {  } ");
    expect(stripNonCode("keep /* drop } */ more", false).code).toBe("keep  more");
  });

  it("carries block-comment state across lines", () => {
    const first = stripNonCode("code /* open }", false);
    expect(first.inBlockComment).toBe(true);
    expect(first.code).toBe("code ");
    const second = stripNonCode("} still } comment */ real", first.inBlockComment);
    expect(second.inBlockComment).toBe(false);
    expect(second.code).toBe(" real");
  });
});

describe("runStaticAnalyzers", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("flags large files and long functions over a real mental model", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-static-"));
    // A 450-line file that also contains a long function.
    const longFn = `function big(x) {\n${Array.from(
      { length: 80 },
      (_, i) => `  const v${i}=${i};`,
    ).join("\n")}\n  return x;\n}\n`;
    const filler = Array.from({ length: 360 }, (_, i) => `const c${i} = ${i};`).join("\n");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src", "big.ts"), `${longFn}\n${filler}\n`, "utf8");
    await fs.writeFile(path.join(dir, "src", "small.ts"), "export const ok = 1;\n", "utf8");

    const model = await buildMentalModel(dir, DEFAULT_CONFIG);
    const ops = await runStaticAnalyzers(model);

    expect(ops.some((o) => o.kind === "large-file" && o.files.includes("src/big.ts"))).toBe(true);
    expect(ops.some((o) => o.kind === "long-function")).toBe(true);
    // The tiny file is not flagged.
    expect(ops.some((o) => o.files.includes("src/small.ts"))).toBe(false);
    // All static findings are attributed to the static source.
    expect(ops.every((o) => o.source === "static")).toBe(true);
  });
});
