import type { TestCaseAssert } from "../types.js";
import type { FeishuReplyMeta } from "../feishu-client.js";

export function formatAssert(a?: TestCaseAssert): string {
  if (!a) return "";
  const parts: string[] = [];
  if (a.contains) parts.push(`contains:"${a.contains}"`);
  if (a.notContains) parts.push(`!contains:"${a.notContains}"`);
  if (a.matches) parts.push(`matches:/${a.matches}/`);
  if (a.minLength != null) parts.push(`min:${a.minLength}`);
  if (a.maxLength != null) parts.push(`max:${a.maxLength}`);
  if (a.msgType) parts.push(`msgType:${a.msgType}`);
  if (a.hasFile) parts.push("hasFile");
  if (a.hasImage) parts.push("hasImage");
  if (a.fileNameMatches) parts.push(`fileName:/${a.fileNameMatches}/`);
  return parts.join(", ");
}

export function checkAssertions(text: string, assert?: TestCaseAssert, meta?: FeishuReplyMeta): string[] {
  const failures: string[] = [];
  if (!text && !meta?.fileKey && !meta?.imageKey) {
    failures.push("reply is empty");
  }
  if (assert) {
    if (assert.contains && !text.includes(assert.contains)) {
      failures.push(`expected to contain "${assert.contains}"`);
    }
    if (assert.notContains && text.includes(assert.notContains)) {
      failures.push(`expected NOT to contain "${assert.notContains}"`);
    }
    if (assert.matches && !new RegExp(assert.matches).test(text)) {
      failures.push(`expected to match /${assert.matches}/`);
    }
    if (assert.minLength != null && text.length < assert.minLength) {
      failures.push(`length ${text.length} < minLength ${assert.minLength}`);
    }
    if (assert.maxLength != null && text.length > assert.maxLength) {
      failures.push(`length ${text.length} > maxLength ${assert.maxLength}`);
    }
    if (assert.msgType && meta?.msgType !== assert.msgType) {
      failures.push(`expected msgType "${assert.msgType}" but got "${meta?.msgType ?? "unknown"}"`);
    }
    if (assert.hasFile && !meta?.fileKey) {
      failures.push("expected reply to contain a file");
    }
    if (assert.hasImage && !meta?.imageKey) {
      failures.push("expected reply to contain an image");
    }
    if (assert.fileNameMatches && !new RegExp(assert.fileNameMatches).test(meta?.fileName ?? "")) {
      failures.push(`expected fileName to match /${assert.fileNameMatches}/ but got "${meta?.fileName ?? ""}"`);
    }
  }
  return failures;
}
