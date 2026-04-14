import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface CommitOptions {
  message: string;
  paths?: string[];
}

export interface CloneOptions {
  depth?: number;
  branch?: string;
  /** Custom env vars merged with process.env for this git command (e.g. auth headers). */
  gitEnv?: Record<string, string>;
}

export interface PushOptions {
  remote?: string;
  branch?: string;
  maxRetries?: number;
  /** Custom env vars merged with process.env for this git command (e.g. auth headers). */
  gitEnv?: Record<string, string>;
}

export class GitError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export class GitOps {
  async clone(url: string, targetDir: string, opts: CloneOptions = {}): Promise<void> {
    const args = ["clone"];
    if (opts.depth) {
      args.push("--depth", String(opts.depth));
    }
    if (opts.branch) {
      args.push("--branch", opts.branch);
    }
    args.push(url, targetDir);
    await this.run("git", args, undefined, opts.gitEnv);
  }

  async pull(repoDir: string, gitEnv?: Record<string, string>): Promise<void> {
    try {
      await this.run("git", ["pull", "--rebase", "origin"], repoDir, gitEnv);
    } catch (e) {
      if (e instanceof GitError && /network|fetch/i.test(e.stderr)) {
        // transient network failure → warn but don't interrupt caller
        return;
      }
      throw e;
    }
  }

  async commit(repoDir: string, opts: CommitOptions): Promise<boolean> {
    if (opts.paths && opts.paths.length > 0) {
      await this.run("git", ["add", ...opts.paths], repoDir);
    } else {
      await this.run("git", ["add", "-A"], repoDir);
    }
    // Check for staged changes
    try {
      await this.run("git", ["diff", "--cached", "--quiet"], repoDir);
      // No changes
      return false;
    } catch {
      // Has changes, proceed
    }
    await this.run("git", ["commit", "-m", opts.message], repoDir);
    return true;
  }

  async push(repoDir: string, opts: PushOptions = {}): Promise<void> {
    const remote = opts.remote ?? "origin";
    const branch = opts.branch ?? "HEAD";
    const maxRetries = opts.maxRetries ?? 3;
    let lastError: Error | undefined;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.run("git", ["push", remote, branch], repoDir, opts.gitEnv);
        return;
      } catch (e) {
        lastError = e as Error;
        if (e instanceof GitError && /conflict|rejected|non-fast-forward/i.test(e.stderr)) {
          // Try pull-rebase then push
          try {
            await this.pull(repoDir, opts.gitEnv);
          } catch {
            // ignore
          }
          continue;
        }
        // Other errors: delay then retry
        await new Promise((r) => {
          setTimeout(r, 1000 * (i + 1));
        });
      }
    }
    throw lastError ?? new Error("push failed");
  }

  async status(repoDir: string): Promise<string> {
    const { stdout } = await this.run("git", ["status", "--porcelain"], repoDir);
    return stdout;
  }

  async getRemoteUrl(repoDir: string, remote = "origin"): Promise<string> {
    const { stdout } = await this.run("git", ["remote", "get-url", remote], repoDir);
    return stdout.trim();
  }

  async headCommit(repoDir: string): Promise<string> {
    const { stdout } = await this.run("git", ["rev-parse", "HEAD"], repoDir);
    return stdout.trim();
  }

  private async run(
    cmd: string,
    args: string[],
    cwd?: string,
    gitEnv?: Record<string, string>,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const env = gitEnv ? { ...process.env, ...gitEnv } : undefined;
      const { stdout, stderr } = await execFileP(cmd, args, { cwd, env });
      return { stdout, stderr };
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { stderr?: string };
      throw new GitError(
        `git command failed: ${cmd} ${args.join(" ")}`,
        `${cmd} ${args.join(" ")}`,
        err.stderr ?? String(err),
      );
    }
  }
}
