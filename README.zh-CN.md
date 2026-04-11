# EnClaws — 企业级 AI 助手容器平台

<p align="center">
  <img src="https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/docs/assets/banner-enclaws-placeholder.png" alt="EnClaws banner placeholder" width="100%" />
</p>

<p align="center">
  <strong>让 AI 从个人工具，进化为企业级运营能力。</strong>
</p>

<p align="center">
  <a href="https://github.com/hashSTACS-Global/EnClaws/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/hashSTACS-Global/EnClaws?style=social"></a>
  <a href="https://www.npmjs.com/package/enclaws"><img alt="npm version" src="https://img.shields.io/npm/v/enclaws?color=cb3837&label=npm"></a>
  <a href="https://github.com/hashSTACS-Global/EnClaws/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/hashSTACS-Global/EnClaws"></a>
  <a href="https://github.com/hashSTACS-Global/EnClaws/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/hashSTACS-Global/EnClaws"></a>
  <a href="https://discord.gg/ExT4MEnK4w"><img alt="Discord" src="https://img.shields.io/discord/1483754815434526742?color=5865F2&label=Discord&logo=discord&logoColor=white"></a>
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=1b6r1c67-a833-4d36-b748-5e6729d65045"><img alt="飞书" src="https://img.shields.io/badge/%E9%A3%9E%E4%B9%A6-Join%20Group-00D6B9?logo=bytedance&logoColor=white"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D22.12.0-43853d?logo=node.js&logoColor=white">
  <a href="./LICENSE"><img alt="Apache-2.0 许可证" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
</p>

<p align="center">
  <a href="#快速开始-tldr">快速开始</a>
  ·
  <a href="#核心亮点">核心亮点</a>
  ·
  <a href="#工作方式简述">工作方式</a>
  ·
  <a href="#社区">社区</a>
  ·
  <a href="#许可证">许可证</a>
  ·
  <a href="#商标">商标</a>
</p>

**EnClaws** 是一个**企业级 AI 助手容器平台**。它旨在为跨团队、跨流程、跨业务系统的大量助手实例提供创建、调度、隔离、升级与审计能力。

如果说 OpenClaw 关注的是个人助手体验，那么 EnClaws 关注的则是数字助手的企业级运行环境。

> [!IMPORTANT]
> 本仓库刚刚开放。随着项目推进，后续会逐步发布更多部署、配置与仓库文档。

## 为什么需要 EnClaws

个人助手可以为单个人发挥巨大作用，但企业的形态完全不同。

企业需要：

- 团队、部门与用户之间的边界
- 对敏感上下文与数据进行严格隔离
- 能存在于行业、公司、部门和个人多个层级的记忆体系
- 可在大量助手之间复用的技能
- 面向状态、风险、成本、回放与可审计性的管理界面
- 一个能够管理大量数字助手的平台，而不是单一聊天窗口

归根结底，企业需要的不只是更聪明的助手，而是一套能够运行并治理数字劳动力的系统。

## 从 OpenClaw 到 EnClaws

在 Claw 的世界里，这个划分很简单：

- **OpenClaw** 是个人 claw，围绕“属于单个人的单个助手体验”来构建。
- **EnClaws** 是企业 claw，旨在创建、调度和管理大量助手实例，使其能够在组织内部承担真实工作。

如果说 OpenClaw 是个人操作员，那么 EnClaws 就是企业级运行环境。

## 快速开始

### 方式一 — npm 安装（全平台）

```bash
npm install -g enclaws
enclaws gateway
```

### 方式二 — Windows 一键安装包

