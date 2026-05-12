# AI Customer Service — Agenora Service Contract (S2)

> **本文档定义 AI 客服服务接口契约。**
> 未来智枢 OS（Agenora）接管 AI 客服模块时，应按本契约实现服务接口、数据导出 API、matter 派生协议，使 OPC 租户后台 AI 客服功能无需改动即可切换 backend。
> **当前实现**：EnClaws (EC) S2 (refactor in progress on `feat/ai-customer-service` branch)
> **未来实现**：Agenora (OS)
> Builds on `opc-integration-s2.md` for transport, auth, and data ownership.

> **业务背景** 见 opc-web 私有仓库 `docs/iterations/s2/prd-s2.md` §B 主线 + CS-1~CS-7（含九米客户场景、dengke 第三代 AI 客服设计、商业判断）

---

## 1. Status & Scope

- **Status**: Sprint 2 draft (2026-05-12); S1 already shipped (see `customer-service-deployment.md`)
- **Audience**: backend engineers implementing CS module; supersedes S1 architecture where in conflict

## 2. OS Compatibility Promise

Same promise as `opc-integration-s2.md` §2. The CS module is an **application layer** on top of the Agenora backend contract. Any Agenora implementation must:

- Honor §4 widget RPC shape
- Honor §5 confidence-gated derivation triggers
- Honor §6 session/knowledge-base schema for export

---

## 3. S2 Refactor Scope (vs. S1)

S1 shipped (2026-04-13): end-to-end RAG, Feishu notification, widget embed.

**S2 adds (under Agenora contract)**:

