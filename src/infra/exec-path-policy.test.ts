import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStateDir } from "../config/paths.js";
import { checkExecPathsAgainstPolicy } from "./exec-path-policy.js";
import { PathPermissionPolicy, type PathOp } from "./path-permission-policy.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
const STATE = resolveStateDir();
const STATE_NAME = path.basename(STATE);

const TENANT = "MYT";
const OTHER_TENANT = "OTHER";
const USER = "MYU";

const TENANT_ROOT = path.join(STATE, "tenants", TENANT);
const USER_ROOT = path.join(TENANT_ROOT, "users", USER);
const WORKSPACE = path.join(USER_ROOT, "workspace");
const SESSIONS = path.join(USER_ROOT, "sessions");
const AGENTS_RO = path.join(TENANT_ROOT, "agents");

// Tilde-relative form of the state dir, used to verify `~` expansion.
// Only valid if STATE lives under HOME (true both in prod and in test-env.ts).
const STATE_TILDE = STATE.startsWith(HOME)
  ? "~" + STATE.slice(HOME.length).replace(/\\/g, "/")
  : null;

const ALL: ReadonlySet<PathOp> = new Set(["read", "write"]);
const RO: ReadonlySet<PathOp> = new Set(["read"]);

/** Convert a filesystem path to forward-slash form for use inside shell command strings.
 *  shell-quote treats `\` as an escape character on every platform, so command strings
 *  must use `/` separators even on Windows. path.resolve accepts either. */
function posixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function buildPolicy(): PathPermissionPolicy {
  // Note: we deliberately omit os.tmpdir() here — in the test env the tmpdir
  // prefix contains the test state dir, which would mask the default-deny
  // behaviour we want to assert.
  return new PathPermissionPolicy([
    { prefix: WORKSPACE, ops: ALL },
    { prefix: SESSIONS, ops: ALL },
    { prefix: AGENTS_RO, ops: RO },
  ]);
}

function strict(command: string, cwd = WORKSPACE): string | null {
  return checkExecPathsAgainstPolicy({
    command,
    cwd,
    policy: buildPolicy(),
    platform: "linux",
  });
}

function lenient(command: string, cwd = WORKSPACE): string | null {
  return checkExecPathsAgainstPolicy({
    command,
    cwd,
    policy: buildPolicy(),
    platform: "win32",
  });
}

// ── short-circuit ────────────────────────────────────────────────────────────

describe("checkExecPathsAgainstPolicy — short-circuit", () => {
  it("passes commands with no state-dir reference (linux)", () => {
    expect(strict("git status")).toBeNull();
    expect(strict("pnpm test")).toBeNull();
    expect(strict("rg foo src/")).toBeNull();
    expect(strict("curl https://example.com")).toBeNull();
  });

  it("passes commands with no state-dir reference (win32)", () => {
    expect(lenient("git status")).toBeNull();
    expect(lenient("Get-ChildItem C:\\Users")).toBeNull();
  });

  it("passes empty command/cwd", () => {
    const policy = buildPolicy();
    expect(
      checkExecPathsAgainstPolicy({
        command: "",
        cwd: WORKSPACE,
        policy,
        platform: "linux",
      }),
    ).toBeNull();
    expect(
      checkExecPathsAgainstPolicy({
        command: `cat ${path.join(STATE, "config.json")}`,
        cwd: "",
        policy,
        platform: "linux",
      }),
    ).toBeNull();
  });
});

// ── strict (Linux) ───────────────────────────────────────────────────────────

