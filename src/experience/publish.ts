import fs from "node:fs/promises";
import path from "node:path";
import { listDistilledRecords } from "./distill-store.js";
import type { DistilledRecord, ExperienceKind } from "./types.js";

export const MARKER_START = "<!-- enclaws:experience:start -->";
export const MARKER_END = "<!-- enclaws:experience:end -->";

const KIND_ORDER: ExperienceKind[] = [
  "fact",
  "preference",
  "workflow",
  "policy_hint",
  "failure_pattern",
  "tool_recipe",
];

const KIND_LABELS: Record<ExperienceKind, string> = {
  fact: "事实",
  preference: "偏好",
  workflow: "流程",
  policy_hint: "策略",
  failure_pattern: "故障模式",
  tool_recipe: "工具用法",
};

/** Generate the Markdown content for the promoted records block (without markers). */
export function generatePromotedBlock(records: DistilledRecord[]): string {
  if (records.length === 0) {
    return "";
  }

  const grouped = new Map<ExperienceKind, DistilledRecord[]>();
  for (const r of records) {
    const list = grouped.get(r.kind) ?? [];
    list.push(r);
    grouped.set(r.kind, list);
  }

  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  const lines: string[] = [
    "## 企业知识（自动提取）",
    "",
    `> 以下内容由经验提取流水线自动生成，最近更新：${now}`,
    "",
  ];

  for (const kind of KIND_ORDER) {
    const list = grouped.get(kind);
    if (!list || list.length === 0) {
      continue;
    }
    lines.push(`### ${KIND_LABELS[kind]}`);
    for (const r of list) {
      lines.push(`- ${r.summary}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/** Publish all promoted records to the tenant MEMORY.md marker block. */
export async function publishPromotedToTenantMemory(params: {
  tenantId: string;
  tenantDir: string;
}): Promise<{ published: number }> {
  const promoted = await listDistilledRecords(
    params.tenantDir,
    params.tenantId,
    undefined,
    { status: "promoted" },
  );

  const memoryPath = path.join(params.tenantDir, "MEMORY.md");
  let content: string;
  try {
    content = await fs.readFile(memoryPath, "utf-8");
  } catch {
    content = "";
  }

  const block = generatePromotedBlock(promoted);
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx).trimEnd();
    const after = content.slice(endIdx + MARKER_END.length).trimStart();

    if (block) {
      content = [before, "", `${MARKER_START}\n${block}\n${MARKER_END}`, "", after]
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd() + "\n";
    } else {
      content = [before, "", after]
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd() + "\n";
    }
  } else if (block) {
    const trimmed = content.trimEnd();
    content = trimmed
      ? `${trimmed}\n\n${MARKER_START}\n${block}\n${MARKER_END}\n`
      : `${MARKER_START}\n${block}\n${MARKER_END}\n`;
  }

  await fs.mkdir(path.dirname(memoryPath), { recursive: true });
  await fs.writeFile(memoryPath, content, "utf-8");

  return { published: promoted.length };
}
