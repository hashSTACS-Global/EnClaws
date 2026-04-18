/**
 * Blocked input patterns — inlined as a TS constant so it survives bundling (tsdown).
 * Source of truth: keep this file in sync with any external pattern list.
 *
 * One regex string per entry (case-insensitive matching applied at runtime).
 */

export const BLOCKED_PATTERN_SOURCES: readonly string[] = [

  // ── File deletion & overwrite ──
  "rm\\s+-rf",
  "rm\\s+-f",
  "rm\\s+-r",
  "\\brmdir\\b",
  "\\bunlink\\b",
  "\\bshred\\b",
  ">\\s*\\/dev\\/sda",
  "\\bdd\\s+if=",
  "\\bmkfs\\b",
  "\\bmkfs\\.ext4\\b",
  "\\bmkfs\\.xfs\\b",
  "\\bwipefs\\b",
  "\\btruncate\\b",
  "\\bmv\\s+\\/\\*",
  "\\bcp\\s+\\/dev\\/null\\b",

  // ── System control & service management ──
  "\\bshutdown\\b",
  "\\breboot\\b",
  "\\bpoweroff\\b",
  "\\bhalt\\b",
  "\\binit\\s+[06]\\b",
  // restart + system-level target (English)
  "\\brestart\\s+(system|linux|server|machine|host|os|kernel|wsl|vm|vps|node)\\b",
  "\\bstop\\s+(system|linux|server|machine|host|os|kernel|wsl|vm|vps|node)\\b",
  "\\bsystemctl\\s+stop\\b",
  "\\bsystemctl\\s+disable\\b",
  "\\bsystemctl\\s+restart\\b",
  "\\bsystemctl\\s+mask\\b",
  "\\bservice\\s+\\S+\\s+stop\\b",
  "\\bnginx\\s+-s\\s+(stop|quit)\\b",
  "\\bkill\\s+-9",
  "\\bkill\\b",
  "\\bkillall\\b",
  "\\bpkill\\b",
  "\\bxkill\\b",

  // ── User & permission management ──
  "\\buseradd\\b",
  "\\buserdel\\b",
  "\\busermod\\b",
  "\\bgroupadd\\b",
  "\\bgroupdel\\b",
  "\\bpasswd\\b",
  "\\bchpasswd\\b",
  "\\bchmod\\s+777\\b",
  "\\bchmod\\s+-R\\b",
  "\\bchown\\s+-R\\b",
  "\\bchgrp\\s+-R\\b",
  "\\bsudo\\b",
  "\\bsu\\s+-",
  "\\bvisudo\\b",
  "\\bsetfacl\\b",

  // ── Network & firewall ──
  "\\biptables\\s+-[FXD]\\b",
  "\\biptables\\s+-P\\s+\\S+\\s+DROP\\b",
  "\\bfirewalld\\b",
  "\\bfirewall-cmd\\b",
  "\\bufw\\s+(disable|allow)\\b",
  "\\bnft\\s+flush\\b",
  "\\broute\\s+(add|del)\\b",
  "\\bip\\s+route\\b",
  "\\bip\\s+link\\s+set\\s+\\S+\\s+down\\b",
  "\\bifdown\\b",
  "\\bifconfig\\s+\\S+\\s+down\\b",
  "\\bnmcli\\s+connection\\s+delete\\b",
  "\\bhostnamectl\\b",
  "\\bnc\\s+-l",
  "\\bncat\\b",
  "\\bsocat\\b",

  // ── SSH & remote access ──
  "\\bssh-keygen\\b",
  "\\bssh-copy-id\\b",
  "\\bsshd\\b",
  "authorized_keys",
  "\\/etc\\/ssh\\/sshd_config",

  // ── Sensitive file access ──
  "\\/etc\\/shadow",
  "\\/etc\\/passwd",
  "\\/etc\\/sudoers",
  "\\/etc\\/crontab",
  "\\.env\\b",
  "\\.ssh\\/",
  "\\.bash_history",
  "\\.git-credentials",
  "\\bid_rsa\\b",
  "\\.pem\\b",
  "\\.key\\b",
  "\\/proc\\/",
  "\\/sys\\/",

  // ── Scheduled tasks & autostart ──
  "\\bcrontab\\s+-[er]\\b",
  "\\/etc\\/cron\\.d\\/",
  "\\/etc\\/init\\.d\\/",
  "\\/etc\\/systemd\\/system\\/",
  "\\bat\\b\\s+",
  "\\bbatch\\b",

  // ── Dangerous shell tricks & bypasses ──
  ":\\(\\)\\{\\s*:\\|:&\\s*\\};:",
  "\\/dev\\/tcp\\/",
  "\\/dev\\/udp\\/",
  "\\beval\\b",
  "\\bexec\\b",
  "\\bsource\\b",
  "\\bnohup\\b",
  "\\bdisown\\b",
  "\\bscreen\\b",
  "\\btmux\\b",
  "base64\\s+-d\\s*\\|\\s*bash",
  "\\bpython\\s+-c\\b",
  "\\bperl\\s+-e\\b",
  "\\bruby\\s+-e\\b",
  "\\bphp\\s+-r\\b",
  "\\blua\\s+-e\\b",
  "\\bnode\\s+-e\\b",
  "\\bcurl\\b.*\\|\\s*bash",
  "\\bwget\\b.*\\|\\s*sh",
  "\\bcurl\\b.*\\|\\s*sh",

  // ── Destructive operations (UX-level guard — Chinese + English) ──
  // NOTE: This is a UX-level filter only, not a security boundary.
  //       Rephrased or differently-cased requests may bypass these patterns.
  //       True security boundary = PathPermissionPolicy + exec tenant guard + P2 exec denylist.
  //       Value here: catch obvious stated intent and surface a clear refusal message.

  // ── Reset / wipe (Chinese) — require destructive context to avoid false positives ──
  // ❌ DO NOT use bare "帮.*重置" — matches "帮我重置一下对话风格" (false positive)
  "清空.*记忆|清除.*记忆",
  "清空.*用户数据|清除.*用户数据",
  "重置.*系统|重置.*实例|重置.*租户|重置.*服务器",
  "帮.*重置.*(系统|实例|配置|服务|租户|数据|密码|token)",
  "帮.*清空.*(数据|记录|历史|日志|用户|租户)",
  "帮.*清除.*(数据|记录|历史|日志|用户)",
  "完全重置|全量清空",

  // ── Power / service control (Chinese) ──
  "关机|关闭系统|关闭服务器",
  "重启系统|重启服务器|重启linux|重启server|重启wsl|重启主机|重启机器|重启节点",
  "重启.*(linux|server|wsl|system|host|os|kernel|vm|vps|node)",
  "停止.*服务|关闭.*服务",
  "重启.*服务|禁用.*服务",
  "杀.*进程|杀死.*进程|终止.*进程",

  // ── Protected config files (Chinese) ──
  // USER.md / MEMORY.md / AGENT*.md — clearing intent
  "把.*USER\\.md.*删|把.*USER\\.md.*清|USER\\.md.*全部删|USER\\.md.*清空|USER\\.md.*清除",
  "把.*MEMORY\\.md.*删|把.*MEMORY\\.md.*清|MEMORY\\.md.*全部删|MEMORY\\.md.*清空",
  "把.*AGENT.*\\.md.*删|把.*AGENT.*\\.md.*清",

  // ── EnClaws / Gateway service control (Chinese) ──
  "重启.*enclaws|启动.*enclaws|停止.*enclaws|关闭.*enclaws|杀.*enclaws",
  "重启.*gateway|启动.*gateway|停止.*gateway|关闭.*gateway",

  // ── State directory / database file (Chinese) ──
  "删除.*enclaws|清空.*enclaws|重置.*enclaws",
  "删除.*\\.enclaws|清空.*\\.enclaws",
  "删除.*\\.db\\b|清空.*\\.db\\b|覆盖.*\\.db\\b",

  // ── Data destruction (Chinese) ──
  "删除.*数据库|清空.*数据库",
  "删除.*表|drop.*table|truncate.*table",
  "删除.*token|清空.*token|删除.*密钥|删除.*api.*key",
  "清空.*凭证|删除.*凭证|重置.*密码",
  "删除.*agent|删除.*助手|删除.*机器人",
  "批量删除|全部删除|删除所有",
  "清空.*历史|删除.*记录|清除.*日志",
  "删除.*管理员|删除.*admin",
  "修改.*权限|提权",
  "格式化|清空.*磁盘",
  "断网|关闭.*防火墙",

  // ── Protected config files (English) ──
  "\\b(?:clear|delete|wipe|empty|erase)\\b.*USER\\.md",
  "\\b(?:clear|delete|wipe|empty|erase)\\b.*MEMORY\\.md",
  "\\b(?:clear|delete|wipe|empty|erase)\\b.*AGENT.*\\.md",

  // ── EnClaws / Gateway service control (English) ──
  "\\brestart\\b.*enclaws|\\bstart\\b.*enclaws|\\bstop\\b.*enclaws|\\bkill\\b.*enclaws",
  "\\brestart\\b.*gateway|\\bstart\\b.*gateway|\\bstop\\b.*gateway|\\bkill\\b.*gateway",

  // ── State directory / database file (English) ──
  "\\bdelete\\b.*enclaws|\\bremove\\b.*enclaws|\\bdrop\\b.*enclaws",
  "\\bdelete\\b.*\\.db\\b|\\bremove\\b.*\\.db\\b|\\berase\\b.*\\.db\\b",

  // ── English destructive operations ──
  "\\bdelete\\s+(user|tenant|agent|database|admin)\\b",
  "\\bremove\\s+(user|tenant|agent)\\b",
  "\\bwipe\\s+(data|tenant|user|system|database)\\b",
  "\\bdrop\\s+(database|table|schema)\\b",
  "\\btruncate\\s+(table|database)\\b",
  "\\bformat\\s+(disk|drive|volume)\\b",
  "\\breset\\s+(system|instance|tenant|server)\\b",
  "\\bclear\\s+(all\\s+)?(data|users|tenants|history|logs)\\b",
  "\\bpurge\\s+(data|users|tenants|logs)\\b",
  "\\bnuke\\s+(data|tenant|system)\\b",

  // ── EnClaws resource mutation (Chinese) — tenant/agent/channel/user/config ──
  // NOTE: UX-level filter only — true boundary lives in RBAC + gateway exec denylist.
  //       Do not duplicate rules already covered above (e.g. "删除.*agent|助手|机器人").

  // Tenant 租户
  "新增.*(租户|tenant|工作空间|workspace)",
  "添加.*(租户|tenant|工作空间|workspace)",
  "创建.*(租户|tenant|工作空间|workspace)",
  "开通.*(租户|tenant)",
  "删除.*(租户|tenant|工作空间|workspace)",
  "移除.*(租户|tenant|工作空间|workspace)",
  "停用.*(租户|tenant)",
  "禁用.*(租户|tenant)",
  "冻结.*(租户|tenant|用户)",
  "暂停.*(租户|tenant)",
  "恢复.*(租户|tenant)",
  "注销.*(租户|tenant)",
  "修改.*(租户|tenant).*(配额|quota|plan|套餐|limit|限额)",
  "切换.*(租户|tenant).*(plan|套餐)",
  "升级.*(租户|tenant).*(plan|套餐|权限)",

  // User 用户 / 管理员
  "新增.*(用户|user|管理员|admin|owner)",
  "添加.*(用户|user|管理员|admin)",
  "创建.*(用户|user|管理员|admin)",
  "邀请.*(用户|user|管理员|admin).*加入",
  "移除.*(用户|user|成员|member)",
  "踢出.*(用户|user|成员|member)",
  "停用.*(用户|user|账号|账户)",
  "禁用.*(用户|user|账号|账户)",
  "冻结.*(账号|账户)",
  "提升.*(用户|user).*(权限|管理员|admin|owner|角色)",
  "(提升|升级|晋升).*(为|到|成).*(管理员|admin|owner|超管|root|超级权限)",
  "降级.*(用户|user).*(权限|角色)",
  "修改.*(用户|user|账号).*(角色|role|权限|permission)",
  "赋予.*(admin|管理员|owner|超级权限|root)",

  // Agent (生命周期 — 补充，已存在 "删除.*agent|助手|机器人")
  "新增.*(agent|助手|机器人|智能体|员工|ai\\s*employee|ai\\s*员工|数字员工)",
  "添加.*(agent|助手|机器人|智能体|员工|ai\\s*employee|数字员工)",
  "创建.*(agent|助手|机器人|智能体|员工|ai\\s*employee|数字员工)",
  "部署.*(agent|助手|机器人|智能体)",
  "复制.*(agent|助手|机器人).*(到|给)",
  "修改.*(agent|助手|机器人|智能体).*(配置|模型|provider|system\\s*prompt|提示词|工具|skill|技能)",
  "更改.*(agent|助手).*(模型|model)",
  "切换.*(agent|助手).*(模型|provider|厂商)",
  "替换.*(agent|助手).*(system\\s*prompt|提示词|角色)",
  "停用.*(agent|助手|机器人|智能体)",
  "禁用.*(agent|助手|机器人|智能体)",
  "下线.*(agent|助手|机器人)",
  "注销.*(agent|助手|机器人|智能体)",

  // Channel 渠道 / 频道 / 通道
  "新增.*(channel|频道|渠道|通道)",
  "添加.*(channel|频道|渠道|通道)",
  "创建.*(channel|频道|渠道|通道)",
  "接入.*(channel|频道|渠道|telegram|discord|slack|signal|imessage|飞书|微信|钉钉|lark|whatsapp)",
  "绑定.*(channel|频道|telegram|discord|slack|飞书|微信|钉钉|lark|whatsapp)",
  "开通.*(channel|频道|渠道)",
  "删除.*(channel|频道|渠道|通道)",
  "移除.*(channel|频道|渠道)",
  "解绑.*(channel|频道|telegram|discord|slack|飞书|微信|钉钉|lark|whatsapp)",
  "下线.*(channel|频道|渠道)",
  "停用.*(channel|频道|渠道)",
  "禁用.*(channel|频道)",
  "注销.*(channel|频道)",
  "修改.*(channel|频道|渠道).*(配置|设置|token|密钥|webhook|bot\\s*token|appid|secret)",
  "改.*(channel|频道).*(token|密钥|webhook|bot\\s*token)",
  "更新.*(channel|频道).*(token|凭证|webhook|密钥)",
  "轮换.*(token|密钥|webhook|密码)",

  // 配置文件（settings / enclaws.json / .env / hooks / allowlist）
  "修改.*(配置|设置|配置文件|settings|config)",
  "更改.*(配置|设置|配置文件)",
  "更新.*(配置|设置|配置文件)",
  "编辑.*(配置|设置|配置文件|settings\\.json|\\.env|claude\\.json|enclaws\\.json)",
  "调整.*(配置|权限|allowlist|白名单|黑名单|denylist)",
  "改.*(settings\\.json|\\.env|claude\\.json|enclaws\\.json|hooks|权限|allowlist)",
  "写入.*(配置|配置文件|settings\\.json|\\.env|enclaws\\.json)",
  "覆盖.*(配置|配置文件|settings\\.json|\\.env|enclaws\\.json)",
  "替换.*(配置|配置文件|enclaws\\.json)",
  "增加.*(配置|设置|权限|白名单|allowlist|hook|钩子|环境变量|env\\s*变量)",
  "新增.*(配置|设置|权限|白名单|allowlist|hook|钩子)",
  "添加.*(配置|权限|allowlist|白名单|hook|钩子|环境变量|env\\s*变量)",
  "追加.*(配置|权限|allowlist|hook)",
  "注入.*(配置|hook|钩子|环境变量)",
  "删除.*(配置|设置|配置文件|权限|白名单|allowlist|hook|钩子|环境变量)",
  "移除.*(配置|权限|allowlist|白名单|hook|钩子)",
  "清空.*(配置|设置|配置文件|权限|白名单|allowlist|hook)",
  "清除.*(配置|设置|权限|allowlist|hook)",
  "重置.*(配置|设置|配置文件|权限|allowlist|hook)",
  "还原.*(配置|设置).*默认",
  "去掉.*(权限校验|权限检查|审批|approval|denylist|白名单)",
  "关闭.*(权限校验|审批|approval|hook|钩子|denylist)",
  "禁用.*(权限校验|审批|hook|钩子|denylist|拦截)",
  "绕过.*(权限|审批|approval|hook|denylist|拦截|过滤)",

  // 具体文件名
  "修改.*\\.claude.*settings",
  "修改.*claude\\.json|编辑.*claude\\.json|写.*claude\\.json",
  "修改.*enclaws\\.json|编辑.*enclaws\\.json|写.*enclaws\\.json|覆盖.*enclaws\\.json|替换.*enclaws\\.json",
  "新增.*enclaws\\.json|添加.*enclaws\\.json|追加.*enclaws\\.json",
  "删除.*enclaws\\.json|清空.*enclaws\\.json|重置.*enclaws\\.json|移除.*enclaws\\.json",
  "修改.*\\.mcp\\.json|编辑.*\\.mcp\\.json",
  "修改.*hooks(\\.json)?|编辑.*hooks(\\.json)?",
  "修改.*\\.env|编辑.*\\.env|覆盖.*\\.env",
  "修改.*package\\.json.*scripts|改.*package\\.json.*scripts",
  "修改.*exec-approvals|编辑.*exec-approvals|覆盖.*exec-approvals",

  // ── EnClaws resource mutation (English) ──
  "\\b(create|add|register|onboard|provision)\\s+(?:a\\s+)?(tenant|workspace|organization|org)\\b",
  "\\b(delete|remove|drop|disable|suspend|freeze|offboard|deprovision)\\s+(?:a\\s+)?(tenant|workspace|organization|org)\\b",
  "\\b(upgrade|downgrade|switch)\\s+(?:the\\s+)?(tenant|workspace)\\s+(plan|quota|tier)\\b",
  "\\b(create|add|invite|register|promote|grant)\\s+(?:a\\s+)?(user|member|admin|owner|root)\\b",
  "\\b(demote|revoke|ban|kick|deactivate|suspend)\\s+(?:the\\s+)?(user|member|admin|owner)\\b",
  "\\b(add|create|register|deploy|spawn|provision|install)\\s+(?:a\\s+)?(agent|assistant|bot|ai\\s*employee|digital\\s*employee)\\b",
  "\\b(modify|change|swap|switch|replace)\\s+(?:the\\s+)?(agent|assistant)\\s+(model|provider|system\\s*prompt|tool|skill|persona)\\b",
  "\\b(disable|offboard|tear\\s*down|unregister|deprecate)\\s+(?:the\\s+)?(agent|assistant|bot|ai\\s*employee)\\b",
  "\\b(add|create|register|onboard|provision|connect|bind|link)\\s+(?:a\\s+)?(channel|telegram|discord|slack|signal|imessage|lark|feishu|wechat|dingtalk|whatsapp)\\b",
  "\\b(delete|remove|drop|disable|unregister|unbind|disconnect|offboard|tear\\s*down)\\s+(?:the\\s+)?(channel|agent|assistant|bot|ai\\s*employee)\\b",
  "\\b(modify|edit|update|change|rotate|replace)\\s+(?:the\\s+)?(channel\\s+)?(token|secret|credential|webhook|bot\\s*token|app\\s*id|api\\s*key)\\b",
  "\\b(modify|edit|update|change|overwrite|replace|patch)\\b.*\\b(config|configuration|settings|settings\\.json|claude\\.json|enclaws\\.json|\\.env|hooks|allowlist|denylist|permissions?)\\b",
  "\\b(add|append|insert|inject)\\b.*\\b(config|setting|permission|allowlist|hook|env\\s*var|environment\\s*variable)\\b",
  "\\b(delete|remove|drop|clear|wipe|reset|purge)\\b.*\\b(config|configuration|settings|permission|allowlist|denylist|hook|env\\s*var)\\b",
  "\\b(disable|bypass|turn\\s*off|skip)\\b.*\\b(approval|permission\\s*check|hook|denylist|filter|guard|rbac)\\b",
  "\\bwrite\\b.*\\b(\\.env|settings\\.json|claude\\.json|enclaws\\.json|\\.mcp\\.json|hooks\\.json)\\b",
  "\\b(modify|edit|update|change|overwrite|replace|patch|add|append|insert|delete|remove|reset|clear)\\b.*\\benclaws\\.json\\b",

  // ── Restricted chat commands ──
  "^\\/restart\\b",
  "^\\/bash\\b",
  "^!\\s+",
  "^\\/config\\s+set\\b",
  "^\\/config\\s+unset\\b",
  "^\\/debug\\s+set\\b",
  "^\\/debug\\s+reset\\b",
  "^\\/mcp\\s+set\\b",
  "^\\/mcp\\s+unset\\b",
  "^\\/plugins\\s+install\\b",
  "^\\/plugins\\s+enable\\b",
  "^\\/plugins\\s+disable\\b",
  "^\\/kill\\s+all\\b",
  "^\\/allowlist\\s+add\\b",
  "^\\/allowlist\\s+remove\\b",
  "^\\/exec\\b",
  "^\\/elevated\\b",
  "^\\/settings\\s+(set|unset|reset|edit)\\b",
  "^\\/permissions\\s+(add|remove|set|reset)\\b",
  "^\\/hooks\\s+(add|remove|set|reset|edit)\\b",
  "^\\/env\\s+(set|unset)\\b",
  "^\\/tenant\\s+(add|create|remove|delete|suspend|resume|freeze|disable|enable)\\b",
  "^\\/tenants?\\s+(add|create|remove|delete)\\b",
  "^\\/user\\s+(add|create|invite|remove|delete|promote|demote|ban|kick)\\b",
  "^\\/users?\\s+(add|create|remove|delete)\\b",
  "^\\/agent\\s+(add|create|remove|delete|disable|enable)\\b",
  "^\\/agents?\\s+(add|create|remove|delete)\\b",
  "^\\/channel\\s+(add|create|remove|delete|disable|enable|bind|unbind)\\b",
  "^\\/channels?\\s+(add|create|remove|delete)\\b",
  "^\\/bot\\s+(add|create|register|remove)\\b",
];