describe("checkExecPathsAgainstPolicy — strict (linux)", () => {
  describe("blocks platform-config reads", () => {
    it("blocks cat on top-level config via absolute path", () => {
      const abs = posixPath(path.join(STATE, "enclaws.json"));
      expect(strict(`cat ${abs}`)).not.toBeNull();
    });

    it("blocks cat on update-settings via absolute path", () => {
      const abs = posixPath(path.join(STATE, "update-settings.json"));
      expect(strict(`cat ${abs}`)).not.toBeNull();
    });

    it("blocks ls on state-root agents dir", () => {
      const abs = posixPath(path.join(STATE, "agents"));
      expect(strict(`ls ${abs}`)).not.toBeNull();
    });

    it("blocks find on the state root via tilde path", () => {
      if (!STATE_TILDE) {
        return;
      }
      expect(strict(`find ${STATE_TILDE}`)).not.toBeNull();
    });
  });

  describe("blocks cross-tenant reads", () => {
    it("blocks reading another tenant's sessions", () => {
      const other = posixPath(
        path.join(STATE, "tenants", OTHER_TENANT, "users", "X", "sessions", "s.json"),
      );
      expect(strict(`cat ${other}`)).not.toBeNull();
    });
  });

  describe("allows in-scope paths", () => {
    it("allows reading a file in own workspace", () => {
      expect(strict(`cat ${posixPath(path.join(WORKSPACE, "notes.md"))}`)).toBeNull();
    });

    it("allows cwd-relative reads in workspace", () => {
      expect(strict("cat ./notes.md")).toBeNull();
      expect(strict("ls .")).toBeNull();
    });

    it("allows reading sessions", () => {
      expect(strict(`cat ${posixPath(path.join(SESSIONS, "s.json"))}`)).toBeNull();
    });

    it("allows reading the tenant agents (read-only)", () => {
      expect(strict(`ls ${posixPath(AGENTS_RO)}`)).toBeNull();
    });
  });

  describe("pipelines and operator chains", () => {
    it("blocks path inside pipe segment", () => {
      const abs = posixPath(path.join(STATE, "enclaws.json"));
      expect(strict(`cat ${abs} | grep agent`)).not.toBeNull();
    });

    it("blocks path inside && chain", () => {
      const abs = posixPath(path.join(STATE, "enclaws.json"));
      expect(strict(`true && cat ${abs}`)).not.toBeNull();
    });

    it("blocks redirection target", () => {
      const abs = posixPath(path.join(STATE, "enclaws.json"));
      expect(strict(`echo data > ${abs}`)).not.toBeNull();
    });
  });

  describe("assignments", () => {
    it("blocks VAR=<literal path> even if the read does not happen in-command", () => {
      const abs = posixPath(path.join(STATE, "enclaws.json"));
      expect(strict(`CFG=${abs}; echo done`)).not.toBeNull();
    });

    it("passes VAR=<non-literal> rhs", () => {
      expect(strict('CFG="$HOME/x"; echo done')).toBeNull();
    });
  });

  describe("ambiguity → pass (accepted false-negative)", () => {
    it("passes tokens inside quoted string with spaces (echo case)", () => {
      const abs = posixPath(path.join(STATE, "enclaws.json"));
      expect(strict(`echo "path is ${abs} here"`)).toBeNull();
    });

    it("passes when token contains $VAR expansion", () => {
      expect(strict(`cat $PREFIX/${STATE_NAME}/enclaws.json`)).toBeNull();
    });

    it("passes when command uses $(...) subshell", () => {
      const abs = posixPath(path.join(STATE, "enclaws.json"));
      expect(strict(`echo $(cat ${abs})`)).toBeNull();
    });

    it("passes awk pattern containing state-dir literal in single quotes", () => {
      expect(strict(`awk '/\\.${STATE_NAME.slice(1)}/ { print }' file.log`)).toBeNull();
    });
  });
});

// ── lenient (win32 / darwin) ─────────────────────────────────────────────────

describe("checkExecPathsAgainstPolicy — lenient (non-linux)", () => {
  describe("blocks platform-config reads via regex", () => {
    it("blocks type on top-level config via tilde path", () => {
      if (!STATE_TILDE) {
        return;
      }
      expect(lenient(`type ${STATE_TILDE}/enclaws.json`)).not.toBeNull();
    });

    it("blocks Get-Content with $HOME expansion", () => {
      const suffix = STATE.slice(HOME.length).replace(/\\/g, "/");
      expect(lenient(`Get-Content $HOME${suffix}/enclaws.json`)).not.toBeNull();
    });

    it("blocks absolute path to state-root config", () => {
      const abs = posixPath(path.join(STATE, "enclaws.json"));
      expect(lenient(`type ${abs}`)).not.toBeNull();
    });
  });

  describe("allows in-scope paths", () => {
    it("allows reading a file in own workspace (absolute)", () => {
      const abs = path.join(WORKSPACE, "notes.md");
      expect(lenient(`type ${abs}`)).toBeNull();
    });

    it("allows cwd-relative reads", () => {
      expect(lenient("type notes.md")).toBeNull();
    });
  });

  describe("ambiguity → pass", () => {
    it("passes when command contains $env:", () => {
      expect(lenient(`Get-Content $env:USERPROFILE\\${STATE_NAME}\\enclaws.json`)).toBeNull();
    });

    it("passes when command uses %VAR%", () => {
      expect(lenient(`type %USERPROFILE%\\${STATE_NAME}\\enclaws.json`)).toBeNull();
    });

    it("passes when command has backtick", () => {
      if (!STATE_TILDE) {
        return;
      }
      expect(lenient(`type \`${STATE_TILDE}/enclaws.json\``)).toBeNull();
    });

    it("passes $(...) subshell", () => {
      const abs = posixPath(path.join(STATE, "enclaws.json"));
      expect(lenient(`Write-Output $(type ${abs})`)).toBeNull();
    });
  });

  describe("darwin also routes to lenient", () => {
    it("uses lenient rules on darwin", () => {
      const abs = posixPath(path.join(STATE, "enclaws.json"));
      const policy = buildPolicy();
      const result = checkExecPathsAgainstPolicy({
        command: `cat ${abs}`,
        cwd: WORKSPACE,
        policy,
        platform: "darwin",
      });
      expect(result).not.toBeNull();
    });
  });
});
