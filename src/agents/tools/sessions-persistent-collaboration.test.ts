import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const spawnSubagentDirectMock = vi.fn();
  const callGatewayMock = vi.fn();
  return {
    spawnSubagentDirectMock,
    callGatewayMock,
  };
});

vi.mock("../subagent-spawn.js", () => ({
  SUBAGENT_SPAWN_MODES: ["run", "session"],
  spawnSubagentDirect: (...args: unknown[]) => hoisted.spawnSubagentDirectMock(...args),
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => hoisted.callGatewayMock(opts),
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      session: { scope: "per-sender", mainKey: "main" },
      tools: {
        agentToAgent: { enabled: true, allow: ["*"] },
        sessions: { visibility: "all" },
      },
      agents: {
        defaults: {
          subagents: {
            maxSpawnDepth: 5,
          },
        },
      },
    }),
  };
});

describe("Persistent Agent Collaboration Loop", async () => {
  const { createSessionsSpawnTool } = await import("./sessions-spawn-tool.js");
  const { createSessionsSendTool } = await import("./sessions-send-tool.js");

  beforeEach(() => {
    hoisted.spawnSubagentDirectMock.mockReset();
    hoisted.callGatewayMock.mockClear();
  });

  it("should spawn a persistent subagent and then send messages to it securely", async () => {
    // 1. Test Spawning the persistent subagent
    const childSessionKey = "agent:db-agent:subagent:12345";
    hoisted.spawnSubagentDirectMock.mockResolvedValueOnce({
      status: "accepted",
      childSessionKey,
      runId: "run-spawn",
      mode: "session",
    });

    const spawnTool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
      agentAccountId: "default",
    });

    const spawnResult = await spawnTool.execute("spawn-1", {
      task: "You are a specialized Database Agent.",
      agentId: "db-agent",
      label: "db-expert",
      mode: "session", // PERSISTENT
      thread: true,
      cleanup: "keep",
    });

    expect(spawnResult.details).toMatchObject({
      status: "accepted",
      childSessionKey,
      mode: "session",
    });

    // 2. Test Sending a message to the created subagent using its label
    hoisted.callGatewayMock.mockImplementation(async (opts: Record<string, unknown>) => {
      if (opts.method === "sessions.resolve") {
        // Mock finding the session by label!
        return { key: childSessionKey };
      }
      if (opts.method === "sessions.list") {
        return {
          path: "/tmp/sessions.json",
          sessions: [{ key: childSessionKey }],
        };
      }
      if (opts.method === "agent") {
        return { runId: "run-send" };
      }
      if (opts.method === "agent.wait") {
        return { status: "success" };
      }
      if (opts.method === "chat.history") {
        return {
          messages: [
            { role: "assistant", content: [{ type: "text", text: "Database query finished." }] },
          ],
        };
      }
      return {};
    });

    const sendTool = createSessionsSendTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    });

    const sendResult = await sendTool.execute("send-1", {
      label: "db-expert",
      message: "Please run query SELECT * FROM users;",
      timeoutSeconds: 5,
    });

    // Validations: Send tool should find it and dispatch
    expect(hoisted.callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "sessions.resolve",
        params: expect.objectContaining({ label: "db-expert" }),
      }),
    );
    expect(sendResult.details).toMatchObject({
      status: "ok",
      reply: "Database query finished.",
    });
  });
});
