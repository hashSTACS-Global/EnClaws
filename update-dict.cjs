const fs = require("fs");

const dictPath = "scripts/swift-translations.json";
const dict = JSON.parse(fs.readFileSync(dictPath, "utf8"));

Object.assign(dict, {
  "Install OpenClaw CLI?": "安装 OpenClaw CLI 运行环境？",
  "Local mode needs the CLI so launchd can run the gateway.":
    "本地模式依赖 CLI（命令行组件），以便通过 launchd 启动网关服务。",
  "Install CLI": "安装 CLI 环境",
  "Not now": "暂不安装",
  "Open Settings": "打开通用设置",
  "CLI install finished": "CLI 命令行安装完成",
  GitHub: "GitHub 源码",
  Website: "官网",
  Twitter: "Twitter 推特",
  Email: "Email 邮件联系",
  "Updates unavailable in this build.": "当前编译版本不支持自动获取新组件更新。",
});

const sortedKeys = Object.keys(dict).toSorted();
const sortedDict = {};
for (const key of sortedKeys) {
  sortedDict[key] = dict[key];
}

fs.writeFileSync(dictPath, JSON.stringify(sortedDict, null, 2) + "\n");
