import { describe, it, expect } from "vitest";
import { parseCliOutput } from "./cli.js";

describe("parseCliOutput", () => {
  it("extracts the result field from JSON output", () => {
    expect(parseCliOutput('{"type":"result","result":"hello world"}')).toBe("hello world");
  });

  it("throws on an error-flagged response", () => {
    expect(() => parseCliOutput('{"is_error":true,"result":"rate limited"}')).toThrow(
      /rate limited/,
    );
  });

  it("throws on an explicit error field", () => {
    expect(() => parseCliOutput('{"error":"boom"}')).toThrow(/boom/);
  });

  it("falls back to raw text when output is not JSON", () => {
    expect(parseCliOutput("just plain text\n")).toBe("just plain text");
  });

  it("returns raw JSON when there is no result/error field", () => {
    const s = '{"type":"other"}';
    expect(parseCliOutput(s)).toBe(s);
  });
});
