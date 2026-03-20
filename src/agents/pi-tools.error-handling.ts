import { logWarn } from "../logger.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { jsonResult } from "./tools/common.js";

/**
 * Wraps an agent tool to gracefully catch execution errors and return a
 * stringifiable error result. This gives the LLM the ability to read the error
 * and perform a Retry Loop without hard crashing the entire agent thread,
 * adhering to LangChain Deep Agents best practices.
 */
export function wrapToolWithErrorBoundary(tool: AnyAgentTool): AnyAgentTool {
  return {
    ...tool,
    execute: async (toolCallId, params) => {
      try {
        return await tool.execute(toolCallId, params);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logWarn(`[Tool Error Boundary] Caught exception in tool '${tool.name}': ${errorMessage}`);

        return jsonResult({
          status: "tool_error",
          error: `Execution failed: ${errorMessage}. Please analyze this error. You may need to retry with different parameters or use an alternative approach.`,
        });
      }
    },
  };
}
