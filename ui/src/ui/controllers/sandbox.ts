import type { GatewayBrowserClient } from "../gateway.ts";
import type { TaskPlanSnapshot } from "../views/sandbox.ts";

export type SandboxState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  sandboxTaskPlan: TaskPlanSnapshot | null;
  sandboxTaskPlanLoading: boolean;
  sandboxTaskPlanError: string | null;
  /** When true, suppress automatic task-plan re-fetches (set after /new reset). */
  sandboxTaskPlanSuppressed?: boolean;
};

type TaskPlanReadResponse = {
  ok: boolean;
  plan: TaskPlanSnapshot | null;
  error?: string;
};

/**
 * Loads the live task plan for the current main agent session from the gateway.
 * The gateway reads `.enclaws/planner/<sessionKey>.json` from disk.
 */
export async function loadSandboxTaskPlan(state: SandboxState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.sandboxTaskPlanLoading) {
    return;
  }
  // After /new reset, suppress automatic re-fetches until a fresh session produces new data
  if (state.sandboxTaskPlanSuppressed) {
    return;
  }
  state.sandboxTaskPlanLoading = true;
  state.sandboxTaskPlanError = null;
  try {
    const res = await state.client.request<TaskPlanReadResponse>("task_plan.read", {
      sessionKey: state.sessionKey,
    });
    if (res?.ok) {
      state.sandboxTaskPlan = res.plan ?? null;
    } else {
      state.sandboxTaskPlan = null;
    }
  } catch (err) {
    // Silently ignore permission errors (e.g. tenant users without operator.admin scope)
    // to avoid noisy logs and repeated retries.
    const errMsg = String(err);
    if (errMsg.includes("missing scope") || errMsg.includes("INVALID_REQUEST")) {
      state.sandboxTaskPlan = null;
      state.sandboxTaskPlanSuppressed = true;
      return;
    }
    state.sandboxTaskPlanError = errMsg;
    state.sandboxTaskPlan = null;
  } finally {
    state.sandboxTaskPlanLoading = false;
  }
}
