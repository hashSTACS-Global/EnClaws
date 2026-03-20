# OpenClaw 系统架构

## 一、系统总体架构

```mermaid
graph TB
    subgraph Clients["客户端层"]
        WebUI["Web 管理 UI<br/>(Lit Components)"]
        CLI["CLI 命令行<br/>(openclaw)"]
        TUI["TUI 终端界面"]
        MacOS["macOS App"]
        iOS["iOS App"]
        Android["Android App"]
    end

    subgraph Channels["频道接入层 (41个频道)"]
        Feishu["飞书/Lark"]
        Discord["Discord"]
        Telegram["Telegram"]
        Slack["Slack"]
        WhatsApp["WhatsApp"]
        WeChat["微信"]
        Teams["MS Teams"]
        More["Matrix / IRC / Signal<br/>LINE / Nostr / ..."]
    end

    subgraph Gateway["网关层 (Gateway Server)"]
        WS["WebSocket Server<br/>(ws-connection)"]
        HTTP["HTTP Server<br/>(server-http.ts)"]
        RPC["RPC 方法分发<br/>(server-methods.ts)"]
        Auth["认证 & RBAC<br/>(JWT + 角色权限)"]
        ChannelMgr["频道管理器<br/>(server-channels.ts)"]
        PluginMgr["插件管理器<br/>(server-plugins.ts)"]
        CronSvc["定时任务服务<br/>(server-cron.ts)"]
        SessionResolve["会话解析<br/>(sessions-resolve.ts)"]
        Broadcast["消息广播<br/>(server-broadcast.ts)"]
    end

    subgraph Core["核心引擎层"]
        Dispatch["消息分发<br/>(dispatch.ts)"]
        ReplyEngine["回复引擎<br/>(get-reply.ts)"]
        AgentRunner["Agent 执行器<br/>(agent-runner.ts)"]
        EmbeddedRunner["嵌入式运行器<br/>(pi-embedded-runner)"]
        StreamChain["StreamFn 包装链<br/>(attempt.ts)"]
        ToolSystem["工具系统<br/>(pi-tools.ts / 60+工具)"]
        SkillSystem["技能系统<br/>(40+预置技能)"]
    end

    subgraph AI["AI 模型层"]
        Claude["Anthropic Claude<br/>(Opus/Sonnet/Haiku)"]
        GPT["OpenAI GPT-4"]
        Qwen["通义千问 Qwen"]
        DeepSeek["DeepSeek"]
        Gemini["Google Gemini"]
        OtherLLM["Kimi / Mistral / MiniMax<br/>Moonshot / OpenRouter"]
    end

    subgraph Storage["存储层"]
        PG["PostgreSQL<br/>(多租户数据)"]
        SQLite["SQLite<br/>(单机会话)"]
        FS["文件系统<br/>(租户目录隔离)"]
        LanceDB["LanceDB<br/>(向量记忆)"]
    end

    subgraph Observability["可观测性"]
        Trace["交互追踪<br/>(interaction-trace)"]
        AuditLog["审计日志<br/>(audit-log)"]
        Usage["用量统计<br/>(usage)"]
        OTEL["OpenTelemetry"]
        StructLog["结构化日志"]
    end

    %% 连接关系
    Clients -->|WebSocket/HTTP| Gateway
    Channels -->|Webhook/长连接| ChannelMgr

    WS --> RPC
    HTTP --> RPC
    RPC --> Auth
    Auth --> SessionResolve
    SessionResolve --> Dispatch

    ChannelMgr -->|频道消息| Dispatch
    PluginMgr -.->|插件扩展| RPC
    PluginMgr -.->|插件扩展| ToolSystem

    Dispatch --> ReplyEngine
    ReplyEngine --> AgentRunner
    AgentRunner --> EmbeddedRunner
    EmbeddedRunner --> StreamChain
    StreamChain --> AI
    EmbeddedRunner --> ToolSystem
    EmbeddedRunner --> SkillSystem

    CronSvc -->|定时触发| Dispatch

    Core --> Storage
    Gateway --> PG
    EmbeddedRunner --> Trace
    Gateway --> AuditLog
    Gateway --> Usage
```

