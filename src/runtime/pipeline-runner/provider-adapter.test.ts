import { describe, it, expect, vi } from "vitest";
import { createProviderCallFn } from "./provider-adapter.js";

describe("provider-adapter", () => {
  it("translates LLMCallInput → EC provider call → string response", async () => {
    const mockEcProvider = vi.fn().mockResolvedValue({
      text: '{"summary": "generated summary"}',
    });
    const callProvider = createProviderCallFn({
      ecProvider: mockEcProvider,
    });
    const result = await callProvider({
      prompt: "Please summarize",
      model: "claude-sonnet-4-6",
      tenantId: "tenant-a",
    });
    expect(result).toBe('{"summary": "generated summary"}');
    expect(mockEcProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-6",
      }),
    );
  });
});
