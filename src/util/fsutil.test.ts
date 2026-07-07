import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256, languageOf, walkRepo, readFileSafe, fileExists } from "./fsutil.js";

describe("sha256", () => {
  it("is stable and content-sensitive", () => {
    expect(sha256("a")).toBe(sha256("a"));
    expect(sha256("a")).not.toBe(sha256("b"));
    expect(sha256("").length).toBe(64);
  });
});

describe("languageOf", () => {
  it("maps known extensions", () => {
    expect(languageOf("a/b.ts")).toBe("ts");
    expect(languageOf("x.PY")).toBe("py");
    expect(languageOf("readme.md")).toBe("md");
    expect(languageOf("data.bin")).toBe("other");
  });
});

describe("walkRepo", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-walk-"));
    await fs.writeFile(path.join(dir, "a.ts"), "x");
    await fs.mkdir(path.join(dir, "sub"), { recursive: true });
    await fs.writeFile(path.join(dir, "sub", "b.ts"), "x");
    await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(dir, "node_modules", "pkg", "index.js"), "x");
    await fs.writeFile(path.join(dir, ".gitignore"), "ignored.txt\n");
    await fs.writeFile(path.join(dir, "ignored.txt"), "x");
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns posix paths, excluding node_modules and gitignored files", async () => {
    const files = await walkRepo(dir);
    expect(files).toEqual(["a.ts", "sub/b.ts"]);
  });

  it("honours extra excludes", async () => {
    const files = await walkRepo(dir, ["**/sub/**"]);
    expect(files).toEqual(["a.ts"]);
  });
});

describe("readFileSafe / fileExists", () => {
  it("reads existing files and returns null for missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-read-"));
    await fs.writeFile(path.join(dir, "f.txt"), "hello");
    expect(await readFileSafe(dir, "f.txt")).toBe("hello");
    expect(await readFileSafe(dir, "nope.txt")).toBeNull();
    expect(await fileExists(path.join(dir, "f.txt"))).toBe(true);
    expect(await fileExists(path.join(dir, "nope.txt"))).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("skips oversized files and binary content", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-read2-"));
    await fs.writeFile(path.join(dir, "big.json"), "0".repeat(2_000_000));
    await fs.writeFile(path.join(dir, "bin.dat"), Buffer.from([0x68, 0x69, 0x00, 0x01]));
    await fs.writeFile(path.join(dir, "ok.ts"), "export const x = 1;\n");
    expect(await readFileSafe(dir, "big.json")).toBeNull();
    expect(await readFileSafe(dir, "bin.dat")).toBeNull();
    expect(await readFileSafe(dir, "ok.ts")).toBe("export const x = 1;\n");
    await fs.rm(dir, { recursive: true, force: true });
  });
});
