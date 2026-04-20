/**
 * Bundled skills disabled by default for enterprise deployments.
 *
 * Stored in `tenant_agents.skills` (denylist) when creating new agents.
 * Admins can re-enable individual skills per agent via the UI.
 *
 * Currently empty: the enterprise bundle already ships only the 8 core skills
 * (`coding-agent`, `healthcheck`, `mcporter`, `memory-manager`, `pingtest`,
 * `session-logs`, `skill-creator`, `weather`). Consumer / personal / macOS-only
 * skills have been physically removed from `skills/`, so no per-agent denylist
 * is required. This hook point stays to support future additions.
 */
export const DEFAULT_DISABLED_BUNDLED_SKILLS: readonly string[] = Object.freeze([]);
