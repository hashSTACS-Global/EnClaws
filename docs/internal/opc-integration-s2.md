# OPC Integration — Agenora Backend Contract (S2)

> **本契约同时作为未来智枢 OS（Agenora）架构设计的输入参考。**
> Agenora 团队设计 OS API 时，应保证 honor 本契约定义的接口、字段、状态机，使 OPC 端无需改动即可通过 env 切换 backend 实现。
> **当前实现**：EnClaws (EC)
> **未来实现**：Agenora (OS)
> 两者共用本契约。OPC 端通过 `AGENORA_BASE_URL` 切换实现。

> **业务背景** 见 opc-web 私有仓库 `docs/iterations/s2/prd-s2.md`（含客户场景、商业判断、跨仓接口期望）

---

## 1. Status & Scope

- **Status**: Sprint 2 draft (2026-05-12)
- **Owner**: OPC team (initial implementation)
- **Audience**: backend engineers implementing Agenora backend contract (currently EnClaws)

## 2. OS Compatibility Promise

OPC ↔ Agenora is a **stable API surface**. Implementations MUST honor:

- Endpoint shapes (paths, methods, response envelopes)
- Field names, types, enum values
- State machine transitions
- Error code contracts

When implementation changes (EC → OS), OPC clients change **at most one env variable** (`AGENORA_BASE_URL`). No code changes on OPC side.

---

## 3. Integration Topology

**Call pattern**: OPC frontend → OPC backend → Agenora backend (no direct browser-to-backend calls; avoids CORS, hides backend, allows degraded fallback).

```
Browser → OPC Web (3000)
              ↓ same-origin
         OPC API (3001) ← holds AGENORA_API_KEY
              ↓ Bearer service token
         Agenora Backend (current: EC 18888)
              ↓
         PG / SQLite
```

**Auth model**:
- OPC backend holds `AGENORA_API_KEY` as service-to-service token
- Tenant/user identity passed via API parameters (`tenantId`, `userId`)
- Agenora backend authenticates the token, then trusts the parameters as authorization context

**Env switching**:
- Local: `AGENORA_BASE_URL=http://localhost:18888`
- Dev: `AGENORA_BASE_URL=https://ec-dev.enclaws.com` (later: `https://os-dev.enclaws.com`)
- Single env switch swaps the entire backend; OPC code is backend-agnostic

---

## 4. Data Ownership Matrix

| Data class | Owner (single source of truth) | Mirror / cache permitted |
|---|---|---|
| `matter`, `file` (timeline items), PDCA state | **OPC** (data master) | Optional read-through to Agenora for agent context |
| `agent` configs, knowledge bases | **Agenora** | OPC reads via API |
| Customer service sessions, agent session transcripts | **Agenora** | OPC reads via API |
| Tenant identity, user identity | **OPC** | Passed as parameters |

**Principle**: tenant data sovereignty belongs to the tenant. OPC users MUST be able to export all Agenora-side data (see §7).

---

## 5. Data Model — PDCA File Type Extension

OPC's matter timeline introduces 6 file types under two axes:

**Stateful (PDCA cycle)**:
- `plan` — what is intended
- `do` — execution (carries `result` as sub-attribute)
- `check` — verification of result vs plan
- `act` — decision (standardize / adjust / next-cycle plan)

**Stateless (context attachment, any time)**:
- `note` — facts, attachments, logs
- `think` — reasoning, judgments, insights (rolled up to memory layers)

### Required fields on every file

| Field | Type | Purpose |
|---|---|---|
| `source` | `"ai" \| "human" \| "hybrid"` | Origin of the content |
| `os_sync` | `"pending" \| "synced"` | Sync state with Agenora backend |
| `created_at`, `created_by` | ISO 8601 / user-id | Standard audit |

`os_sync` allows OPC to remain the data master even when Agenora is offline. See §8.

---

## 6. Universal API Contract

All endpoints require `Authorization: Bearer ${AGENORA_API_KEY}`.

### 6.1 Health

```
GET /api/health
→ 200 { ok: boolean, message?: string }
```

### 6.2 Matter Derivation

