# Feishu Simulator

端到端飞书聊天测试框架。通过飞书 API 以真实用户身份向 Bot 发送消息，等待 Bot 回复并进行断言验证。

## 消息链路

```
User (via Feishu API) → Feishu Server → Lark Plugin → Agent → LLM → Reply → Feishu API (poll)
```

## 前置条件

1. Gateway 运行中，且 Lark 插件已连接
2. 飞书开发者后台已创建应用，并开启以下用户权限：
   - `im:message` — 消息读写
   - `im:message.send_as_user` — 以用户身份发消息
3. 首次运行需在浏览器完成 Device Flow 授权（后续通过 refresh token 自动续期，7 天内无感）

## 运行

```bash
pnpm vitest run test/feishu-simulator/test-case/feishu-chat.test.ts
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TEST_DATA_DIR` | `test-data/` | 测试数据目录（递归加载 `*.json`） |
| `TEST_CSV_OUTPUT` | `test-results/{timestamp}.csv` | CSV 报告输出路径 |
| `TEST_CONCURRENCY` | `2` | 并发执行的测试文件数 |
| `TEST_REPLY_TIMEOUT` | `60000` | 等待 Bot 回复的超时时间（ms） |
| `TEST_POLL_INTERVAL` | `1000` | 轮询回复的间隔（ms） |

## 测试数据格式

每个 JSON 文件定义一个测试场景，包含飞书应用凭据和测试用例列表：

```jsonc
{
  "appId": "cli_xxx",          // 飞书应用 App ID
  "appSecret": "xxx",          // 飞书应用 App Secret
  "userOpenId": "ou_xxx",      // 发送消息的用户 Open ID
  "cases": [
    {
      "name": "基本问候",       // 用例名称（用于日志和报告）
      "message": "你好！"       // 发送给 Bot 的消息
    },
    {
      "name": "文本断言",
      "message": "你是谁？",
      "assert": {               // 可选：对 Bot 回复进行断言
        "contains": "助手",     // 回复必须包含该字符串
        "notContains": "error", // 回复不得包含该字符串
        "matches": "AI|机器人", // 回复必须匹配该正则表达式
        "minLength": 2,         // 回复最小长度
        "maxLength": 500        // 回复最大长度
      }
    },
    {
      "name": "文件导出",
      "message": "把表格导出为Excel",
      "assert": {
        "msgType": "file",             // 断言消息类型
        "hasFile": true,               // 断言包含文件
        "fileNameMatches": "\\.(xlsx|xls|csv)$"   // 断言文件名匹配正则
      }
    },
    {
      "name": "图片生成",
      "message": "画一只猫",
      "assert": {
        "hasImage": true               // 断言包含图片
      }
    }
  ]
}
```

### 字段说明

**顶层字段**

| 字段 | 必填 | 说明 |
|------|------|------|
| `appId` | 是 | 飞书应用的 App ID（`cli_` 开头） |
| `appSecret` | 是 | 飞书应用的 App Secret |
| `userOpenId` | 是 | 模拟发消息的用户 Open ID（`ou_` 开头） |
| `cases` | 是 | 测试用例数组 |

**cases 数组**

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 用例名称 |
| `message` | 是 | 发送给 Bot 的消息文本 |
| `assert` | 否 | 断言规则（省略则仅检查回复非空） |

**assert 对象 — 文本断言**

| 字段 | 类型 | 说明 |
|------|------|------|
| `contains` | `string` | 回复必须包含该子串 |
| `notContains` | `string` | 回复不得包含该子串 |
| `matches` | `string` | 回复必须匹配的正则表达式（如 `"2\|二"`） |
| `minLength` | `number` | 回复文本最小长度 |
| `maxLength` | `number` | 回复文本最大长度 |

**assert 对象 — 消息类型与文件断言**

| 字段 | 类型 | 说明 |
|------|------|------|
| `msgType` | `string` | 断言消息类型（`text`、`file`、`image`、`interactive`、`post`、`audio`、`media`） |
| `hasFile` | `boolean` | 断言回复包含文件（`file_key` 非空） |
| `hasImage` | `boolean` | 断言回复包含图片（`image_key` 非空） |
| `fileNameMatches` | `string` | 断言文件名匹配的正则表达式（如 `"\\.xlsx$"`） |

## 支持的消息类型

| msgType | 提取的 text | 额外元数据 |
|---------|------------|-----------|
| `text` | 消息文本 | — |
| `post` | 富文本中的纯文本 | — |
| `interactive` | CardKit v2 卡片的 summary 或元素文本 | — |
| `file` | 文件名 | `fileKey`、`fileName` |
| `image` | （空） | `imageKey` |
| `media` | 文件名 | `fileKey`、`fileName`、`imageKey` |
| `audio` | （空） | — |

## 目录结构

```
test/feishu-simulator/
├── feishu-client.ts          # 飞书 API 客户端（授权、发消息、轮询回复）
├── types.ts                  # 类型定义
├── test-case/
│   └── feishu-chat.test.ts  # Vitest 测试入口
├── test-data/                # 测试数据（JSON 文件，支持子目录）
│   ├── example.json
│   └── example1.json
├── test-results/             # CSV 测试报告（自动生成）
├── test-runner/
│   ├── index.ts              # 导出入口
│   ├── runner.ts             # 测试执行引擎
│   ├── asserter.ts           # 断言验证
│   ├── file-loader.ts        # JSON 文件加载器
│   └── csv-writer.ts         # CSV 报告生成
└── .token-cache/             # OAuth token 缓存（自动生成，勿提交）
```

## 授权机制

1. **首次运行**：自动发起 Device Flow，终端输出授权链接和 User Code，在浏览器打开链接完成授权
2. **token 有效期内**（~2h）：直接使用缓存的 access_token
3. **access_token 过期**：自动用 refresh_token 刷新（无需人工干预）
4. **refresh_token 过期**（~7d）：重新触发 Device Flow 授权

token 缓存在 `.token-cache/` 目录，按 `{appId}_{userOpenId}.json` 命名。

## CSV 报告

每次运行自动生成 CSV 报告，包含以下列：

| 列 | 说明 |
|----|------|
| File Name | 测试文件名 |
| Case Name | 用例名称 |
| Message Input | 发送的消息 |
| Expected Output | 断言规则描述 |
| Actual Output | Bot 实际回复 |
| Result | PASS / FAIL |
| Duration | 耗时（ms） |
