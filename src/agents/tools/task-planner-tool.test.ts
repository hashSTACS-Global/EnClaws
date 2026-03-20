import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createTaskPlannerTool } from "./task-planner-tool.js";

test("task planner tool manages plan and todos", async () => {
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-test-planner-"));
  const tool = createTaskPlannerTool({ workspaceDir: tmpdir, agentSessionKey: "test:session" });

  expect(tool).toBeDefined();

  // Create plan
  const createRes = await tool!.execute("call1", { action: "create_plan", description: "My plan" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((createRes.details as any).plan.description).toBe("My plan");

  // Add todo
  const addRes = await tool!.execute("call2", { action: "add_todo", title: "Build feature X" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const added = (addRes.details as any).added;
  expect(added.title).toBe("Build feature X");
  expect(added.status).toBe("todo");

  // Update todo
  const updateRes = await tool!.execute("call3", {
    action: "update_todo",
    taskId: added.id,
    status: "in_progress",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((updateRes.details as any).updated.status).toBe("in_progress");

  // Read plan
  const readRes = await tool!.execute("call4", { action: "read_plan" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((readRes.details as any).plan.todos).toHaveLength(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((readRes.details as any).plan.todos[0].status).toBe("in_progress");
});
