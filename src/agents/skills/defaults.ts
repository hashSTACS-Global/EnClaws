/**
 * Bundled skills disabled by default for enterprise deployments.
 *
 * These skills target personal/consumer scenarios (smart home, Apple ecosystem,
 * social media, entertainment) and add noise to enterprise agent prompts.
 *
 * Stored in `tenant_agents.skills` (denylist) when creating new agents.
 * Admins can re-enable individual skills per agent via the UI.
 */
export const DEFAULT_DISABLED_BUNDLED_SKILLS: readonly string[] = Object.freeze([
  // Apple ecosystem (macOS-only)
  "apple-notes",
  "apple-reminders",
  "bear-notes",
  "bluebubbles",
  "imsg",
  "peekaboo",
  "things-mac",
  // Smart home / consumer hardware
  "blucli",
  "camsnap",
  "eightctl",
  "openhue",
  "sonoscli",
  // Music / entertainment / personal services
  "gifgrep",
  "ordercli",
  "songsee",
  "spotify-player",
  // Social media / consumer publishing
  "blogwatcher",
  "wacli",
  "xiaohongshu-publisher",
  "xurl",
  // Personal tools
  "1password",
  "goplaces",
  // Node screen casting
  "canvas",
  // Functional overlap
  "gemini",
  "obsidian",
  "openai-whisper",
]);
