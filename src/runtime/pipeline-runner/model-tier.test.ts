import { describe, it, expect } from "vitest";
import { resolveModelTier, DEFAULT_TIER_MAP } from "./model-tier.js";

describe("resolveModelTier", () => {
  it("resolves lite to the default lite model (no tenantId)", async () => {
    expect(await resolveModelTier("lite")).toBe(DEFAULT_TIER_MAP.lite);
  });

  it("resolves standard to the default standard model (no tenantId)", async () => {
    expect(await resolveModelTier("standard")).toBe(DEFAULT_TIER_MAP.standard);
  });

  it("resolves reasoning to the default reasoning model (no tenantId)", async () => {
    expect(await resolveModelTier("reasoning")).toBe(DEFAULT_TIER_MAP.reasoning);
  });

  it("allows override via custom map", async () => {
    const customMap = {
      lite: "custom-lite",
      standard: "custom-std",
      reasoning: "custom-rea",
    };
    expect(await resolveModelTier("lite", undefined, customMap)).toBe("custom-lite");
  });
});
