[English](./README.md) | [中文](./README.zh-CN.md)

# EnClaws — 企业级 数字AI员工的容器化平台

<p align="center">
  <img src="./docs/assets/banner-enclaws-placeholder.png" alt="EnClaws 横幅占位图" width="100%" />
</p>

<p align="center">
  <strong>让 AI 助理从一个人的工具，变成一个企业的生产力。</strong>
</p>

<p align="center">
  <a href="https://github.com/hashSTACS-Global/EnClaws/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/hashSTACS-Global/EnClaws?style=social"></a>
  <a href="https://github.com/hashSTACS-Global/EnClaws/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/hashSTACS-Global/EnClaws"></a>
  <a href="./LICENSE"><img alt="Apache-2.0 license" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a>
  ·
  <a href="#核心亮点">核心亮点</a>
  ·
  <a href="#工作原理概览">工作原理</a>
  ·
  <a href="#社区">社区</a>
  ·
  <a href="#许可证">许可证</a>
  ·
  <a href="#商标">商标</a>
</p>

**EnClaws** 是一个**企业级 数字AI员工的容器化平台**，专为大规模创建、调度、隔离、升级和审计多名数字AI员工而设计，覆盖团队协作、业务流程和企业运营等场景。

OpenClaw 专注于个人助理体验，而 EnClaws 则聚焦于数字AI员工的**企业容器化平台**。

> [!IMPORTANT]
> 本仓库刚刚开源。随着项目推进，部署指南、配置说明和技术文档将陆续发布。

## 为什么需要 EnClaws

个人助理可以让一个人变得更强，但企业对数字AI员工有完全不同的需求。

企业需要的是：

- 数字AI员工可以支持高并发和同时支持处理多个用户的工作请求，对比openClaw只能串行的支持一个用户的请求
- 数字AI员工可以支持企业、部门、用户之间清晰的权限边界，对比openClaw只能服务一个用户，没有企业、部门和用户的概念
- 数字AI员工可以支持敏感上下文和数据的严格隔离，这是一个agent同时服务多个用户所必须的。对比openClaw由于它只服务一个用户，没有这个需求
- 数字AI员工可以支持行业、公司、部门、个人多层级的记忆体系，对比openClaw仅有个人的记忆
- 数字AI员工可以支持可复用的技能，能在多个数字AI员工之间流转和共享
- 面向管理层的状态、风险、成本、回溯和审计能力
- 一个能管理大规模数字AI员工的平台，而不是单一的聊天窗口

简而言之，企业不只需要一个更聪明的助理，而是需要一套能够运行和治理数字AI员工的系统。

## 从 OpenClaw 到 EnClaws

在 Claw 体系中，分工非常清晰：

- **OpenClaw** 是个人版 Claw，围绕单个用户的助理体验而构建。
- **EnClaws** 是企业版 Claw，专为大规模创建、调度和管理数字AI员工而构建，让它们能够承接组织中的实际工作。

如果说 OpenClaw 是个人操作员，那么 EnClaws 就是企业数字AI员工的操作系统。

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

# 3. 注册 enclaws 全局命令
npm link

# 4. 启动 Gateway
enclaws gateway
```

启动完成后，Gateway 默认可通过 `http://localhost:18789` 访问。

<p align="center">
  <img src="./docs/assets/dashboard-enclaws-placeholder.jpg" alt="EnClaws 仪表盘占位图" width="92%" />
</p>

## 核心亮点

- **单助理，多任务并发**
  EnClaws 天然支持并发执行。例如，一个财务数字AI员工应当能够同时处理多名员工的报销申请，而非让所有人排成一条队。

- **原生多用户隔离**
  平台从设计之初就面向多用户场景，每个用户拥有独立的上下文、记忆和执行边界。

- **层级化记忆体系**
  企业数字AI员工可以同时调用多个层次的知识：行业记忆、公司记忆、部门记忆和个人记忆。

- **记忆蒸馏与升级**
  有价值的经验不应沉没在原始日志中。它可以被捕获、提炼为可复用的能力制品，经审核后向上层级传播。

- **技能共享与传播**
  一个数字AI员工掌握的优秀技能不应被锁死在一个实例中。EnClaws 支持技能的暴露、共享和跨助理传播。

- **审计与状态监控**
  管理者需要可见性。EnClaws 旨在呈现数字AI员工状态、任务执行情况、Token 消耗与成本信号、风险信号，以及可回溯的证据链。

- **A2A 协作（路线图方向）**
  轻量级的助理间协作是 EnClaws 的未来方向之一，重点在于降低 Token 开销、提升数据交换效率。

## 核心能力模型

### 1）单助理，多任务并发

与传统串行助理不同——它必须完成一条指令才能处理下一条——EnClaws 从设计上支持并发任务执行。

这对企业工作负载至关重要。一个财务数字AI员工应该能够同时处理多笔报销请求，而不是让每位员工在同一个数字队列中等待。

设计目标不仅是速度，更是在持续的多用户负载下，保持稳定、响应迅速的企业级服务行为。

### 2）原生多用户模式

EnClaws 从一开始就为多用户运行而构建。

这意味着：

