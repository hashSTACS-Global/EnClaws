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
];
