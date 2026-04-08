import { describe, it, expect, vi } from "vitest";
import { reconcileExperienceDistillCronJob, DISTILL_CRON_EVENT_TEXT } from "./distill-cron.js";

function createMockCronService() {
  return {
    list: vi.fn<(opts?: { includeDisabled?: boolean }) => Promise<any[]>>().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue({ removed: true }),
  };
}

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("reconcileExperienceDistillCronJob", () => {
  it("creates job when none exists and distill enabled", async () => {
    const cron = createMockCronService();
    await reconcileExperienceDistillCronJob({
      cronService: cron,
      settings: { enabled: true, model: null, maxCandidatesPerBatch: 50, cron: "0 3 * * *" },
      logger: mockLogger,
    });

    expect(cron.add).toHaveBeenCalledOnce();
    const addCall = cron.add.mock.calls[0][0];
    expect(addCall.name).toBe("Experience Auto Distill");
    expect(addCall.schedule.expr).toBe("0 3 * * *");
    expect(addCall.payload.text).toBe(DISTILL_CRON_EVENT_TEXT);
  });

  it("removes job when distill disabled", async () => {
    const existingJob = {
      id: "job-1",
      name: "Experience Auto Distill",
      description: "[managed-by=experience.auto-distill]",
      enabled: true,
    };
    const cron = createMockCronService();
    cron.list.mockResolvedValue([existingJob]);

    await reconcileExperienceDistillCronJob({
      cronService: cron,
      settings: { enabled: false, model: null, maxCandidatesPerBatch: 50, cron: "0 3 * * *" },
      logger: mockLogger,
    });

    expect(cron.remove).toHaveBeenCalledWith("job-1");
  });

  it("updates job when cron expression changes", async () => {
    const existingJob = {
      id: "job-1",
      name: "Experience Auto Distill",
      description: "[managed-by=experience.auto-distill] old",
      enabled: true,
      schedule: { kind: "cron", expr: "0 3 * * *" },
      payload: { kind: "systemEvent", text: DISTILL_CRON_EVENT_TEXT },
    };
    const cron = createMockCronService();
    cron.list.mockResolvedValue([existingJob]);

    await reconcileExperienceDistillCronJob({
      cronService: cron,
      settings: { enabled: true, model: null, maxCandidatesPerBatch: 50, cron: "0 5 * * 0" },
      logger: mockLogger,
    });

    expect(cron.update).toHaveBeenCalledOnce();
  });
});
