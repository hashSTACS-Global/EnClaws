/** candidate 的经验类型 */
export type ExperienceKind =
  | "fact"
  | "preference"
  | "workflow"
  | "policy_hint"
  | "failure_pattern"
  | "tool_recipe";

/** candidate 生命周期状态 */
export type ExperienceStatus =
  | "pending"
  | "distilled"
  | "approved"
  | "rejected"
  | "promoted"
  | "superseded";

/** 单条经验候选 */
export interface ExperienceCandidate {
  candidateId: string;
  sessionId: string;
  kind: ExperienceKind;
  summary: string;
  evidence: string;
  status: ExperienceStatus;
  createdAt: string; // ISO 8601
}

/** 一个 sessionKey 对应的 candidate 文件 */
export interface ExperienceCandidateFile {
  sessionKey: string;
  candidates: ExperienceCandidate[];
}

/** distilled record 的 review 状态 */
export type DistilledStatus = "pending_review" | "approved" | "rejected" | "promoted" | "superseded";

/** 单条精炼知识单元 */
export interface DistilledRecord {
  recordId: string;
  tenantId: string;
  kind: ExperienceKind;
  summary: string;
  evidence: string[];
  sourceCandidateIds: string[];
  sourceUserIds: string[];
  status: DistilledStatus;
  scope: "tenant" | "personal";
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  promotedAt?: string; // ISO 8601, set when promoted
  supersededBy?: string; // recordId of replacement record
}

/** 一个日期对应的 distilled 文件 */
export interface DistilledFile {
  tenantId: string;
  records: DistilledRecord[];
}
