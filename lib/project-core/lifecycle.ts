// ════════════════════════════════════════════════════════════════════════════
// Project lifecycle — SINGLE source of truth for the 13 project_core.core_stage
// stages: key + order + Arabic/English labels. The live value ALWAYS comes from
// project_core.core_stage; the timeline position is DERIVED here, never stored.
//
// Every stage surface must use THIS module (directly, or via PC_STAGES /
// PC_STAGE_LABELS in lib/portal/projectCore.ts which re-export it): the project
// stage timeline, the current-stage name/badge, the Project Core stepper, project
// cards. Do NOT duplicate the stage list or its labels anywhere else.
// ════════════════════════════════════════════════════════════════════════════

/** The 13 lifecycle stages, in canonical order. Labels are the approved names
 *  already used across the platform (kept identical — do not reword). */
export const LIFECYCLE_STAGES = [
  { key: "lead_approved",   ar: "اعتماد العميل المحتمل", en: "Lead Approved" },
  { key: "project_created", ar: "إنشاء المشروع",          en: "Project Created" },
  { key: "planning",        ar: "التخطيط",                en: "Planning" },
  { key: "ready",           ar: "جاهز",                   en: "Ready" },
  { key: "scheduled",       ar: "مجدول",                  en: "Scheduled" },
  { key: "in_production",   ar: "قيد الإنتاج",            en: "In Production" },
  { key: "post_production", ar: "ما بعد الإنتاج",         en: "Post Production" },
  { key: "internal_review", ar: "مراجعة داخلية",          en: "Internal Review" },
  { key: "client_review",   ar: "مراجعة العميل",          en: "Client Review" },
  { key: "revision",        ar: "تعديل",                  en: "Revision" },
  { key: "approved",        ar: "معتمد",                  en: "Approved" },
  { key: "delivered",       ar: "تم التسليم",             en: "Delivered" },
  { key: "closed",          ar: "مغلق",                   en: "Closed" },
] as const;

export type LifecycleStageKey = (typeof LIFECYCLE_STAGES)[number]["key"];

/** Canonical stage order (keys only) — the same order the DB state machine uses. */
export const LIFECYCLE_ORDER = LIFECYCLE_STAGES.map((s) => s.key) as readonly LifecycleStageKey[];

export type LifecycleStepState = "completed" | "current" | "upcoming";
export interface LifecycleStep {
  key: LifecycleStageKey;
  ar: string;
  en: string;
  order: number;
  state: LifecycleStepState;
}

/** The label for a stage key (falls back to the raw key if unknown). */
export function lifecycleLabel(coreStage: string | null | undefined): { ar: string; en: string } {
  const s = LIFECYCLE_STAGES.find((x) => x.key === coreStage);
  return s ? { ar: s.ar, en: s.en } : { ar: coreStage ?? "—", en: coreStage ?? "—" };
}

/** The current position (0-based) of core_stage in the lifecycle, or -1 if unknown. */
export function lifecycleIndex(coreStage: string | null | undefined): number {
  return coreStage ? LIFECYCLE_ORDER.indexOf(coreStage as LifecycleStageKey) : -1;
}

/**
 * Derive the 13-step timeline state DIRECTLY from core_stage (the single source
 * of truth) — never from projects.status, deliverables, or progress_percent.
 *   • stages before the current one → completed (✓)
 *   • the current stage            → active (current)
 *   • later stages                 → upcoming
 *   • delivered/closed render their reached step as completed (a delivered
 *     project shows everything up to «تم التسليم» done; closed ⇒ all completed).
 * Going back to an earlier stage lowers the position immediately (pure function).
 */
export function lifecycleTimeline(coreStage: string | null | undefined): LifecycleStep[] {
  const cur = lifecycleIndex(coreStage);
  const terminalDone = coreStage === "delivered" || coreStage === "closed";
  return LIFECYCLE_STAGES.map((s, i) => {
    let state: LifecycleStepState;
    if (cur < 0) state = "upcoming";
    else if (i < cur) state = "completed";
    else if (i === cur) state = terminalDone ? "completed" : "current";
    else state = "upcoming";
    return { key: s.key, ar: s.ar, en: s.en, order: i, state };
  });
}
