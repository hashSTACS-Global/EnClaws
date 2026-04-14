# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is EnClaws

EnClaws is an **enterprise containerized platform for digital AI Employees**, extending OpenClaw (a personal AI assistant) into a multi-tenant system with concurrent task execution, user isolation, hierarchical memory, skill sharing, and audit capabilities. Built on TypeScript/Node.js with a gateway server architecture.

## Build & Development Commands

```bash
# Install & build
pnpm install                    # Install deps (Node >=22.12.0, pnpm 10.23.0)
pnpm build                     # Full build (tsdown + plugin SDK + metadata)

# Development
pnpm dev                       # Run CLI/gateway in dev mode
pnpm gateway:dev               # Gateway-only dev mode (skip channels)
pnpm ui:dev                    # Vite dev server for web UI (port 5173)

# Quality checks
pnpm check                     # All checks: format + tsgo + lint + boundary checks
pnpm tsgo                      # TypeScript type checking
pnpm format:fix                # Fix formatting (oxfmt)
pnpm lint:fix                  # Fix lint issues (oxlint)

# Testing
pnpm test                      # Run tests (Vitest)
pnpm test:fast                 # Unit tests only
pnpm test:e2e                  # End-to-end tests
pnpm test:coverage             # With V8 coverage (70% threshold)
OPENCLAW_LIVE_TEST=1 pnpm test:live  # Live tests (needs real API keys)

# Database
pnpm db:migrate                # Run migrations
pnpm db:migrate:status         # Check migration status

# Start gateway (production)
node --env-file=.env dist/index.js gateway --port 18789
```

## Architecture Overview

**Gateway server** (Express 5 + WebSocket) is the core runtime. Entry: `src/gateway/boot.ts` → `src/gateway/server.ts`. Handles auth, channel routing, agent orchestration, and cron scheduling.

**Agent runtime** uses Pi embedded runner (`@mariozechner` packages) with 60+ built-in tools and a composable StreamFn execution pattern. Code in `src/agents/`.

**Multi-tenant data layer**: PostgreSQL (primary) or SQLite (single-machine fallback). Models in `src/db/` cover tenants, users, agents, channels, usage, and audit logs. JWT-based auth with RBAC in `src/auth/`.

**Channel system**: 6 core channels (`src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web`) + 41 extension channels (`extensions/*/`). All use a standardized inbound/outbound transport adapter pattern.

**Plugin ecosystem**: Extensions live in `extensions/{name}/`, built as TypeScript packages with `openclaw/plugin-sdk`. Runtime installs via `npm install --omit=dev` in plugin dir. Plugin-only deps go in the extension `package.json`, never the root.

**Skills**: 60+ pre-built skills in `skills/` (GitHub, Slack, Discord, Notion, Cloudflare, etc.).

**Web UI**: Lit 3 web components in `ui/src/`, built with Vite.

### Key directories

| Directory | Purpose |
|-----------|---------|
| `src/cli/` | CLI wiring (Commander.js) |
| `src/commands/` | Agent, channel, config, cron, skill commands |
| `src/gateway/` | WebSocket/HTTP server, auth, protocol, channel mgmt |
| `src/agents/` | Agent runtime, Pi integration, tool/skill loading |
| `src/providers/` | Model provider APIs (Anthropic, OpenAI, Gemini, Qwen, etc.) |
| `src/db/` | PostgreSQL + SQLite models |
| `src/auth/` | JWT, RBAC, pairing, device management |
| `src/channels/` | Shared channel logic, transport, routing |
| `ui/src/` | Lit web components |
| `extensions/*/` | Channel plugins (pnpm workspace packages) |
| `skills/` | Pre-built AI skills |

## Code Conventions

- **TypeScript strict mode** (ESM). No `any`, no `@ts-nocheck`.
- **Oxlint + Oxfmt** for linting/formatting. Run `pnpm check` before commits.
- **No prototype mutation** — use composition/inheritance.
- **Files under ~500-700 LOC** — split for clarity.
- **Tests**: colocated `*.test.ts`, e2e in `*.e2e.test.ts`. Vitest with V8 coverage.
- **Commits**: use `scripts/committer "<msg>" <file...>` for scoped staging. Concise, action-oriented messages.
- **Tool schemas**: avoid `Type.Union`/`anyOf`/`oneOf`; use `stringEnum`/`optionalStringEnum`. No raw `format` property names.
- **CLI progress**: use `src/cli/progress.ts`, not hand-rolled spinners.
- **Colors**: use shared palette in `src/terminal/palette.ts`, no hardcoded colors.

## Multi-Agent Safety

- Do not create/apply/drop git stash entries unless explicitly requested.
- Do not switch branches or modify git worktrees unless explicitly asked.
- Scope commits to your changes only. When you see unrecognized files, keep going.
- No `git pull --rebase --autostash` — other agents may be working concurrently.

## Extension Development

- Keep plugin-only deps in the extension's `package.json`, not the root.
- Avoid `workspace:*` in `dependencies` (breaks `npm install`); put `openclaw` in `devDependencies` or `peerDependencies`.
- When refactoring shared channel logic, consider **all** built-in + extension channels.
- When adding channels/extensions, update `.github/labeler.yml` and create matching labels.

## Important Constraints

- Never update the Carbon dependency.
- Any dependency with `pnpm.patchedDependencies` must use exact versions (no `^`/`~`).
- Patching dependencies requires explicit approval.
- Never send streaming/partial replies to external messaging surfaces (WhatsApp, Telegram) — only final replies.
- Naming: **OpenClaw** for product/docs headings; `openclaw` for CLI/package/paths/config keys.