## 二、多租户数据隔离架构

```mermaid
graph TB
    subgraph TenantA["租户A (企业A)"]
        subgraph AgentsA["Agents"]
            A1["agent-sales<br/>AGENT.md / SOUL.md"]
            A2["agent-support<br/>AGENT.md / SOUL.md"]
        end
        subgraph UsersA["Users"]
            UA1["用户 A1 (union_id_1)"]
            UA2["用户 A2 (union_id_2)"]
        end
        subgraph UserDirA1["users/union_id_1/"]
            SA1["sessions/"]
            WA1["workspace/<br/>MEMORY.md + memory/"]
            DA1["devices/"]
            CA1["credentials/"]
            CRA1["cron/jobs.json"]
        end
        subgraph UserDirA2["users/union_id_2/"]
            SA2["sessions/"]
            WA2["workspace/<br/>MEMORY.md + memory/"]
            DA2["devices/"]
            CA2["credentials/"]
            CRA2["cron/jobs.json"]
        end
    end

    subgraph TenantB["租户B (企业B)"]
        subgraph AgentsB["Agents"]
            B1["agent-helper<br/>AGENT.md / SOUL.md"]
        end
        subgraph UsersB["Users"]
            UB1["用户 B1 (union_id_3)"]
        end
    end

    subgraph DB["PostgreSQL"]
        Tenants["tenants 表"]
        Users["users 表<br/>(open_ids[], union_id)"]
        TAgents["tenant_agents 表"]
        TChannels["tenant_channels 表"]
        TChannelApps["tenant_channel_apps 表"]
        Traces["llm_interaction_traces 表"]
        UsageT["usage_records 表"]
    end

    subgraph FS["文件系统 (~/.openclaw/tenants/)"]
        FSA["tenants/{tenantA_id}/"]
        FSB["tenants/{tenantB_id}/"]
    end

    UA1 --> UserDirA1
    UA2 --> UserDirA2

    TenantA --> FSA
    TenantB --> FSB

    Tenants --> TAgents
    Tenants --> Users
    Tenants --> TChannels
    TChannels --> TChannelApps
    TAgents -.->|channel_app_id| TChannelApps
```

**目录结构：**
```
~/.openclaw/tenants/{tenantId}/
├── SOUL.md / TOOLS.md / MEMORY.md          # 租户级配置
├── agents/{agentId}/                        # Agent 配置（无状态，共享）
│   ├── AGENT.md / SOUL.md / IDENTITY.md
│   ├── HEARTBEAT.md / BOOTSTRAP.md
│   └── skills/{skillName}/SKILL.md
├── skills/{skillName}/SKILL.md              # 租户级技能
└── users/{unionId}/                         # 用户级（完全隔离）
    ├── USER.md
    ├── sessions/  (sessions.json + {sessionId}.jsonl)
    ├── workspace/ (MEMORY.md + memory/)
    ├── devices/
    ├── credentials/
    └── cron/jobs.json
```

## 三、消息处理核心流程

