import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/config.js";
import type { GatewayRequestHandlers } from "./types.js";

type TodoStatus = "todo" | "in_progress" | "done";

type TodoItem = {
  id: string;
  title: string;
  status: TodoStatus;
};

type TaskPlan = {
  description: string;
  todos: TodoItem[];
};

async function loadTaskPlanFromDisk(
  workspaceDir: string,
  sessionKey: string,
): Promise<TaskPlan | null> {
  const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  const plannerFile = path.join(workspaceDir, ".openclaw", "planner", `${safeKey}.json`);
  try {
    const content = await fs.readFile(plannerFile, "utf-8");
    return JSON.parse(content) as TaskPlan;
  } catch {
    return null;
  }
}

function resolveWorkspaceDir(): string {
  const cfg = loadConfig();
  const stateDir = resolveStateDir(process.env);
  // Prefer explicit workspace from config, fallback to state dir parent (usually home dir)
  const explicit =
    (cfg.agents as Record<string, unknown> | undefined)?.defaults &&
    typeof ((cfg.agents as Record<string, unknown>)?.defaults as Record<string, unknown>)
      ?.workspace === "string"
      ? (((cfg.agents as Record<string, unknown>)?.defaults as Record<string, unknown>)
          ?.workspace as string)
      : undefined;
  return explicit ?? path.dirname(stateDir);
}

export const taskPlanHandlers: GatewayRequestHandlers = {
  "task_plan.read": async ({ params, respond }) => {
    const rawKey = params && typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";

    if (!rawKey) {
      respond(true, { ok: true, plan: null }, undefined);
      return;
    }

    try {
      const workspaceDir = resolveWorkspaceDir();
      const plan = await loadTaskPlanFromDisk(workspaceDir, rawKey);
      respond(true, { ok: true, plan }, undefined);
    } catch (err) {
      respond(true, { ok: true, plan: null, error: String(err) }, undefined);
    }
  },
};
