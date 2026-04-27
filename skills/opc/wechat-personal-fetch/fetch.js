'use strict';
/**
 * wechat-personal-fetch: 以老板本人身份拉个人微信消息
 *
 * MVP STATUS: 接口 stub。底座（hook / 第三方协议 / 企微迁移）待选型。
 */

function parseArgs() {
  const argv = process.argv.slice(2);
  const r = {
    account: null,
    identityTokenRef: null,
    sinceCursor: null,
    watchPolicy: 'all',
    watchedConversations: null,
    excludedConversations: null,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--account':                r.account               = argv[++i]; break;
      case '--identity-token-ref':     r.identityTokenRef      = argv[++i]; break;
      case '--since-cursor':           r.sinceCursor           = argv[++i]; break;
      case '--watch-policy':           r.watchPolicy           = argv[++i]; break;
      case '--watched-conversations':  r.watchedConversations  = argv[++i]; break;
      case '--excluded-conversations': r.excludedConversations = argv[++i]; break;
    }
  }
  return r;
}

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  if (code) process.exit(code);
}

function main() {
  const args = parseArgs();
  if (!args.account)          return out({ ok: false, error: 'account required' }, 2);
  if (!args.identityTokenRef) return out({ ok: false, error: 'identity-token-ref required' }, 2);

  out({
    ok: false,
    error: 'NOT_IMPLEMENTED',
    message: '个人微信无官方 API。EC 底座方案（Windows hook / 第三方协议 / 企微迁移）待选型。',
    contract: {
      input: {
        account: args.account,
        sinceCursor: args.sinceCursor,
        watchPolicy: args.watchPolicy,
      },
      expectedOutput: {
        ok: true,
        account: args.account,
        fetched_at: '<ISO datetime>',
        new_cursor: '<ISO datetime>',
        messages: [{
          id: '...',
          conversation_id: '...',
          conversation_type: 'private|group',
          sender: { id: '...', display_name: '...' },
          content_type: 'text|image|voice|file|link|card',
          content: '...',
          received_at: '<ISO>',
        }],
        count: 0,
      },
    },
    todo: '待选型后填实现：hook 方式本地运行；第三方协议方式远程 API；企微方式走企微外部联系人 API',
  }, 1);
}

main();