```mermaid
sequenceDiagram
    participant User as 用户
    participant Channel as 频道层<br/>(飞书/WebChat/...)
    participant Gateway as 网关层
    participant Dispatch as 消息分发
    participant Reply as 回复引擎
    participant Agent as Agent 执行器
    participant LLM as 大模型 API
    participant Tools as 工具系统
    participant DB as 数据库

    User->>Channel: 发送消息
    Channel->>Gateway: Webhook / WebSocket

    Note over Gateway: 认证 & 权限校验

    Gateway->>Dispatch: dispatchInboundMessage()

    Note over Dispatch: 1. 解析频道/用户<br/>2. Auto-provision 用户<br/>3. 解析 Agent 绑定

    Dispatch->>Reply: getReplyFromConfig()

    Note over Reply: 1. 解析 Agent 配置<br/>2. 解析工作空间路径<br/>3. 加载/创建 Session

    Reply->>Agent: runAgentTurnWithFallback()
    Agent->>Agent: runEmbeddedAttempt()

    Note over Agent: 构建 System Prompt:<br/>SOUL.md + IDENTITY.md +<br/>AGENT.md + 工具描述 +<br/>运行时信息

    Agent->>Agent: 包装 StreamFn 链

    loop Tool-Use 循环
        Agent->>LLM: StreamFn(model, context, options)<br/>system + messages + tools
        LLM-->>Agent: 流式响应 (text / tool_use)

        alt LLM 返回 tool_use
            Agent->>Tools: 执行工具调用
            Tools-->>Agent: tool_result
            Note over Agent: 将 tool_result 追加到 messages
        else LLM 返回 end_turn
            Note over Agent: 对话完成，退出循环
        end
    end

    Agent-->>DB: 记录交互追踪 (fire-and-forget)
    Agent-->>DB: 记录用量统计
    Agent-->>Gateway: broadcastChatFinal()
    Gateway-->>Channel: 回复消息
    Channel-->>User: 显示回复
```

## 四、StreamFn 包装链（由内到外）

```mermaid
graph LR
    subgraph Chain["StreamFn 包装链 (attempt.ts)"]
        direction LR
        Base["① Base StreamFn<br/><small>streamSimple / Ollama /<br/>DeepSeek / Qwen / OpenAI WS</small>"]
        Ollama["② Ollama NumCtx<br/><small>上下文窗口控制</small>"]
        Cache["③ Cache Trace<br/><small>缓存行为追踪</small>"]
        Think["④ Drop Thinking<br/><small>清理思考块</small>"]
        SanID["⑤ Sanitize Tool IDs<br/><small>工具调用ID规范化</small>"]
        Trim["⑥ Trim Tool Names<br/><small>工具名长度截断</small>"]
        AntLog["⑦ Anthropic Logger<br/><small>API 请求日志</small>"]
        Trace["⑧ Interaction Trace<br/><small>交互追踪记录</small>"]
    end

    LLM["大模型 API"] --> Base
    Base --> Ollama --> Cache --> Think --> SanID --> Trim --> AntLog --> Trace
    Trace --> AgentLoop["Agent Loop<br/>(pi-agent-core)"]

    style Trace fill:#e1f5fe,stroke:#0288d1,stroke-width:2px
    style Base fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

**数据流向：Agent Loop 调用最外层 (⑧)，逐层传递到最内层 (①) 发送到 LLM API；响应从 ① 原路返回。每一层可以拦截/修改请求和响应。**

## 五、Agent 执行详细流程

```mermaid
flowchart TB
    Start([用户消息到达]) --> Provision

    subgraph Provision["用户 Auto-Provision"]
        P1["解析 sender open_id / union_id"]
        P2["findOrCreateUserByOpenId()<br/>1. 按 union_id 查<br/>2. 按 open_ids 数组查<br/>3. 创建新用户"]
        P3["初始化用户目录<br/>devices/ credentials/ cron/"]
        P1 --> P2 --> P3
    end

    Provision --> SessionResolve

    subgraph SessionResolve["会话解析"]
        S1["生成 Session Key<br/>群聊: group_sender 模式<br/>私聊: 1:1 模式"]
        S2["多租户 Key 格式<br/>t:{tenantId}:{base-key}"]
        S3["加载/创建 Session 文件<br/>users/{unionId}/sessions/"]
        S1 --> S2 --> S3
    end

    SessionResolve --> BuildPrompt

    subgraph BuildPrompt["构建 System Prompt"]
        BP1["读取 SOUL.md<br/>(系统人格)"]
        BP2["读取 IDENTITY.md<br/>(身份信息)"]
        BP3["读取 AGENT.md<br/>(Agent 配置)"]
        BP4["注入工具描述"]
        BP5["注入运行时信息<br/>(工作空间路径等)"]
        BP6["注入技能提示"]
        BP7["buildAgentSystemPrompt()"]
        BP1 --> BP7
        BP2 --> BP7
        BP3 --> BP7
        BP4 --> BP7
        BP5 --> BP7
        BP6 --> BP7
    end

    BuildPrompt --> LoadTools

    subgraph LoadTools["加载工具"]
        LT1["核心工具<br/>read/write/bash/web..."]
        LT2["频道工具<br/>feishu/discord/..."]
        LT3["插件工具<br/>memory_search/..."]
        LT4["技能工具"]
        LT5["工具策略管道<br/>applyToolPolicyPipeline()"]
        LT1 --> LT5
        LT2 --> LT5
        LT3 --> LT5
        LT4 --> LT5
    end

    LoadTools --> WrapStream

    subgraph WrapStream["包装 StreamFn"]
        W1["Base → Ollama → Cache →<br/>Thinking → SanitizeID →<br/>TrimNames → Logger → Trace"]
    end

    WrapStream --> Execute

    subgraph Execute["执行 Agent 循环"]
        E1["调用 prompt(userInput)"]
        E2["pi-agent-core 内部:<br/>convertToLlm(messages)"]
        E3["调用 StreamFn 链 → LLM API"]
        E4{{"响应类型?"}}
        E5["执行工具调用"]
        E6["tool_result 加入 messages"]
        E7["生成最终回复"]

        E1 --> E2 --> E3 --> E4
        E4 -->|tool_use| E5 --> E6 --> E3
        E4 -->|end_turn| E7
    end

    Execute --> PostProcess

    subgraph PostProcess["后处理"]
        PP1["记录交互追踪<br/>(每轮 StreamFn 调用)"]
        PP2["记录 token 用量"]
        PP3["广播回复消息"]
        PP4["Session 持久化"]
        PP1 --> PP2 --> PP3 --> PP4
    end

    PostProcess --> End([回复用户])
