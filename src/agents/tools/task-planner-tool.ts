import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { acquireSessionWriteLock } from "../session-write-lock.js";
import type { AnyAgentTool } from "./common.js";
import { ToolInputError, jsonResult, readStringParam } from "./common.js";

const TaskPlannerSchema = Type.Object({
  action: Type.Union([
    Type.Literal("create_plan"),
    Type.Literal("add_todo"),
    Type.Literal("update_todo"),
    Type.Literal("read_plan"),
    Type.Literal("complete_plan"),
    Type.Literal("set_phase"),
  ]),
  description: Type.Optional(
    Type.String({ description: "Overall plan description for create_plan" }),
  ),
  taskId: Type.Optional(Type.String({ description: "ID of the task to update" })),
  title: Type.Optional(Type.String({ description: "Task title for add_todo or update_todo" })),
  status: Type.Optional(
    Type.Union([Type.Literal("todo"), Type.Literal("in_progress"), Type.Literal("done")]),
  ),
  result: Type.Optional(
    Type.String({
      description:
        "Only used when status is 'done'. The result output from the subagent or execution step.",
    }),
  ),
  phase: Type.Optional(
    Type.Union(
      [
        Type.Literal("planning"),
        Type.Literal("execution"),
        Type.Literal("verification"),
        Type.Literal("complete"),
      ],
      {
        description:
          "Phase for set_phase action. Transitions: planning → execution → verification → complete",
      },
    ),
  ),
  parentSessionKey: Type.Optional(
    Type.String({
      description:
        "If you are a subagent updating a main agent's task plan, provide the main agent's session key here.",
    }),
  ),
  format: Type.Optional(
    Type.Union([Type.Literal("full"), Type.Literal("digest")], {
      description:
        "Output format for read_plan. 'full' returns all todos, 'digest' returns a compact status line.",
    }),
  ),
});

type TodoItem = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  result?: string;
};

type TaskPlan = {
  description: string;
  todos: TodoItem[];
  phase: "planning" | "execution" | "verification" | "complete";
};

export function createTaskPlannerTool(options?: {
  agentSessionKey?: string;
  workspaceDir?: string;
}): AnyAgentTool | null {
  if (!options?.workspaceDir) {
    return null;
  }
  const workspaceDir = options.workspaceDir;
  // Use a fallback key if session key is not provided. Sanitize to prevent path traversal.
  const sessionKey = options.agentSessionKey
    ? options.agentSessionKey.replace(/[^a-zA-Z0-9_-]/g, "_")
    : "default";

  return {
    label: "Task Planner",
    name: "write_todos",
    description:
      "Manage a task plan and todo list to coordinate complex multi-step work. Useful for breaking down long tasks, tracking progress, and communicating steps between sub-agents. Use 'create_plan' to initialize, 'add_todo' to add items, 'update_todo' to change status, and 'read_plan' to view current plan.",
    parameters: TaskPlannerSchema,
    execute: async (_toolCallId, params) => {
      const action = readStringParam(params, "action", { required: true });
      const parentSessionKeyRaw = readStringParam(params, "parentSessionKey");
      const targetSessionKey = parentSessionKeyRaw
        ? parentSessionKeyRaw.replace(/[^a-zA-Z0-9_-]/g, "_")
        : sessionKey;

      const plannerDir = path.join(workspaceDir, ".openclaw", "planner");
      const plannerFile = path.join(plannerDir, `${targetSessionKey}.json`);

      let lockRelease: (() => Promise<void>) | undefined;
      try {
        const lock = await acquireSessionWriteLock({ sessionFile: plannerFile, timeoutMs: 15000 });
        lockRelease = lock.release;

        const loadPlan = async (): Promise<TaskPlan> => {
          try {
            const content = await fs.readFile(plannerFile, "utf-8");
            const raw = JSON.parse(content) as TaskPlan;
            // Backcompat: old plans without phase default to "execution"
            if (!raw.phase) {
              raw.phase = "execution";
            }
            return raw;
          } catch {
            return { description: "", todos: [], phase: "planning" };
          }
        };

        const savePlan = async (plan: TaskPlan) => {
          await fs.mkdir(plannerDir, { recursive: true });
          await fs.writeFile(plannerFile, JSON.stringify(plan, null, 2), "utf-8");
        };

        if (action === "create_plan") {
          const description = readStringParam(params, "description", { required: true });
          const plan: TaskPlan = { description, todos: [], phase: "planning" };
          await savePlan(plan);
          return jsonResult({ status: "ok", plan });
        }

        if (action === "read_plan") {
          const plan = await loadPlan();
          const format = readStringParam(params, "format");
          if (format === "digest") {
            const statusIcons: Record<string, string> = {
              todo: "⏳",
              in_progress: "🔄",
              done: "✅",
            };
            const doneCount = plan.todos.filter((t) => t.status === "done").length;
            const total = plan.todos.length;
            const items = plan.todos
              .map((t, i) => {
                const icon = statusIcons[t.status] ?? "⏳";
                return `${i + 1}. ${t.title} ${icon}`;
              })
              .join(" | ");
            return jsonResult({
              status: "ok",
              digest: `TODO[${doneCount}/${total}]: ${items}`,
              plan,
            });
          }
          return jsonResult({ status: "ok", plan });
        }

        if (action === "complete_plan") {
          const plan = await loadPlan();
          plan.todos = plan.todos.map((t) => ({ ...t, status: "done" as const }));
          plan.phase = "complete";
          await savePlan(plan);
          return jsonResult({ status: "ok", message: "All tasks marked as done.", plan });
        }

        if (action === "set_phase") {
          const phaseStr = readStringParam(params, "phase", { required: true });
          const validPhases = ["planning", "execution", "verification", "complete"] as const;
          if (!validPhases.includes(phaseStr as (typeof validPhases)[number])) {
            throw new ToolInputError(
              `Invalid phase: ${phaseStr}. Must be one of: ${validPhases.join(", ")}`,
            );
          }
          const plan = await loadPlan();
          plan.phase = phaseStr as TaskPlan["phase"];
          await savePlan(plan);
          return jsonResult({ status: "ok", phase: plan.phase, plan });
        }

        const plan = await loadPlan();

        if (action === "add_todo") {
          const title = readStringParam(params, "title", { required: true });
          const id = crypto.randomUUID().substring(0, 8);
          const item: TodoItem = { id, title, status: "todo" };
          plan.todos.push(item);
          await savePlan(plan);
          return jsonResult({ status: "ok", added: item, plan });
        }

        if (action === "update_todo") {
          const taskId = readStringParam(params, "taskId", { required: true });
          const statusStr = readStringParam(params, "status");
          const titleStr = readStringParam(params, "title");
          const resultStr = readStringParam(params, "result");

          const item = plan.todos.find((t) => t.id === taskId);
          if (!item) {
            throw new ToolInputError(`Task ID ${taskId} not found.`);
          }
          if (statusStr) {
            item.status = statusStr as "todo" | "in_progress" | "done";
          }
          if (titleStr) {
            item.title = titleStr;
          }
          if (resultStr && item.status === "done") {
            item.result = resultStr;
          }
          await savePlan(plan);
          return jsonResult({ status: "ok", updated: item, plan });
        }

        throw new ToolInputError(`Unknown action: ${action}`);
      } finally {
        if (lockRelease) {
          await lockRelease();
        }
      }
    },
  };
}