| Capability | S1 | S2 |
|---|---|---|
| RAG knowledge base per tenant | ✅ | ✅ (no change to storage) |
| Feishu notification on new session | ✅ | ✅ |
| Streaming output | ❌ | ✅ |
| Confidence gating | ❌ | ✅ (gates matter derivation) |
| Clarification follow-up | ❌ | ✅ |
| **Active matter derivation** (low-confidence → create matter in OPC) | ❌ | ✅ ⭐ |
| **Tenant data export** (sessions / knowledge / agent configs) | ❌ | ✅ ⭐ |
| **Long-term context** (Agenora's memory graph) | ❌ | (T1+, after Agenora v1) |

⭐ = critical for OPC tenant integration; required before OPC's "AI 客服" tenant-admin menu can ship.

---

## 4. Widget RPC Contract

Channel: WebSocket, namespace `cs.widget.*`. Existing S1 contract; S2 extends with streaming + confidence metadata.

### 4.1 Connect

```
→ { method: "cs.widget.connect", tenantId, visitorId, token }
← { sessionId, agentName, greeting }
```

`token` = HMAC(visitorId, ENCLAWS_CS_WIDGET_SECRET) — EC-side secret, opaque to OPC.

### 4.2 Send Message (streaming)

```
→ { method: "cs.widget.send", sessionId, content }
← (streamed) { type: "chunk", content: string }
← (streamed) { type: "chunk", content: string }
...
← { type: "done", confidence: number, sources: Array<{ kbId, snippet }> }
```

`confidence` ∈ [0, 1]: agent's self-assessed answer confidence, drives §5 derivation.

### 4.3 History

```
→ { method: "cs.widget.history", sessionId, limit?, before? }
← { messages: Array<{ role, content, createdAt, confidence? }> }
```

---

## 5. Confidence-Gated Matter Derivation

When agent confidence < threshold (default 0.6, tenant-configurable), the CS module MUST automatically derive a matter into OPC via the universal contract (`opc-integration-s2.md` §6.2).

### Trigger logic

```
on cs.widget.send response:
  if response.confidence < tenant.cs.confidenceThreshold:
    POST /api/matter to OPC backend with:
      title: "客服求助: {sessionTopicSummary}"
      context: {
        sourceModule: "customer-service",
        sessionId: <cs.session.id>,
        confidence: <number>,
        customerSnippet: <last user message>,
      }
      initialFiles: [
        { type: "note", content: <conversation transcript>, source: "ai" },
        { type: "think", content: <agent's reasoning + why it lacked confidence>, source: "ai" },
      ]
    notify configured operators (Feishu / internal channel) of new matter
    return matter ID to widget so customer sees "we've escalated this"
```

### Tenant-configurable

| Setting | Default | Range |
|---|---|---|
| `confidenceThreshold` | 0.6 | [0, 1] |
| `autoDerive` | true | bool |
| `notifyChannel` | "feishu" | enum |
| `operatorMentionList` | tenant admin | string[] |

Stored in `~/.enclaws/tenants/{tenantId}/customer-service/config.json` (current EC impl).

---

## 6. Knowledge Base Schema

Per-tenant Markdown files at `~/.enclaws/tenants/{tenantId}/customer-service/memory/` (current EC impl). Agenora backend MUST expose:

```
GET /api/cs/knowledge?tenantId={id}
→ { entries: Array<{ id, title, body, updatedAt }> }

POST /api/cs/knowledge
Body: { tenantId, title, body }
→ { id, createdAt }

PUT /api/cs/knowledge/{id}
Body: { tenantId, title?, body? }
→ { id, updatedAt }

DELETE /api/cs/knowledge/{id}?tenantId={id}
→ { ok: true }
```

Markdown is the canonical format. Other formats (PDF, DOCX) are imported by the OPC tenant-admin UI and converted to markdown before storage.

---

## 7. Session Stream Export Schema

For tenant data export (`opc-integration-s2.md` §6.3, `type=cs-sessions`):

```
{
  sessions: [
    {
      sessionId: string,
      tenantId: string,
      visitorId: string,
      startedAt: ISO8601,
      endedAt: ISO8601 | null,
      derivedMatterId: string | null,
      messages: [
        { role: "user" | "agent", content: string, confidence?: number, createdAt: ISO8601 },
        ...
      ],
      sourcesCited: [{ kbId, snippet }]
    },
    ...
  ]
}
```

Streamed as NDJSON (one session per line) for tenants with > 1000 sessions.

Per-session export (single conversation download from OPC widget UI) uses the same per-session object inline.

---

## 8. Agent Session Export Schema

For non-CS agent sessions (`opc-integration-s2.md` §6.3, `type=agent-sessions`):

```
{
  sessions: [
    {
      sessionId: string,
      tenantId: string,
      agentId: string,
      agentName: string,
      startedAt: ISO8601,
      endedAt: ISO8601 | null,
      messages: [...],
      toolCalls: [...],
      derivedMatterIds: string[]
    },
    ...
  ]
}
```

---

## 9. Agent Configuration Schema

For tenant data export (`type=agents`):

```
{
  agents: [
    {
      agentId: string,
      name: string,
      type: "customer-service" | "task" | "knowledge" | "custom",
      modelProvider: string,
      modelName: string,
      systemPrompt: string,
      tools: string[],
      knowledgeBaseIds: string[],
      createdAt: ISO8601
    }
  ]
}
```

---

## 10. Long-Term Context (T1+, after Agenora v1)

S2 (current) does NOT integrate Agenora memory graph. CS agent is stateless per-session aside from RAG retrieval.

T1+ scope (post Agenora v1):
- Agent reads tenant long-term memory graph at session start
- Confidence calculation incorporates long-term context (e.g., known customer history)
- Active matter derivation reasons over project history, not just current conversation

To be specified in v2 of this document once Agenora v1 ships.

---

## 11. Open Questions (to align with Agenora v1)

1. Will memory graph access be per-session (lazy) or pre-loaded into agent context?
2. Confidence calculation: agent self-report (current) vs centralized scoring service?
3. Multi-language support for cross-border tenants (e.g., 九米 cross-border e-commerce): per-tenant model selection or universal multilingual model?

---

## Changelog

- 2026-05-12: Initial draft, S2 contract v1.0. Builds on `opc-integration-s2.md` v1.0.