```

## 六、群聊并发隔离流程

```mermaid
sequenceDiagram
    participant UA as 用户A (open_id_a)
    participant UB as 用户B (open_id_b)
    participant Group as 飞书群
    participant Bot as 飞书 Bot
    participant AP as Auto-Provision
    participant Agent as Agent

    par 用户A发消息
        UA->>Group: @Bot 今天天气怎样?
        Group->>Bot: event(sender=open_id_a)
        Bot->>AP: autoProvision(open_id_a, union_id_a)
        AP-->>Bot: {unionId: union_id_a}
        Note over Bot: tenantUserId = union_id_a<br/>sessionKey = group_sender 模式<br/>→ 包含 union_id_a
        Bot->>Agent: prompt("今天天气怎样?")
        Note over Agent: Session: users/union_id_a/sessions/<br/>Workspace: users/union_id_a/workspace/
        Agent-->>UA: 回复天气信息
    and 用户B同时发消息
        UB->>Group: @Bot 帮我查个快递
        Group->>Bot: event(sender=open_id_b)
        Bot->>AP: autoProvision(open_id_b, union_id_b)
        AP-->>Bot: {unionId: union_id_b}
        Note over Bot: tenantUserId = union_id_b<br/>sessionKey = group_sender 模式<br/>→ 包含 union_id_b
        Bot->>Agent: prompt("帮我查个快递")
        Note over Agent: Session: users/union_id_b/sessions/<br/>Workspace: users/union_id_b/workspace/
        Agent-->>UB: 回复快递信息
    end

    Note over UA,UB: 两个用户的 session、workspace、memory<br/>完全隔离，互不影响
