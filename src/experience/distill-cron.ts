import { createSubsystemLogger } from "../logging/subsystem.js";
import type { DistillSettings } from "./distill-config.js";

const log = createSubsystemLogger("experience/distill-cron");

const MANAGED_CRON_NAME = "Experience Auto Distill";
const MANAGED_CRON_TAG = "[managed-by=experience.auto-distill]";
export const DISTILL_CRON_EVENT_TEXT = "__enclaws_experience_auto_distill__";

type Logger = { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };

type CronJobLike = {
  id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  schedule?: { kind?: string; expr?: string };
  payload?: { kind?: string; text?: string };
};

type CronServiceLike = {
  list: (opts?: { includeDisabled?: boolean }) => Promise<CronJobLike[]>;
  add: (input: Record<string, unknown>) => Promise<unknown>;
  update: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  remove: (id: string) => Promise<{ removed?: boolean }>;
};

function isManagedJob(job: CronJobLike): boolean {
  return (job.description ?? "").includes(MANAGED_CRON_TAG) ||
    (job.name === MANAGED_CRON_NAME && job.payload?.text === DISTILL_CRON_EVENT_TEXT);
}

export async function reconcileExperienceDistillCronJob(params: {
  cronService: CronServiceLike;
  settings: DistillSettings;
  logger: Logger;
}): Promise<void> {
  const allJobs = await params.cronService.list({ includeDisabled: true });
  const managed = allJobs.filter(isManagedJob);

  if (!params.settings.enabled) {
    for (const job of managed) {
      await params.cronService.remove(job.id);
    }
    if (managed.length > 0) {
      params.logger.info(`experience: removed ${managed.length} managed distill cron job(s).`);
    }
    return;
  }

  const desired = {
    name: MANAGED_CRON_NAME,
    description: `${MANAGED_CRON_TAG} Auto-distill pending experience candidates (cron=${params.settings.cron}).`,
    enabled: true,
    schedule: { kind: "cron" as const, expr: params.settings.cron },
    sessionTarget: "main" as const,
    wakeMode: "next-heartbeat" as const,
    payload: { kind: "systemEvent" as const, text: DISTILL_CRON_EVENT_TEXT },
  };

  if (managed.length === 0) {
    await params.cronService.add(desired);
    params.logger.info("experience: created managed distill cron job.");
    return;
  }

  // Keep first, remove duplicates
  const [primary, ...duplicates] = managed;
  for (const dup of duplicates) {
    await params.cronService.remove(dup.id);
  }

  // Update if config changed
  const needsUpdate =
    primary.schedule?.expr !== params.settings.cron ||
    !(primary.description ?? "").includes(MANAGED_CRON_TAG) ||
    primary.payload?.text !== DISTILL_CRON_EVENT_TEXT;

  if (needsUpdate) {
    await params.cronService.update(primary.id, desired);
    params.logger.info("experience: updated managed distill cron job.");
  }
}

/**
 * Check if an incoming message is the auto-distill cron event.
 */
export function isAutoDistillEvent(cleanedBody: string, trigger?: string): boolean {
  return trigger === "heartbeat" && cleanedBody.trim() === DISTILL_CRON_EVENT_TEXT;
}
