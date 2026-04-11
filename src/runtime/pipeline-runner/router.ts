import type { RegisteredPipeline } from "./registry.js";

export class IntentRouter {
  constructor(private readonly pipelines: RegisteredPipeline[]) {}

  /**
   * Match a pipeline by trigger keyword. Strategy:
   * 1. For each pipeline, try each of its triggers.
   * 2. If the user text contains the trigger (case-insensitive), it's a match.
   * 3. Among all matches, prefer the longest trigger (most specific).
   */
  match(userText: string): RegisteredPipeline | undefined {
    const lower = userText.toLowerCase();
    let best: { pipeline: RegisteredPipeline; len: number } | undefined;
    for (const p of this.pipelines) {
      for (const trigger of p.definition.triggers) {
        if (lower.includes(trigger.toLowerCase())) {
          if (!best || trigger.length > best.len) {
            best = { pipeline: p, len: trigger.length };
          }
        }
      }
    }
    return best?.pipeline;
  }
}
