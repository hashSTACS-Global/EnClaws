import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { ToolCard } from "../../types/chat-types.js";
import { renderTodosCard } from "./tool-cards.js";

describe("tool-cards rendering logic", () => {
  it("safely renders task planner cards even when taskId is null or missing", () => {
    // Simulate a malformed or early-stage tool call from the agent
    const mockCard: ToolCard = {
      kind: "call",
      name: "task_planner",
      args: {
        action: "update_todo",
        status: "in_progress",
        taskId: { malformed: "object" }, // Truthy object to enter block but fallback to unknown
      },
    };

    const container = document.createElement("div");

    // Attempt rendering. Prior to the strict null check fix, this would throw or insert [object Object]
    expect(() => {
      render(renderTodosCard(mockCard), container);
    }).not.toThrow();

    // Verify fallback has safely kicked in
    expect(container.innerHTML).toContain("Task #unknown");
  });
});
