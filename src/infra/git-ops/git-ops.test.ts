import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it, expect, beforeEach } from "vitest";
import { GitOps } from "./git-ops.js";

const execFileP = promisify(execFile);

async function makeBareRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "git-ops-bare-"));
  await execFileP("git", ["init", "--bare", dir]);
  // Set HEAD to main so clones know which branch to check out
  await execFileP("git", ["-C", dir, "symbolic-ref", "HEAD", "refs/heads/main"]);
  return dir;
}

async function makeAndPopulate(bare: string): Promise<string> {
  const clone = await mkdtemp(path.join(os.tmpdir(), "git-ops-seed-"));
  // mkdtemp created the dir; git clone needs it empty or non-existent
  await rm(clone, { recursive: true, force: true });
  await execFileP("git", ["clone", bare, clone]);
  await execFileP("git", ["-C", clone, "config", "user.email", "t@test.com"]);
  await execFileP("git", ["-C", clone, "config", "user.name", "t"]);
  // Ensure default branch is main (needed on Windows)
  await execFileP("git", ["-C", clone, "config", "init.defaultBranch", "main"]);
  await execFileP("git", ["-C", clone, "checkout", "-b", "main"]);
  await writeFile(path.join(clone, "README.md"), "# test\n");
  await execFileP("git", ["-C", clone, "add", "README.md"]);
  await execFileP("git", ["-C", clone, "commit", "-m", "initial"]);
  await execFileP("git", ["-C", clone, "push", "origin", "HEAD:main"]);
  return clone;
}

describe("GitOps", () => {
  let bareRepo: string;

  beforeEach(async () => {
    bareRepo = await makeBareRepo();
    await makeAndPopulate(bareRepo);
  });

  it("clones a repo to a target directory", async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "git-ops-target-"));
    await rm(target, { recursive: true, force: true });
    const git = new GitOps();
    await git.clone(bareRepo, target);
    const contents = await readdir(target);
    expect(contents).toContain("README.md");
  });

  it("pulls updates from remote", async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "git-ops-pull-"));
    await rm(target, { recursive: true, force: true });
    const git = new GitOps();
    await git.clone(bareRepo, target);
    // configure pull.rebase to avoid "divergent branches" warning on newer git
    await execFileP("git", ["-C", target, "config", "pull.rebase", "true"]);
    await expect(git.pull(target)).resolves.toBeUndefined();
  });

  it("commits and pushes a change", async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "git-ops-push-"));
    await rm(target, { recursive: true, force: true });
    const git = new GitOps();
    await git.clone(bareRepo, target);
    await execFileP("git", ["-C", target, "config", "user.email", "t@test.com"]);
    await execFileP("git", ["-C", target, "config", "user.name", "t"]);
    await writeFile(path.join(target, "NEW.md"), "new file\n");
    await git.commit(target, { message: "add NEW.md", paths: ["NEW.md"] });
    await git.push(target);
    // Verify by cloning again
    const verify = await mkdtemp(path.join(os.tmpdir(), "git-ops-verify-"));
    await rm(verify, { recursive: true, force: true });
    await git.clone(bareRepo, verify);
    const contents = await readdir(verify);
    expect(contents).toContain("NEW.md");
  });

  it("clones with depth 1 and reports headCommit", async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "git-ops-depth-"));
    await rm(target, { recursive: true, force: true });
    const git = new GitOps();
    await git.clone(bareRepo, target, { depth: 1 });
    const commit = await git.headCommit(target);
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