```

## 七、LLM 交互追踪数据模型

```mermaid
erDiagram
    USER_QUESTION ||--o{ TURN : "triggers"
    TURN ||--|{ LLM_CALL : "contains"

    USER_QUESTION {
        string user_input "用户提问"
        string session_key "会话标识"
    }

    TURN {
        uuid turn_id "轮次ID (一次用户提问)"
        string agent_id "Agent标识"
        string user_id "用户标识"
        timestamp created_at "创建时间"
    }

    LLM_CALL {
        uuid id "记录ID"
        uuid turn_id "关联轮次"
        int turn_index "轮内序号 (0,1,2...)"
        text system_prompt "系统提示词"
        jsonb messages "发送的消息数组"
        jsonb tools "可用工具定义"
        jsonb response "模型响应"
        string stop_reason "停止原因 (end_turn/tool_use)"
        bigint input_tokens "输入token数"
        bigint output_tokens "输出token数"
        int duration_ms "耗时(ms)"
    }
```

**示例：用户问"帮我搜下北京天气"触发 3 次 LLM 调用**

| turn_index | stop_reason | 说明 |
|:---:|:---:|------|
| 0 | tool_use | LLM 决定调用 web_search 工具 |
| 1 | tool_use | LLM 决定调用 web_fetch 抓取详情 |
| 2 | end_turn | LLM 生成最终回复 |

## 八、插件系统架构

```mermaid
graph TB
    subgraph PluginSDK["Plugin SDK (公开接口)"]
        API["OpenClawPluginApi"]
        RegTool["registerTool()"]
        RegCli["registerCli()"]
        RegHook["registerHook()"]
        RegSvc["registerService()"]
    end

    subgraph PluginTypes["插件类型"]
        MemPlugin["Memory 插件<br/>(memory-core / memory-lancedb)"]
        ChanPlugin["Channel 插件<br/>(feishu / discord / ...)"]
        AuthPlugin["Auth 插件<br/>(gemini-auth / qwen-auth)"]
        ToolPlugin["工具插件<br/>(lobster / llm-task)"]
        ObsPlugin["观测插件<br/>(diagnostics-otel)"]
    end

    subgraph Discovery["插件发现"]
        Bundled["内置插件<br/>(extensions/ 目录)"]
        Global["全局插件<br/>(~/.openclaw/extensions/)"]
        Workspace["工作区插件<br/>(.openclaw/extensions/)"]
        Custom["自定义路径<br/>(plugins.load.paths)"]
    end

    subgraph Slots["插槽机制"]
        MemSlot["memory 插槽<br/>(排他: 只能一个)"]
    end

    subgraph Lifecycle["插件生命周期"]
        L1["发现 → 校验 manifest"]
        L2["加载 → import index.ts"]
        L3["注册 → plugin.register(api)"]
        L4["运行 → hooks/tools 生效"]
    end

    Discovery --> Lifecycle
    Lifecycle --> PluginSDK
    PluginSDK --> PluginTypes
    MemPlugin --> MemSlot

    subgraph Config["配置 (openclaw.json)"]
        CE["plugins.enabled: true"]
        CA["plugins.allow: [...]"]
        CD["plugins.deny: [...]"]
        CS["plugins.slots.memory: 'memory-core'"]
    end

    Config --> Discovery
```

## 九、技术栈总览

```mermaid
graph LR
    subgraph Frontend["前端"]
        Lit["Lit Web Components"]
        TS1["TypeScript"]
        Rolldown["Rolldown 打包"]
        I18n["i18n (5种语言)"]
    end

    subgraph Backend["后端"]
        Node["Node.js ≥22.12"]
        TS2["TypeScript (strict)"]
        WS["WebSocket (ws)"]
        Express["HTTP Server"]
    end

    subgraph AI_Layer["AI 层"]
        PiAI["@mariozechner/pi-ai<br/>(LLM 抽象层)"]
        PiCore["@mariozechner/pi-agent-core<br/>(Agent 循环引擎)"]
        PiCoding["@mariozechner/pi-coding-agent<br/>(编码 Agent)"]
    end

    subgraph Data["数据层"]
        PG2["PostgreSQL 16"]
        SQLite2["SQLite (better-sqlite3)"]
        Lance["LanceDB"]
        FileSystem["文件系统"]
    end

    subgraph Infra["基础设施"]
        Docker2["Docker / Compose"]
        Vitest["Vitest 测试"]
        OxLint["oxlint 检查"]
        Playwright["Playwright 浏览器"]
    end

    subgraph Native["原生客户端"]
        MacApp["macOS (Cocoa)"]
        iOSApp["iOS (Swift)"]
        AndroidApp["Android (Kotlin)"]
    end
```
