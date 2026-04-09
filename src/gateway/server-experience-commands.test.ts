import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { handleExperienceCommand } from "../auto-reply/reply/commands-experience.js";
import { handleDistillCommand } from "../auto-reply/reply/commands-distill.js";
import type { HandleCommandsParams } from "../auto-reply/reply/commands-types.js";
import type { OpenClawConfig } from "../config/config.js";
import type { MsgContext } from "../auto-reply/templating.js";

let tempDir: string;
let workspaceDir: string;
const tenantId = "test-tenant-001";

beforeEach(async () => {
  tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "enclaws-exp-cmd-gw-"));
  workspaceDir = path.join(tempDir, "tenants", tenantId, "users", "user1", "workspace");
  await fsPromises.mkdir(workspaceDir, { recursive: true });
});

afterEach(async () => {
  await fsPromises.rm(tempDir, { recursive: true, force: true });
});

function makeParams(commandBody: string): HandleCommandsParams {
  return {
    ctx: {
      TenantId: tenantId,
    } as unknown as MsgContext,
    cfg: {
      agents: {
        defaults: {
          workspace: workspaceDir,
          experience: {
            capture: { enabled: true },
            distill: { enabled: true },
          },
        },
      },
    } as unknown as OpenClawConfig,
    command: {
      surface: "test",
      channel: "test",
      ownerList: ["owner1"],
      senderIsOwner: true,
      isAuthorizedSender: true,
      senderId: "owner1",
      rawBodyNormalized: commandBody,
      commandBodyNormalized: commandBody,
    },
    directives: {},
    elevated: { enabled: false, allowed: false, failures: [] },
    sessionKey: "test-session",
    workspaceDir,
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolvedElevatedLevel: undefined,
    resolvedThinkLevel: undefined,
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "anthropic",
    model: "claude-opus-4-6",
    contextTokens: 100000,
    isGroup: false,
  } as unknown as HandleCommandsParams;
}

describe("experience command handler (gateway integration)", () => {
  test("/experience status — returns extraction status output", async () => {
    const params = makeParams("/experience status");
    const result = await handleExperienceCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toBeDefined();
    expect(result?.reply?.text).toContain("Experience Extraction Status");
    expect(result?.reply?.text).toContain("Candidates:");
    expect(result?.reply?.text).toContain("pending:");
  });

  test("/experience review — returns empty message when no pending records", async () => {
    const params = makeParams("/experience review");
    const result = await handleExperienceCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toBeDefined();
    // Should indicate no pending records
    const text = result?.reply?.text ?? "";
    expect(text.toLowerCase()).toMatch(/no.*pending|empty|nothing/i);
  });

  test("/experience approve — rejects empty indices", async () => {
    const params = makeParams("/experience approve");
    const result = await handleExperienceCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("Usage");
  });

  test("/experience reject — rejects empty indices", async () => {
    const params = makeParams("/experience reject");
    const result = await handleExperienceCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.reply?.text).toContain("Usage");
  });

  test("/experience unknown — returns usage help", async () => {
    const params = makeParams("/experience foobar");
    const result = await handleExperienceCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.reply?.text).toContain("Usage");
  });

  test("ignores non-experience commands", async () => {
    const params = makeParams("/help");
    const result = await handleExperienceCommand(params, true);
    expect(result).toBeNull();
  });

  test("blocks unauthorized senders", async () => {
    const params = makeParams("/experience status");
    params.command.isAuthorizedSender = false;
    const result = await handleExperienceCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply).toBeUndefined();
  });

  test("requires multi-tenant mode (no TenantId)", async () => {
    const params = makeParams("/experience status");
    (params.ctx as unknown as Record<string, unknown>).TenantId = undefined;
    const result = await handleExperienceCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.reply?.text).toContain("multi-tenant");
  });

  test("returns null when text commands are not allowed", async () => {
    const params = makeParams("/experience status");
    const result = await handleExperienceCommand(params, false);
    expect(result).toBeNull();
  });
});

describe("distill command handler (gateway integration)", () => {
  test("/distill — requires multi-tenant mode", async () => {
    const params = makeParams("/distill");
    const result = await handleDistillCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.shouldContinue).toBe(false);
    // With valid TenantId it should proceed (may succeed or report no candidates)
    expect(result?.reply?.text).toBeDefined();
  });

  test("/distill — rejects when no TenantId", async () => {
    const params = makeParams("/distill");
    (params.ctx as unknown as Record<string, unknown>).TenantId = undefined;
    const result = await handleDistillCommand(params, true);
    expect(result?.reply?.text).toContain("multi-tenant");
  });

  test("ignores non-distill commands", async () => {
    const params = makeParams("/help");
    const result = await handleDistillCommand(params, true);
    expect(result).toBeNull();
  });
});
