import { beforeEach, describe, expect, it } from "vitest";
import {
  __testOnlyReset,
  __testOnlySize,
  issueGatewayToken,
  resolveGatewayToken,
  revokeGatewayToken,
  stopGatewayTokenSweep,
  sweepExpiredTokens,
  type GatewayTokenEntry,
} from "../../src/gateway/gateway-token-cache.js";

const TTL_MS = 24 * 60 * 60 * 1000;

function makeEntryInput(
  overrides: Partial<Omit<GatewayTokenEntry, "createdAt">> = {},
): Omit<GatewayTokenEntry, "createdAt"> {
  return {
    sessionLabel: "agent:test-agent|channel:feishu|group:oc_x|union:on_u|open:ou_o|name:Tester",
    internalSessionKey: "agent:test-agent:feishu:group:oc_x:sender:ou_o",
    tenantId: "tenant-1",
    agentSlug: "test-agent",
    channel: "feishu",
    userOpenId: "ou_o",
    userUnionId: "on_u",
    userDisplayName: "Tester",
    ...overrides,
  };
}

describe("gateway-token-cache", () => {
  let mockNow = 0;

  beforeEach(() => {
    mockNow = 1_700_000_000_000; // deterministic base
    __testOnlyReset({ ttlMs: TTL_MS, nowFn: () => mockNow });
    stopGatewayTokenSweep();
  });

  it("issues a token and resolves it back to the same entry", () => {
    const input = makeEntryInput();
    const token = issueGatewayToken(input);

    expect(token).toMatch(/^ectk_/);
    expect(token.length).toBeGreaterThan(20);

    const resolved = resolveGatewayToken(token);
    expect(resolved).not.toBeNull();
    expect(resolved?.tenantId).toBe(input.tenantId);
    expect(resolved?.agentSlug).toBe(input.agentSlug);
    expect(resolved?.userOpenId).toBe(input.userOpenId);
    expect(resolved?.sessionLabel).toBe(input.sessionLabel);
    expect(resolved?.createdAt).toBe(mockNow);
  });

  it("invalidates the previous token when a new one is issued for the same internalSessionKey", () => {
    const input = makeEntryInput();
    const tokenA = issueGatewayToken(input);
    const tokenB = issueGatewayToken(input);

    expect(tokenA).not.toBe(tokenB);
    expect(resolveGatewayToken(tokenA)).toBeNull();
    expect(resolveGatewayToken(tokenB)).not.toBeNull();

    const sizes = __testOnlySize();
    expect(sizes.tokenMap).toBe(1);
    expect(sizes.sessionToTokenMap).toBe(1);
  });

  it("keeps tokens from different sessions independent", () => {
    const tokenA = issueGatewayToken(makeEntryInput({ internalSessionKey: "session-A" }));
    const tokenB = issueGatewayToken(makeEntryInput({ internalSessionKey: "session-B" }));

    expect(resolveGatewayToken(tokenA)).not.toBeNull();
    expect(resolveGatewayToken(tokenB)).not.toBeNull();

    const sizes = __testOnlySize();
    expect(sizes.tokenMap).toBe(2);
    expect(sizes.sessionToTokenMap).toBe(2);
  });

  it("returns null for an unknown token", () => {
    expect(resolveGatewayToken("ectk_unknown_token_not_issued")).toBeNull();
    expect(resolveGatewayToken("")).toBeNull();
    expect(resolveGatewayToken("garbage")).toBeNull();
  });

  it("lazy-cleans expired entries on resolve", () => {
    const token = issueGatewayToken(makeEntryInput());
    expect(__testOnlySize().tokenMap).toBe(1);

    // Advance time past TTL
    mockNow += TTL_MS + 1;

    expect(resolveGatewayToken(token)).toBeNull();
    expect(__testOnlySize().tokenMap).toBe(0);
    expect(__testOnlySize().sessionToTokenMap).toBe(0);
  });

  it("does not lazy-clean entries within TTL", () => {
    const token = issueGatewayToken(makeEntryInput());
    mockNow += TTL_MS - 1;
    expect(resolveGatewayToken(token)).not.toBeNull();
    expect(__testOnlySize().tokenMap).toBe(1);
  });

  it("sweepExpiredTokens cleans all entries past TTL", () => {
    const tokenA = issueGatewayToken(makeEntryInput({ internalSessionKey: "session-A" }));
    const tokenB = issueGatewayToken(makeEntryInput({ internalSessionKey: "session-B" }));

    mockNow += TTL_MS + 1;
    const tokenC = issueGatewayToken(makeEntryInput({ internalSessionKey: "session-C" }));

    // At this point: A and B are expired (createdAt = base), C is fresh (createdAt = base + TTL + 1)
    const swept = sweepExpiredTokens();
    expect(swept).toBe(2);

    expect(resolveGatewayToken(tokenA)).toBeNull();
    expect(resolveGatewayToken(tokenB)).toBeNull();
    expect(resolveGatewayToken(tokenC)).not.toBeNull();

    const sizes = __testOnlySize();
    expect(sizes.tokenMap).toBe(1);
    expect(sizes.sessionToTokenMap).toBe(1);
  });

  it("sweepExpiredTokens returns 0 when nothing is expired", () => {
    issueGatewayToken(makeEntryInput({ internalSessionKey: "session-A" }));
    issueGatewayToken(makeEntryInput({ internalSessionKey: "session-B" }));
    mockNow += 1000;
    expect(sweepExpiredTokens()).toBe(0);
    expect(__testOnlySize().tokenMap).toBe(2);
  });

  it("revokeGatewayToken removes the token and session mapping", () => {
    const token = issueGatewayToken(makeEntryInput());
    expect(__testOnlySize().tokenMap).toBe(1);

    revokeGatewayToken(token);
    expect(resolveGatewayToken(token)).toBeNull();
    expect(__testOnlySize().tokenMap).toBe(0);
    expect(__testOnlySize().sessionToTokenMap).toBe(0);
  });

  it("revokeGatewayToken is a no-op for unknown tokens", () => {
    issueGatewayToken(makeEntryInput());
    const before = __testOnlySize();
    revokeGatewayToken("ectk_nonexistent");
    const after = __testOnlySize();
    expect(after).toEqual(before);
  });

  it("generated tokens are reasonably unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const token = issueGatewayToken(makeEntryInput({ internalSessionKey: `session-${i}` }));
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
    expect(seen.size).toBe(100);
  });

  it("preserves all attribution fields through issue → resolve roundtrip", () => {
    const input = makeEntryInput({
      sessionLabel: "agent:a|channel:c|group:g|union:u|open:o|name:N",
      internalSessionKey: "agent:a:c:g:u",
      tenantId: "t-unique",
      agentSlug: "agent-slug",
      channel: "wecom",
      userOpenId: "user-open",
      userUnionId: "user-union",
      userDisplayName: "张三",
    });
    const token = issueGatewayToken(input);
    const resolved = resolveGatewayToken(token);

    expect(resolved).toMatchObject({
      sessionLabel: input.sessionLabel,
      internalSessionKey: input.internalSessionKey,
      tenantId: input.tenantId,
      agentSlug: input.agentSlug,
      channel: input.channel,
      userOpenId: input.userOpenId,
      userUnionId: input.userUnionId,
      userDisplayName: input.userDisplayName,
    });
  });
});
