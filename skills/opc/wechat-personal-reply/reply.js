'use strict';
/**
 * wechat-personal-reply: 以老板本人身份发送个人微信回复
 *
 * MVP STATUS: 接口 stub。底座同 wechat-personal-fetch，待选型。
 */

function parseArgs() {
  const argv = process.argv.slice(2);
  const r = {
    account: null,
    identityTokenRef: null,
    conversationId: null,
    conversationType: null,
    replyToMessageId: null,
    contentType: 'text',
    content: null,
    mediaPath: null,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--account':              r.account           = argv[++i]; break;
      case '--identity-token-ref':   r.identityTokenRef  = argv[++i]; break;
      case '--conversation-id':      r.conversationId    = argv[++i]; break;
      case '--conversation-type':    r.conversationType  = argv[++i]; break;
      case '--reply-to-message-id':  r.replyToMessageId  = argv[++i]; break;
      case '--content-type':         r.contentType       = argv[++i]; break;
      case '--content':              r.content           = argv[++i]; break;
      case '--media-path':           r.mediaPath         = argv[++i]; break;
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
  if (!args.conversationId)   return out({ ok: false, error: 'conversation-id required' }, 2);
  if (!args.conversationType) return out({ ok: false, error: 'conversation-type required' }, 2);

  const ct = args.contentType;
  if (ct === 'text' && !args.content) {
    return out({ ok: false, error: 'content required for text' }, 2);
  }
  if ((ct === 'image' || ct === 'file') && !args.mediaPath) {
    return out({ ok: false, error: 'media-path required for image/file' }, 2);
  }

  out({
    ok: false,
    error: 'NOT_IMPLEMENTED',
    message: '个人微信无官方 API。底座同 wechat-personal-fetch，待选型。',
    contract: {
      input: {
        conversationId: args.conversationId,
        conversationType: args.conversationType,
        contentType: args.contentType,
      },
      expectedOutput: {
        ok: true,
        sent_at: '<ISO>',
        message_id: '...',
      },
    },
  }, 1);
}

main();
