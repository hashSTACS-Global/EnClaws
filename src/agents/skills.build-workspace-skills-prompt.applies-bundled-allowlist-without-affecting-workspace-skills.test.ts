import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeSkill } from "./skills.e2e-test-helpers.js";
import { buildWorkspaceSkillsPrompt } from "./skills.js";

describe("buildWorkspaceSkillsPrompt", () => {
  it("applies bundled allowlist without affecting workspace skills", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "enclaws-"));
    const bundledDir = path.join(workspaceDir, ".bundled");
    const bundledSkillDir = path.join(bundledDir, "peekaboo");
    const workspaceSkillDir = path.join(workspaceDir, "skills", "demo-skill");

    await writeSkill({
      dir: bundledSkillDir,
      name: "peekaboo",
      description: "Capture UI",
      body: "# Peekaboo\n",
    });
    await writeSkill({
      dir: workspaceSkillDir,
      name: "demo-skill",
      description: "Workspace version",
      body: "# Workspace\n",
    });

    const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
      bundledSkillsDir: bundledDir,
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      config: { skills: { allowBundled: ["missing-skill"] } },
    });

    expect(prompt).toContain("Workspace version");
    expect(prompt).not.toContain("peekaboo");
  });

  it("excludes bundled skills in disabledBundledSkills without affecting workspace skills", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "enclaws-"));
    const bundledDir = path.join(workspaceDir, ".bundled");

    await writeSkill({
      dir: path.join(bundledDir, "spotify-player"),
      name: "spotify-player",
      description: "Spotify terminal player",
      body: "# Spotify\n",
    });
    await writeSkill({
      dir: path.join(bundledDir, "github"),
      name: "github",
      description: "GitHub CLI",
      body: "# GitHub\n",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "crm"),
      name: "crm",
      description: "Enterprise CRM",
      body: "# CRM\n",
    });

    const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
      bundledSkillsDir: bundledDir,
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      disabledBundledSkills: ["spotify-player"],
    });

    expect(prompt).not.toContain("spotify-player");
    expect(prompt).toContain("github");
    expect(prompt).toContain("Enterprise CRM");
  });

  it("does not affect workspace skills even if name matches disabledBundledSkills", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "enclaws-"));
    const bundledDir = path.join(workspaceDir, ".bundled");

    await writeSkill({
      dir: path.join(workspaceDir, "skills", "canvas"),
      name: "canvas",
      description: "Custom canvas tool",
      body: "# Custom Canvas\n",
    });

    const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
      bundledSkillsDir: bundledDir,
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      disabledBundledSkills: ["canvas"],
    });

    expect(prompt).toContain("Custom canvas tool");
  });
});
