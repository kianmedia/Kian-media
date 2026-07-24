// ════════════════════════════════════════════════════════════════════════════
// lib/portal/portfolio.ts — Batch 9 Part 2: نظرة المحفظة الهرمية.
// نداء واحد (project_portfolio_overview) يعيد عدّادات المجموعات + ثلاثة أقسام
// (رئيسية بفروع مجمَّعة / مستقلة / سريعة) بترقيم خادميّ وعزل لكل صفّ. لا مالية.
// ════════════════════════════════════════════════════════════════════════════
import { prpc } from "./client";

export type PortfolioSection = "programs" | "standalone" | "quick";
export type PortfolioStatus = "late" | "critical" | "awaiting_client" | "near_delivery" | "no_manager" | "needs_action";

export interface PortfolioChild {
  id: string; project_name: string; unit_number: number | null; unit_code: string | null; unit_type: string | null;
  core_stage: string; progress_pct: number; health: string; manager_name: string | null;
  due_date: string | null; next_action: string; late: boolean;
}
export interface PortfolioMaster {
  id: string; project_name: string; client_name: string | null; manager_name: string | null;
  operating_experience: string; health: string; own_progress: number; core_stage: string;
  due_date: string | null; start_date: string | null; next_action: string;
  child_count: number; late_children: number; critical_children: number; awaiting_client_children: number;
  children_progress: number | null; children_health: string; nearest_due: string | null;
  children: PortfolioChild[];
}
export interface PortfolioStandalone {
  id: string; project_name: string; client_name: string | null; manager_name: string | null;
  core_stage: string; progress_pct: number; health: string; due_date: string | null;
  next_action: string; is_orphan_child: boolean; unit_number: number | null;
}
export interface PortfolioQuick {
  id: string; project_name: string; client_name: string | null; project_type: string | null;
  core_stage: string; progress_pct: number; start_date: string | null; due_date: string | null;
  awaiting_client: boolean; next_action: string;
  next_shoot: { id: string; title: string; session_date: string | null } | null;
}
export interface PortfolioSummary {
  programs: { programs: number; masters: number; units: number; late: number; critical: number; awaiting_client: number };
  standalone: { active: number; late: number; awaiting_client: number; near_delivery: number; no_manager: number };
  quick: { open: number; today_tasks: number; late: number; near_delivery: number; ready: number };
  needs_intervention: { no_manager: number; overdue_tasks: number; critical_health: number; awaiting_client: number;
    overdue_approvals: number; delivered_not_closed: number; needs_my_action: number };
}
export interface PortfolioOverview {
  summary: PortfolioSummary;
  masters: { rows: PortfolioMaster[]; total: number };
  standalone: { rows: PortfolioStandalone[]; total: number };
  quick: { rows: PortfolioQuick[]; total: number };
  section: PortfolioSection | null; limit: number;
  offset: { masters: number; standalone: number; quick: number }; today: string; generated_at: string;
}

export const projectPortfolioOverview = (filters: {
  section?: PortfolioSection; search?: string; status?: PortfolioStatus; limit?: number;
  master_offset?: number; standalone_offset?: number; quick_offset?: number;
} = {}) => prpc<PortfolioOverview>("project_portfolio_overview", { p_filters: filters });

/** تلميح الإجراء التالي للمحفظة — نصّ عربيّ فقط (لا وجهة؛ البطاقة تفتح المشروع). */
export const PORTFOLIO_NEXT_ACTION_AR: Record<string, string> = {
  assign_manager: "أسنِد مديرًا", clear_overdue: "عالِج المتأخّرات", awaiting_client: "بانتظار العميل",
  start_closure: "ابدأ الإغلاق", work_tasks: "تابع المهام", none: "—",
};
export const portfolioNextAction = (k: string | null | undefined): string =>
  k ? (PORTFOLIO_NEXT_ACTION_AR[k] ?? k) : "—";

/** شارة النوع — نصّ لا لون فقط. */
export function portfolioBadge(scope: "master" | "standard" | "quick", operatingModel?: string): { ar: string; color: string } {
  if (scope === "master") return operatingModel === "program"
    ? { ar: "برنامج", color: "#7c3aed" }
    : { ar: "مشروع رئيسي", color: "#7c3aed" };
  if (scope === "quick") return { ar: "⚡ سريع", color: "#0d9488" };
  return { ar: "قياسي", color: "#57534e" };
}

export function portfolioErr(e: string): string {
  if (/not authorized/.test(e)) return "لا تملك صلاحية عرض المحفظة.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "نظرة المحفظة (9B) غير مطبّقة في قاعدة البيانات.";
  return "تعذّر تحميل المحفظة. حاول مرة أخرى.";
}
