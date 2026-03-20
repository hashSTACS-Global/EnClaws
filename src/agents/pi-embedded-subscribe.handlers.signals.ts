import type { AgentCognitiveSignalInternalEvent } from "./internal-events.js";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";

/**
 * Handle cognitive signals (Convergence/Divergence) received from sub-agents.
 */
export function handleCognitiveSignal(
  ctx: EmbeddedPiSubscribeContext,
  event: AgentCognitiveSignalInternalEvent,
) {
  const { signal, reason, depth } = event;
  const { state, log } = ctx;

  if (signal === "divergence") {
    // Divergence reported by a sub-agent increments the chaos score.
    // The impact is weighted by the depth (deeper divergence is more chaotic).
    const increment = 1 + Math.max(0, depth - 1);
    state.chaosScore += increment;

    log.debug(
      `[Cognitive Fusion] Divergence reported by sub-agent (depth ${depth}). Chaos score: ${state.chaosScore - increment} -> ${state.chaosScore}. Reason: ${reason ?? "unknown"}`,
    );
  } else if (signal === "convergence") {
    // Convergence reported by a sub-agent slowly cools down the chaos score.
    if (state.chaosScore > 0) {
      state.chaosScore = Math.max(0, state.chaosScore - 1);
      log.debug(
        `[Cognitive Fusion] Convergence reported by sub-agent. Chaos score: ${state.chaosScore + 1} -> ${state.chaosScore}.`,
      );
    }
  }
}
