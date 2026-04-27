'use strict';
/**
 * xiaohongshu-comment-reply: 回复小红书评论
 *
 * MVP STATUS: 接口 stub，依赖 src/browser/ 接入。
 */

function parseArgs() {
  const argv = process.argv.slice(2);
  const r = { identityTokenRef: null, noteId: null, commentId: null, content: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--identity-token-ref': r.identityTokenRef = argv[++i]; break;
      case '--note-id':            r.noteId           = argv[++i]; break;
      case '--comment-id':         r.commentId        = argv[++i]; break;
      case '--content':            r.content          = argv[++i]; break;
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
  if (!args.identityTokenRef) return out({ ok: false, error: 'identity-token-ref required' }, 2);
  if (!args.noteId)           return out({ ok: false, error: 'note-id required' }, 2);
  if (!args.commentId)        return out({ ok: false, error: 'comment-id required' }, 2);
  if (!args.content)          return out({ ok: false, error: 'content required' }, 2);

  out({
    ok: false,
    error: 'NOT_IMPLEMENTED',
    message: '小红书无官方 API，依赖 src/browser/ 接入。',
    contract: {
      input: args,
      expectedOutput: { ok: true, replied_at: '<ISO>', reply_id: '...' },
    },
  }, 1);
}

main();
