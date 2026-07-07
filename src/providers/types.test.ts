import { describe, it, expect } from "vitest";
import { extractJson } from "./types.js";

describe("extractJson", () => {
  it("extracts a plain object", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("extracts an object embedded in prose", () => {
    const text = 'Sure! Here is the result:\n{"ok": true}\nHope that helps.';
    expect(extractJson(text)).toBe('{"ok": true}');
  });

  it("extracts an array", () => {
    expect(extractJson("noise [1, 2, 3] trailing")).toBe("[1, 2, 3]");
  });

  it("handles braces inside strings", () => {
    const text = '{"msg": "a } b { c"}';
    expect(extractJson(text)).toBe(text);
  });

  it("handles nested structures", () => {
    const text = 'prefix {"a": {"b": [1, {"c": 2}]}} suffix';
    expect(extractJson(text)).toBe('{"a": {"b": [1, {"c": 2}]}}');
  });

  it("returns null when there is no JSON", () => {
    expect(extractJson("just some words")).toBeNull();
  });

  it("ignores braces inside escaped strings", () => {
    const text = '{"path": "C:\\\\dir\\"}"}';
    // The escaped quote should not prematurely close the string.
    const out = extractJson(text);
    expect(out).toBe(text);
  });
});