- 运行时能够区分不同用户和执行上下文
- 每个用户拥有独立的记忆和个性化行为
- 敏感信息被严格隔离，防止在人员、团队或部门之间泄露

这不仅仅是便利性问题，更是运营安全的保障。

### 3）层级化记忆管理

企业工作很少能被一个扁平的上下文窗口所容纳。

EnClaws 围绕分层记忆模型设计，让助理能够同时运用多种类型的知识：

- **行业记忆**：公共规则、术语和法规
- **公司记忆**：商业模式、政策、文化和共享的产品知识
- **部门记忆**：工作手册、流程规范和协作规则
- **个人记忆**：个人习惯、偏好和历史上下文

这不是一个混杂的大脑，而是结构化的组织记忆。

### 4）记忆蒸馏与升级

EnClaws 不会盲目地将原始记忆同步到所有地方。

相反，目标是识别有价值的经验，将其提炼为可复用的能力制品，经过脱敏和合规审查后，从个人或团队层级向上推广至部门或公司层级。

这使得学习转化为组织进化，而非重复劳动。

### 5）技能共享与自动传播

一个优秀的企业平台应当让能力自由流动。

EnClaws 围绕标准化的技能共享模型设计，一个在某个数字AI员工上被证明有效的技能，可以被暴露、复用并传播到其他助理。

一个数字AI员工学到的有用技能，应当让整个系统受益。

### 6）审计与状态监控

数字AI员工的能力越强，可观测性就越重要。

EnClaws 旨在为管理层提供以下可见性：

- 数字AI员工状态
- 已执行的指令
- 风险信号
- Token 消耗与成本透视
- 可回溯的流程、证据和责任链

这是让数字AI员工从"黑箱"变为"可治理"的关键。

### 7）助理间协作（路线图方向）

A2A 协作是 EnClaws 的未来发展方向之一。

目标是建立一种轻量级的容器间协作模型，让大量协调指令可以通过直接的协议交换完成，而非反复经过完整的模型推理。

这意味着：

- 更低的 Token 消耗
- 更高效的共享数据流
- 多数字AI员工协作更像一个协调有序的团队

这属于路线图规划，是发展方向，而非首日即交付的承诺。

## 工作原理概览

```text
用户 / 团队 / 企业系统
         │
         ▼
  数字AI员工运行时 + 控制平面
         │
    ┌────┼────┬────┐
    ▼    ▼    ▼    ▼
  并发  记忆  技能  审计
         │
         ▼
   Web 管理面板与企业管理界面
```

更详细的架构示意：

```text
企业用户 + 业务系统 + 工作事件
              │
              ▼
    容器化数字AI员工运行时与调度器
              │
      ┌───────┼───────┬───────┐
      ▼       ▼       ▼       ▼
    隔离     记忆    技能    监控
              │
              ▼
     证据、回溯、运营、执行
```

## 北极星

EnClaws 的目标不只是做一个更炫酷的 AI 玩具。

也不是做一个只有少数架构师才能理解的抽象底层。

它的北极星是逐步将**企业的运营方式**转变为一个**开放、协作、可持续进化的 数字AI员工的底座和操作系统**。

## 加入我们

EnClaws 致力于为企业真实业务流程中的 数字AI员工 应用定义基础层。

如果你希望 数字AI员工 从演示走向实际业务运营：

- 为本仓库点个 Star
- 提交 Issue，描述你在实际运营中遇到的具体需求
- 参与技能规范和运行时架构的讨论
- 一起让企业 数字AI员工 更可复现、更可治理、更可共享

## 致谢

EnClaws 站在开源巨人的肩膀上。我们由衷感谢：

- **[openclaw/openclaw](https://github.com/openclaw/openclaw)**
  奠定了优秀数字助理范式的个人助理基础项目。EnClaws 在此基础上，将思路延伸至企业级容器化运营。

- **[luolin-ai/openclawWeComzh](https://github.com/luolin-ai/openclawWeComzh)**
  在企业微信适配和多租户企业 IM 集成层方面提供了宝贵的参考。

我们始终秉持开放契约精神，与开源社区共同推进企业 AI 运行时标准。

## 社区

- 贡献指南请参阅 **[CONTRIBUTING.md](./CONTRIBUTING.md)**
- 项目治理与维护者职责请参阅 **[GOVERNANCE.md](./GOVERNANCE.md)**
- 社区行为准则请参阅 **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)**
- 安全漏洞报告请参阅 **[SECURITY.md](./SECURITY.md)**
- 品牌使用规则请参阅 **[TRADEMARK.md](./TRADEMARK.md)**

## 许可证

本项目基于 **Apache License 2.0** 许可。详见 **[LICENSE](./LICENSE)**。

## 商标

源代码以 Apache License 2.0 开源，但项目名称、Logo 和品牌标识为保留权利。

Apache License 2.0 **不**授予商标使用权。允许和禁止的品牌使用方式请参阅 **[TRADEMARK.md](./TRADEMARK.md)**。

---

<!--
本 README 当前使用的资源占位文件：

- ./docs/assets/banner-enclaws-placeholder.png
- ./docs/assets/dashboard-enclaws-placeholder.jpg

待正式视觉素材就绪后，直接替换上述文件即可保持 README 布局不变。
-->
