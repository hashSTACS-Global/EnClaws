import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTranscript, appendUserMessage, appendAssistantMessage } from "./transcript-builder.js";
import { readRecentTranscriptMessages } from "../../src/experience/capture.js";

describe("transcript-builder", () => {
  let tempDir: string;
  let transcriptPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "exp-transcript-test-"));
    transcriptPath = path.join(tempDir, "session.jsonl");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("produces JSONL that readRecentTranscriptMessages can parse", async () => {
    await createTranscript("test-session", transcriptPath);
    await appendUserMessage(transcriptPath, "你好");
    await appendAssistantMessage(transcriptPath, "你好！有什么可以帮助你的？");
    await appendUserMessage(transcriptPath, "我们用 PostgreSQL");
    await appendAssistantMessage(transcriptPath, "好的，了解了。");

    const result = await readRecentTranscriptMessages(transcriptPath, 10);
    expect(result).not.toBeNull();
    expect(result).toContain("user: 你好");
    expect(result).toContain("assistant: 你好！有什么可以帮助你的？");
    expect(result).toContain("user: 我们用 PostgreSQL");
    expect(result).toContain("assistant: 好的，了解了。");
  });

  it("respects messageCount limit", async () => {
    await createTranscript("test-session", transcriptPath);
    await appendUserMessage(transcriptPath, "第一条");
    await appendAssistantMessage(transcriptPath, "回复一");
    await appendUserMessage(transcriptPath, "第二条");
    await appendAssistantMessage(transcriptPath, "回复二");

    const result = await readRecentTranscriptMessages(transcriptPath, 2);
    expect(result).not.toBeNull();
    expect(result).toContain("user: 第二条");
    expect(result).toContain("assistant: 回复二");
    expect(result).not.toContain("第一条");
  });
});
