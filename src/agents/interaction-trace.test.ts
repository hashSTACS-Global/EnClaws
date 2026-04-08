import { describe, expect, it } from "vitest";
import { formatTraceError, extractErrorFromResponse } from "./interaction-trace";

describe("formatTraceError", () => {
  it("returns message from a standard Error", () => {
    expect(formatTraceError(new Error("something went wrong"))).toBe("something went wrong");
  });

  it("falls back to status when message is empty", () => {
    const err = new Error("");
    (err as unknown as Record<string, unknown>).status = 404;
    expect(formatTraceError(err)).toBe("Error: 404 status code (no body)");
  });

  it("uses error name when message and status are empty", () => {
    const err = new Error("");
    err.name = "TimeoutError";
    expect(formatTraceError(err)).toBe("TimeoutError");
  });

  it("stringifies non-Error values", () => {
    expect(formatTraceError("raw string error")).toBe("raw string error");
    expect(formatTraceError(42)).toBe("42");
  });

  it("returns fallback for empty string", () => {
    expect(formatTraceError("")).toBe("Unknown error");
  });
});

describe("extractErrorFromResponse", () => {
  it("extracts text from content array", () => {
    const response = [{ type: "text", text: "404 status code (no body)" }];
    expect(extractErrorFromResponse(response)).toBe("404 status code (no body)");
  });

  it("joins multiple text blocks", () => {
    const response = [
      { type: "text", text: "Error line 1" },
      { type: "text", text: "Error line 2" },
    ];
    expect(extractErrorFromResponse(response)).toBe("Error line 1\nError line 2");
  });

  it("skips non-text content blocks", () => {
    const response = [
      { type: "toolCall", name: "foo" },
      { type: "text", text: "actual error" },
    ];
    expect(extractErrorFromResponse(response)).toBe("actual error");
  });

  it("returns fallback for null/undefined response", () => {
    expect(extractErrorFromResponse(null)).toBe("LLM request failed (no response)");
    expect(extractErrorFromResponse(undefined)).toBe("LLM request failed (no response)");
  });

  it("returns string response directly", () => {
    expect(extractErrorFromResponse("error text")).toBe("error text");
  });

  it("returns fallback for empty array", () => {
    expect(extractErrorFromResponse([])).toBe("LLM request failed");
  });

  it("returns fallback for empty string", () => {
    expect(extractErrorFromResponse("")).toBe("LLM request failed");
  });
});
