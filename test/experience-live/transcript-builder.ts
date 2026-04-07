import fs from "node:fs/promises";

/** Write session header as first line of JSONL */
export async function createTranscript(sessionId: string, filePath: string): Promise<void> {
  const header = JSON.stringify({
    type: "session",
    version: 2,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  });
  await fs.writeFile(filePath, header + "\n", "utf-8");
}

/** Append a user message line to the transcript JSONL */
export async function appendUserMessage(filePath: string, text: string): Promise<void> {
  const line = JSON.stringify({
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  });
  await fs.appendFile(filePath, line + "\n", "utf-8");
}

/** Append an assistant message line to the transcript JSONL */
export async function appendAssistantMessage(filePath: string, text: string): Promise<void> {
  const line = JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage: { input: 0, output: 0 },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  });
  await fs.appendFile(filePath, line + "\n", "utf-8");
}