从 [Releases](https://github.com/hashSTACS-Global/EnClaws/releases) 下载 `EnClaws-Setup-x.x.x.exe`，双击安装即可。无需管理员权限，内置 Node.js 运行时，完全离线安装。

安装后双击桌面快捷方式 "EnClaws" 或在新终端中运行 `enclaws gateway`。

### 方式三 — 一行命令安装（macOS / Linux）

```bash
curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/install.sh | bash
```

### 方式四 — 从源码构建

**前置条件：** 已安装 [Node.js](https://nodejs.org/) >= 22.12.0 及 [pnpm](https://pnpm.io/)。

```bash
# 1. 克隆仓库
git clone https://github.com/hashSTACS-Global/EnClaws.git
cd EnClaws

# 2. 安装依赖并构建
pnpm install
pnpm build
pnpm ui:build # 首次运行时自动安装用户界面依赖项

# 3. 注册 enclaws 全局命令
npm link

# 4. 启动 Gateway
enclaws gateway
```

启动完成后，Gateway 默认可通过 `http://localhost:18888` 访问。

<p align="center">
  <img src="https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/docs/assets/dashboard-enclaws-placeholder.jpg" alt="EnClaws dashboard placeholder" width="92%" />
</p>

## 运维：密码重置

当管理员或用户忘记密码且无法通过页面自助重置时，可通过以下方式恢复访问。

### 方式一：CLI 命令（推荐）

```bash
# 为指定邮箱生成临时密码，用户登录后会被强制修改
pnpm admin:reset-password --email user@example.com

# 多租户环境下同一邮箱存在于多个租户时，需指定租户标识
pnpm admin:reset-password --email user@example.com --tenant my-tenant
```

执行后终端会打印一次性临时密码，用户使用该密码登录后会进入强制改密页面。

### 方式二：环境变量触发（容器化 / 无法执行 CLI 时）

```bash
# 启动时自动重置所有 platform-admin 账户的密码
ENCLAWS_ADMIN_RESET=1 enclaws gateway
```

临时密码会打印到 stdout，启动后请立即移除该环境变量以避免每次重启都重新生成。

### 方式三：页面自助重置（需配置 SMTP）

在 `.env` 中配置邮件服务后，用户可在登录页点击「忘记密码」自助重置：

```bash
ENCLAWS_SMTP_HOST=smtp.example.com
ENCLAWS_SMTP_PORT=465
ENCLAWS_SMTP_SECURE=true
ENCLAWS_SMTP_USER=noreply@example.com
ENCLAWS_SMTP_PASS=your-smtp-password
ENCLAWS_SMTP_FROM=noreply@example.com
ENCLAWS_PUBLIC_BASE_URL=https://your-domain.com
```

> **注意：** 方式一和方式二仅适用于 `platform-admin` 和 `owner` 角色。生成的临时密码仅显示一次，不会被持久化存储。

## 核心亮点

- **一个助手，同时处理多个并发任务**  
  EnClaws 以并发执行为设计目标。财务助手应当能够并行处理多名员工的报销请求，而不是让所有请求排成一条单线程队列。

- **原生多用户隔离**  
  平台从一开始就为多用户环境而设计，为每个用户提供独立的上下文、记忆和执行边界。

- **分层记忆**  
  企业助手可以同时在多个知识层上进行推理：行业记忆、公司记忆、部门记忆以及个人记忆。

- **记忆蒸馏与升级**  
  有价值的经验不应永远被困在原始日志中。它可以被捕获、蒸馏为可复用能力资产，经审查后在适当情况下向上提升。

- **技能共享与传播**  
  某个助手掌握的强技能，不应只停留在这个助手身上。EnClaws 旨在让技能能够在助手之间被暴露、共享和传播。

- **审计与状态监控**  
  管理者需要可见性。EnClaws 旨在呈现助手状态、任务执行情况、Token 成本信号、风险信号以及可回放证据。

- **A2A 协作为路线图方向**  
  轻量级的 assistant-to-assistant 协作，是 EnClaws 的前进方向之一，重点在于更低的 Token 开销与更高效的数据交换。

## 核心能力模型

### 1) 一个助手，同时处理多个并发任务

不同于串行助手必须等待上一条指令完成后才能开始下一条，EnClaws 的设计目标是支持并发任务执行。

这在企业工作负载中至关重要。财务助手应该能够同时处理多笔报销申请，而不是让每位员工都站在同一条数字队列里等待。

设计目标不只是更快，而是在持续多用户负载下依然保持稳定、可响应的企业级服务行为。

### 2) 原生多用户模式

EnClaws 从一开始就是为多用户运行而构建的。

这意味着：

- 运行时能够区分不同用户与执行上下文
- 每个用户都可以拥有独立的记忆与个性化行为
- 敏感信息不会在个人、团队或部门之间串流泄露

重点不只是方便，更是运行安全。

### 3) 分层记忆管理

企业工作很少只属于一个扁平的上下文窗口。

EnClaws 围绕分层记忆模型设计，使助手能够同时处理多种类型的知识：

- **行业记忆**，用于公共规则、术语和监管要求
- **公司记忆**，用于商业模式、制度、文化和共享产品知识
- **部门记忆**，用于作业手册、工作流和协作规则
- **个人记忆**，用于个体习惯、偏好和历史上下文

这不是一个混成一团的巨型大脑，而是结构化的组织记忆。

### 4) 记忆蒸馏与升级

EnClaws 的目标并不是把原始记忆盲目同步到所有地方。

相反，它的目标是识别有价值的经验，将其蒸馏为可复用的能力资产，完成脱敏与合规审查，然后再从个人或团队层级向上提升到部门或公司范围。

这让学习变成组织演化，而不是重复返工。

### 5) 技能共享与自动传播

一个优秀的企业平台，应该让能力能够流动起来。

EnClaws 围绕标准化的技能共享模型来设计，使某个助手中被证明有效的技能，可以被暴露、复用并传播给其他助手。

一个助手学会的有用能力，应该让整个系统都变得更强。

### 6) 审计与状态监控

数字助手越强大，可观测性就越重要。

EnClaws 旨在提供面向管理者的可视化视图，用于呈现：

- 助手状态
- 已执行的指令
- 风险信号
- Token 消耗与成本可见性
- 可回放的流程、证据与责任链

只有这样，数字劳动力才能从“神秘黑箱”变成“可治理系统”。

### 7) 助手协作作为路线图方向

A2A 协作是 EnClaws 的前进方向之一。

目标是构建一种轻量级的容器间协作模型，使大量协同指令可以通过直接协议交换完成，而不必每次都反复经过完整模型解释。

这意味着：

- 更低的 Token 消耗
- 更高效的共享数据流动
- 让多助手协作更像一支协调有序的团队

它被放在路线图部分，是因为这是一个方向，而不是首日上线就夸大的已实现能力。

## 工作方式（简述）

```text
用户 / 团队 / 企业系统
                 │
                 ▼
   助手运行时 + 控制平面
                 │
      ┌──────────┼──────────┬──────────┐
      ▼          ▼          ▼          ▼
   并发执行     记忆      技能库     审计
                 │
                 ▼
      Web 管理面板与企业级接入面
```

更细一层的概念模型：

```text
企业用户 + 业务系统 + 工作事件
                 │
                 ▼
   容器化助手运行时与调度器
                 │
      ┌──────────┼──────────┬──────────┐
      ▼          ▼          ▼          ▼
   租户隔离     记忆      技能      监控告警
                 │
                 ▼
       证据链、回放、操作、行动
```

### 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                             客户端层                                    │
│          Web 控制面板   ·   CLI / TUI   ·   macOS / iOS / Android      │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────┐
│                        通道层 — 20+ 集成                                │
│                                                                         │
│   飞书    钉钉    企业微信    Telegram    Discord    Slack               │
│   WhatsApp    Teams    Matrix    Signal    LINE    Mattermost    ...    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────┐
│                             网关层                                      │
│                                                                         │
│   ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────────┐   │
│   │  WebSocket   │  │    HTTP     │  │       认证与授权              │   │
│   │   服务器     │  │   服务器    │  │   JWT + 五级 RBAC            │   │
│   └──────┬───────┘  └──────┬──────┘  │   方法级权限控制             │   │
│          │                 │         └──────────────┬───────────────┘   │
│          └─────────┬───────┘                        │                   │
│                    │                                │                   │
│   ┌────────────────▼────────────────────────────────▼────────────────┐  │
│   │  租户路由器 ──→ Session 解析器 ──→ 通道管理器                    │  │
│   │  插件管理器                        定时任务服务                   │  │
│   └─────────────────────────────┬───────────────────────────────────┘  │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────┐
│                             核心引擎                                    │
│                                                                         │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐     │
│   │   消息        │  │    回复      │  │    Agent 执行器           │     │
│   │   分发        │  │    引擎      │  │    (pi-embedded-runner)  │     │
│   └──────┬────────┘  └──────┬───────┘  └──────────┬──────────────┘     │
│          │                  │                      │                    │
│          └──────────┬───────┘                      │                    │
│                     │                              │                    │
│   ┌─────────────────▼──────────────────────────────▼─────────────────┐  │
│   │              StreamFn 执行管道                                    │  │
│   │        预处理 → LLM 调用 → 工具执行 → 后处理                     │  │
│   └─────────────────────────────┬────────────────────────────────────┘  │
│                                 │                                      │
│   ┌───────────┐  ┌──────────────▼──┐  ┌─────────────────────────────┐  │
│   │  60+ 工具  │  │  55 个 Skill    │  │  ACP — 并发任务执行器       │  │
│   │            │  │  (可覆盖)       │  │  100+ 任务并行              │  │
│   └────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
┌─────────────▼──────┐ ┌─────────▼─────────┐ ┌───────▼───────────────────┐
│    LLM 提供商       │ │     存储层         │ │       可观测性             │
│                     │ │                    │ │                           │
│  Anthropic Claude   │ │  PostgreSQL        │ │  交互追踪                 │
│  OpenAI GPT-4       │ │   (多租户)         │ │   prompt/completion/成本  │
│  Google Gemini      │ │  SQLite            │ │  审计日志                 │
│  DeepSeek           │ │   (轻量级)         │ │   谁/做了什么/什么时候    │
│  通义千问           │ │  LanceDB           │ │  Token 用量分析           │
│  Moonshot           │ │   (向量记忆)       │ │   7 天/30 天趋势          │
│  Ollama (本地)      │ │  文件系统           │ │   用户/Agent/模型排行     │
│                     │ │   (租户隔离)       │ │                           │
└─────────────────────┘ └────────────────────┘ └───────────────────────────┘
```

### 消息生命周期

```
 用户（飞书 / Discord / ...）
   │
   │  ① 发送消息
   ▼
 通道适配器 ──→ 标准化为内部格式
   │
   │  ② 认证
   ▼
 网关 ──→ JWT 验证 + RBAC 检查
   │
   │  ③ 路由
   ▼
 租户路由器 ──→ 从通道元数据提取租户
   │              从 PostgreSQL 加载租户配置
   │
   │  ④ 分发
   ▼
 Agent 运行时 ──→ 加载 SOUL.md + TOOLS.md + MEMORY.md + Skills
   │
   │  ⑤ 推理
   ▼
 LLM 提供商 ──→ prompt + 上下文 → 流式响应
   │              ↕ 工具调用（执行 → 回传结果 → 再次调用）
   │
   │  ⑥ 回复
   ▼
 通道适配器 ──→ 格式化回复（文本 / 卡片 / 文件 / 图片）
   │
   │  ⑦ 观测
   ▼
 交互追踪器 ──→ 记录 prompt、completion、token 数、成本
 审计日志 ──→ 记录事件（合规留痕）
```

## North Star

EnClaws 想做的，不只是一个更花哨的 AI 玩具。

它也不想只成为一个只有极少数架构师才能理解的抽象底层。

它的 North Star，是逐步把**企业的运作方式**转化为一个**开放、协作、可演化的 AI 系统**。

## 加入我们

EnClaws 的目标，是帮助定义真实企业工作流中的 AI 基础层。

如果你希望 AI 从 Demo 走向业务运营：

- 给仓库点一个 star
- 提交带有具体运营需求的 issue
- 参与 Skill Spec 与运行时相关讨论
- 帮助企业 AI 变得更可复现、可治理、可共享

## 致谢与鸣谢

EnClaws 站在开源巨人的肩膀上。我们在此诚挚感谢：

- **[openclaw/openclaw](https://github.com/openclaw/openclaw)**  
  它作为个人助手基础设施，帮助定义了强有力的数字助手范式。EnClaws 则沿着这条思路，继续向企业级容器化运行拓展。

- **[luolin-ai/openclawWeComzh](https://github.com/luolin-ai/openclawWeComzh)**  
  它为企业微信适配以及多租户企业 IM 集成层提供了有价值的参考。

我们依然致力于秉持开源精神，并与开源社区一起持续推进企业 AI 运行时标准的改进。

## 社区

- 贡献指南请参见 **[CONTRIBUTING.md](./CONTRIBUTING.md)**。
- 项目决策机制与维护者职责请参见 **[GOVERNANCE.md](./GOVERNANCE.md)**。
- 社区行为规范请参见 **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)**。
- 漏洞报告方式请参见 **[SECURITY.md](./SECURITY.md)**。
- 品牌使用规则请参见 **[TRADEMARK.md](./TRADEMARK.md)**。

### 加入 EnClaws 社区

欢迎加入社区，交流版本动态、使用反馈和产品讨论：

- 飞书群: [点击加入](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=1b6r1c67-a833-4d36-b748-5e6729d65045)
- Discord 社区: [点击加入](https://discord.gg/p4Kp5jKAsZ)

<p align="center">
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=2der9793-7a5d-452c-b575-1a1f6bbe540f">
    <img src="https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/docs/assets/community-feishu-qr.jpg" alt="加入 EnClaws 飞书群二维码" width="280" />
  </a>
  <a href="https://discord.gg/ExT4MEnK4w">
    <img src="https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/docs/assets/community-discord-qr.jpg" alt="加入 EnClaws Discord 社区二维码" width="280" />
  </a>
</p>

<p align="center">
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=2der9793-7a5d-452c-b575-1a1f6bbe540f"><strong>加入飞书群</strong></a>
  ·
  <a href="https://discord.gg/ExT4MEnK4w"><strong>加入 Discord 社区</strong></a>
</p>

## 许可证

本项目采用 **Apache License 2.0** 许可证。详见 **[LICENSE](./LICENSE)**。

## 商标

源代码依据 Apache License 2.0 开放，但项目名称、标志和品牌标识均为保留权利内容。

Apache License 2.0 **不授予**商标权。有关允许与禁止的品牌使用方式，请参见 **[TRADEMARK.md](./TRADEMARK.md)**。
