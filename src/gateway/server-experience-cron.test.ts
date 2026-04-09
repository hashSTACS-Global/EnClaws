import { describe, expect, test, vi } from "vitest";
import {
  reconcileExperienceDistillCronJob,
  DISTILL_CRON_EVENT_TEXT,
} from "../experience/distill-cron.js";
import type { DistillSettings } from "../experience/distill-config.js";
import {
  setupCronServiceSuite,
  withCronServiceForTest,
} from "../cron/service.test-harness.js";

const { logger, makeStorePath } = setupCronServiceSuite({
  prefix: "enclaws-exp-cron-gateway-",
});

const enabledSettings: DistillSettings = {
  enabled: true,
  model: null,
  maxCandidatesPerBatch: 50,
  cron: "0 3 * * *",
};

describe("experience distill cron reconciliation (gateway integration)", () => {
  test("creates managed cron job when distill is enabled", async () => {
    await withCronServiceForTest(
      { makeStorePath, logger, cronEnabled: true },
      async ({ cron }) => {
        await reconcileExperienceDistillCronJob({
          cronService: cron,
          settings: enabledSettings,
          logger,
        });

        const jobs = await cron.list({ includeDisabled: true });
        expect(jobs.length).toBe(1);
        expect(jobs[0].name).toBe("Experience Auto Distill");
        expect(jobs[0].schedule?.expr).toBe("0 3 * * *");
        expect(jobs[0].payload?.text).toBe(DISTILL_CRON_EVENT_TEXT);
        expect(jobs[0].enabled).toBe(true);
      },
    );
  });

  test("updates managed cron job when schedule changes", async () => {
    await withCronServiceForTest(
      { makeStorePath, logger, cronEnabled: true },
      async ({ cron }) => {
        await reconcileExperienceDistillCronJob({
          cronService: cron,
          settings: enabledSettings,
          logger,
        });

        await reconcileExperienceDistillCronJob({
          cronService: cron,
          settings: { ...enabledSettings, cron: "0 6 * * *" },
          logger,
        });

        const jobs = await cron.list({ includeDisabled: true });
        expect(jobs.length).toBe(1);
        expect(jobs[0].schedule?.expr).toBe("0 6 * * *");
      },
    );
  });

  test("removes managed cron job when distill is disabled", async () => {
    await withCronServiceForTest(
      { makeStorePath, logger, cronEnabled: true },
      async ({ cron }) => {
        await reconcileExperienceDistillCronJob({
          cronService: cron,
          settings: enabledSettings,
          logger,
        });
        expect((await cron.list({ includeDisabled: true })).length).toBe(1);

        await reconcileExperienceDistillCronJob({
          cronService: cron,
          settings: { ...enabledSettings, enabled: false },
          logger,
        });

        const jobs = await cron.list({ includeDisabled: true });
        expect(jobs.length).toBe(0);
      },
    );
  });

  test("idempotent — repeated call with same settings keeps one job", async () => {
    await withCronServiceForTest(
      { makeStorePath, logger, cronEnabled: true },
      async ({ cron }) => {
        await reconcileExperienceDistillCronJob({
          cronService: cron,
          settings: enabledSettings,
          logger,
        });
        const before = await cron.list({ includeDisabled: true });

        await reconcileExperienceDistillCronJob({
          cronService: cron,
          settings: enabledSettings,
          logger,
        });
        const after = await cron.list({ includeDisabled: true });

        expect(after.length).toBe(1);
        expect(after[0].id).toBe(before[0].id);
      },
    );
  });

  test("deduplicates if multiple managed jobs exist", async () => {
    await withCronServiceForTest(
      { makeStorePath, logger, cronEnabled: true },
      async ({ cron }) => {
        // Manually create two managed jobs to simulate a corruption scenario
        await cron.add({
          name: "Experience Auto Distill",
          description: "[managed-by=experience.auto-distill] duplicate 1",
          enabled: true,
          schedule: { kind: "cron", expr: "0 3 * * *" },
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          payload: { kind: "systemEvent", text: DISTILL_CRON_EVENT_TEXT },
        });
        await cron.add({
          name: "Experience Auto Distill",
          description: "[managed-by=experience.auto-distill] duplicate 2",
          enabled: true,
          schedule: { kind: "cron", expr: "0 3 * * *" },
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          payload: { kind: "systemEvent", text: DISTILL_CRON_EVENT_TEXT },
        });
        expect((await cron.list({ includeDisabled: true })).length).toBe(2);

        await reconcileExperienceDistillCronJob({
          cronService: cron,
          settings: enabledSettings,
          logger,
        });

        const jobs = await cron.list({ includeDisabled: true });
        expect(jobs.length).toBe(1);
        expect(jobs[0].payload?.text).toBe(DISTILL_CRON_EVENT_TEXT);
      },
    );
  });
});
