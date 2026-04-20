import type { SkillStatusEntry } from "../types.ts";

export type SkillGroup = {
  id: string;
  label: string;
  skills: SkillStatusEntry[];
};

const SKILL_SOURCE_GROUPS: Array<{ id: string; label: string; sources: string[] }> = [
  { id: "workspace", label: "Workspace Skills", sources: ["enclaws-workspace"] },
  { id: "built-in", label: "Built-in Skills", sources: ["enclaws-bundled"] },
  { id: "installed", label: "Installed Skills", sources: ["enclaws-managed"] },
  { id: "extra", label: "Extra Skills", sources: ["enclaws-extra"] },
];

export function groupSkills(skills: SkillStatusEntry[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup>();
  for (const def of SKILL_SOURCE_GROUPS) {
    groups.set(def.id, { id: def.id, label: def.label, skills: [] });
  }
  const builtInGroup = SKILL_SOURCE_GROUPS.find((group) => group.id === "built-in");
  const other: SkillGroup = { id: "other", label: "Other Skills", skills: [] };
  for (const skill of skills) {
    const match = skill.bundled
      ? builtInGroup
      : SKILL_SOURCE_GROUPS.find((group) => group.sources.includes(skill.source));
    if (match) {
      groups.get(match.id)?.skills.push(skill);
    } else {
      other.skills.push(skill);
    }
  }
  const ordered = SKILL_SOURCE_GROUPS.map((group) => groups.get(group.id)).filter(
    (group): group is SkillGroup => Boolean(group && group.skills.length > 0),
  );
  if (other.skills.length > 0) {
    ordered.push(other);
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Bundled skill sub-categories (mirrors tool group IDs on the tools page)
// ---------------------------------------------------------------------------

type BundledSkillCategoryDef = {
  id: string;
  label: string;
  match: (skillKey: string) => boolean;
};

const BUNDLED_SKILL_CATEGORY_DEFS: BundledSkillCategoryDef[] = [
  { id: "feishu",     label: "飞书 (Feishu)",  match: (k) => k.startsWith("feishu-") },
  { id: "memory",     label: "Memory",         match: (k) => k === "memory-manager" },
  { id: "sessions",   label: "Sessions",       match: (k) => k === "session-logs" },
  { id: "runtime",    label: "Runtime",        match: (k) => ["coding-agent", "healthcheck", "pingtest"].includes(k) },
  { id: "automation", label: "Automation",     match: (k) => ["skill-creator", "mcporter"].includes(k) },
  { id: "web",        label: "Web",            match: (k) => k === "weather" },
];

export function groupBundledSkillsByCategory(skills: SkillStatusEntry[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup>();
  for (const def of BUNDLED_SKILL_CATEGORY_DEFS) {
    groups.set(def.id, { id: def.id, label: def.label, skills: [] });
  }
  const other: SkillGroup = { id: "other", label: "Other", skills: [] };
  for (const skill of skills) {
    const cat = BUNDLED_SKILL_CATEGORY_DEFS.find((c) => c.match(skill.skillKey));
    if (cat) {
      groups.get(cat.id)!.skills.push(skill);
    } else {
      other.skills.push(skill);
    }
  }
  const ordered = BUNDLED_SKILL_CATEGORY_DEFS
    .map((cat) => groups.get(cat.id)!)
    .filter((g) => g.skills.length > 0);
  if (other.skills.length > 0) {
    ordered.push(other);
  }
  return ordered;
}
