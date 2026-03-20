import fs from "node:fs/promises";
import path from "node:path";

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

const STATUS_ICON: Record<TodoStatus, string> = {
  todo: "⏳",
  in_progress: "🔄",
  done: "✅",
};

/**
 * Load the task plan for a given session key from disk.
 * Returns null if no plan exists yet.
 */
export async function loadTaskPlan(
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

/**
 * Returns a compact, single-line digest of the current task plan.
 * Useful for injecting into system prompts without bloating the context.
 *
 * Example: "TODO[2/4]: ① Research ✅ ② Write code 🔄 ③ Review ⏳ ④ Deploy ⏳"
 */
export async function loadPlanDigest(
  workspaceDir: string,
  sessionKey: string,
): Promise<string | undefined> {
  const plan = await loadTaskPlan(workspaceDir, sessionKey);
  if (!plan || plan.todos.length === 0) {
    return undefined;
  }
  const doneCount = plan.todos.filter((t) => t.status === "done").length;
  const total = plan.todos.length;
  const items = plan.todos
    .map((t, i) => {
      const icon = STATUS_ICON[t.status] ?? "⏳";
      const num = numberToCircled(i + 1);
      const title = t.title.length > 40 ? `${t.title.slice(0, 38)}…` : t.title;
      return `${num} ${title} ${icon}`;
    })
    .join(" ");
  return `TODO[${doneCount}/${total}]: ${items}`;
}

/**
 * Returns a multi-line markdown block of the current task plan.
 * Suitable for the "## Current Task Plan" section in a system prompt.
 */
export async function buildTaskPlanSection(
  workspaceDir: string,
  sessionKey: string,
): Promise<string[]> {
  const plan = await loadTaskPlan(workspaceDir, sessionKey);
  if (!plan || plan.todos.length === 0) {
    return [];
  }
  const doneCount = plan.todos.filter((t) => t.status === "done").length;
  const total = plan.todos.length;
  const lines = [
    "## Current Task Plan",
    plan.description ? `Goal: ${plan.description}` : "",
    `Progress: ${doneCount}/${total} completed`,
    "",
    ...plan.todos.map((t, i) => {
      const icon = STATUS_ICON[t.status] ?? "⏳";
      return `${i + 1}. [${t.status}] ${t.title} ${icon}`;
    }),
    "",
    doneCount === total
      ? "✅ All tasks complete. Summarize and report to user."
      : `Next: focus on the first non-done task above.`,
    "",
  ].filter((l): l is string => l !== undefined);
  return lines;
}

function numberToCircled(n: number): string {
  const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  return circled[n - 1] ?? `(${n})`;
}
