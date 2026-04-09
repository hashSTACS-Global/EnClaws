import { describe, expect, test } from "vitest";
import { extractHandWrittenContent, parseDedupResponse } from "./dedup-check.js";
import { MARKER_START, MARKER_END } from "./publish.js";

describe("extractHandWrittenContent", () => {
  test("extracts content outside marker block", () => {
    const content = `# Notes\n\nHand written stuff.\n\n${MARKER_START}\nauto content\n${MARKER_END}\n\nMore hand written.`;
    const result = extractHandWrittenContent(content);
    expect(result).toContain("Hand written stuff.");
    expect(result).toContain("More hand written.");
    expect(result).not.toContain("auto content");
  });

  test("returns full content when no markers", () => {
    const content = "# All hand written\n\n- item 1\n- item 2";
    expect(extractHandWrittenContent(content)).toBe(content.trim());
  });

  test("returns empty string for empty content", () => {
    expect(extractHandWrittenContent("")).toBe("");
  });

  test("returns empty string when only marker block exists", () => {
    const content = `${MARKER_START}\nauto only\n${MARKER_END}`;
    expect(extractHandWrittenContent(content)).toBe("");
  });
});

describe("parseDedupResponse", () => {
  test("parses valid JSON array", () => {
    const input = JSON.stringify([
      { recordId: "r1", isDuplicate: true, matchedLine: "some line" },
      { recordId: "r2", isDuplicate: false, matchedLine: "" },
    ]);
    const result = parseDedupResponse(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ recordId: "r1", isDuplicate: true, matchedLine: "some line" });
    expect(result[1]).toEqual({ recordId: "r2", isDuplicate: false, matchedLine: "" });
  });

  test("handles markdown-fenced JSON", () => {
    const input = '```json\n[{"recordId":"r1","isDuplicate":true,"matchedLine":"x"}]\n```';
    const result = parseDedupResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].isDuplicate).toBe(true);
  });

  test("returns empty array for invalid JSON", () => {
    const result = parseDedupResponse("not json at all");
    expect(result).toEqual([]);
  });

  test("returns empty array for non-array JSON", () => {
    const result = parseDedupResponse('{"key": "value"}');
    expect(result).toEqual([]);
  });

  test("skips items with missing required fields", () => {
    const input = JSON.stringify([
      { recordId: "r1", isDuplicate: true, matchedLine: "x" },
      { recordId: "r2" }, // missing isDuplicate
      { isDuplicate: false }, // missing recordId
    ]);
    const result = parseDedupResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe("r1");
  });

  test("defaults matchedLine to empty string when null", () => {
    const input = JSON.stringify([
      { recordId: "r1", isDuplicate: false, matchedLine: null },
    ]);
    const result = parseDedupResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].matchedLine).toBe("");
  });
});