Any OPC upstream module (AI customer service, etc.) can derive a matter via OPC backend, which records it as `source: "ai"` and (when enabled) registers with Agenora for context.

```
POST /api/matter
Body: {
  tenantId: string,
  title: string,
  context: { sourceModule: string, ... },
  initialFiles?: Array<{ type: FileType, content: string, source: "ai" | "human" }>
}
→ 200 { matterId: string }
```

Trigger rules (e.g. CS low-confidence threshold) are defined in the consuming application's spec (see `customer-service-s2.md`).

### 6.3 Tenant Data Export (mandatory capability)

```
GET /api/tenant/{tenantId}/export?type={agents|knowledge|cs-sessions|agent-sessions|all}
→ 200 (streamed JSON or chunked ZIP)
```

- Streams full tenant data of the requested type
- Format: streaming JSON (default) or ZIP archive
- Used by OPC's "tenant data export" UI to give customers their data
- **MUST be implementable by any Agenora backend** — this is the tenant data sovereignty guarantee

Per-type schema is defined in the consuming application's spec.

### 6.4 Cross-Org Mention

For OPC's cross-organization scenarios (buyer/seller in different tenants).

```
POST /api/mention
Body: { fromTenantId, toTenantId, matterId, fileId, mentionedUserIds: string[] }
→ 200 { ok: true }
```

Backend resolves identifiers and triggers notification per Agenora's channel configuration.

---

## 7. Error & Fallback Contract

| Scenario | Backend behavior | OPC behavior |
|---|---|---|
| Health check fails | Return `{ ok: false, message }` | Mark `source: "mock"`, log to `external_sync_jobs` |
| 4xx error | Return `{ error: { code, message } }` | Surface to user, no retry |
| 5xx / timeout | Return 5xx or abort | Fallback to mock, record failed sync job, retry policy TBD |
| Network unreachable | N/A | Same as 5xx |

OPC's `external_sync_jobs` table tracks all failed Agenora calls for later retry / inspection.

---

## 8. Degraded Closure (OPC = data master)

When Agenora backend is offline:

1. OPC continues to accept all user actions — PDCA state machine lives in OPC business logic
2. All new files marked `os_sync: "pending"`, `source: "human"` (or `"ai"` if local mock used)
3. OPC UI shows non-blocking banner "Agenora backend unreachable"
4. When Agenora recovers:
   - OPC pushes pending files via `POST /api/matter` (idempotent by file ID)
   - On success, flips `os_sync: "synced"`
   - Agenora may post-process: enrich with `think` files, suggestions, etc.

**Invariant**: OPC business flow never blocks on Agenora availability. PDCA cycle continues with human-only data.

---

## 9. Versioning & Compatibility

- **Contract version**: v1.0 (this document)
- **Versioning policy**: additive changes only within v1.x; breaking changes require v2 with parallel v1 support
- **Header**: every request carries `X-Agenora-Contract-Version: 1.0`; backend rejects unsupported with 426

---

## 10. Implementation Notes (current: EnClaws)

EC-specific implementation details (deployment, config, env vars beyond contract) live in `customer-service-deployment.md` (S1) and `customer-service-s2.md` (S2).

Items NOT in the OPC-side contract but EC must provide:
- `ENCLAWS_CS_WIDGET_SECRET` (EC-side HMAC for chat widget) — EC implementation detail
- EC's internal admin UI for tenant management — not exposed via Agenora contract

---

## 11. Open Questions (to align with Agenora v1)

1. Will Agenora preserve the `/api/matter`, `/api/tenant/.../export` endpoint paths verbatim, or namespace differently?
2. Authentication: stay with bearer service token, or move to JWT-per-tenant?
3. Cross-org mention routing: who owns the channel mapping (OPC tenant config or Agenora)?

These will be resolved when dengke ships Agenora v1 architecture (target: ~2026-05-15 per 2026-05-12 sync).

---

## Changelog

- 2026-05-12: Initial draft, contract v1.0. Rename of OPC client config `ENCLAWS_*` → `AGENORA_*` completed in opc-web.
