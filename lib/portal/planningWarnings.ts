// ════════════════════════════════════════════════════════════════════════════
// lib/portal/planningWarnings.ts — Phase 4D §3
// Helper مركزي لتجميع تحذيرات التخطيط (Gantt/الموارد/الجدول) في مجموعات حسب code،
// بدل عرض الرسالة عشرات المرات. يدعم العقود القديمة (strings) والجديدة ({type,ar,task_id}).
// لا يدمج أنواعًا مختلفة؛ Deduplication حسب warning code فقط.
// ════════════════════════════════════════════════════════════════════════════

export interface RawWarning { type?: string; ar?: string; en?: string; task_id?: string; [k: string]: unknown }
export interface WarningItem { ar: string; task_id?: string }
export interface WarningGroup { code: string; baseLabel: string; count: number; items: WarningItem[] }

// رسالة عامة موجزة لكل code معروف (يُعرَض كـ«{count} {baseLabel}»).
const BASE_LABELS: Record<string, string> = {
  missing_dates: "مهمة بلا تواريخ — لن تظهر على المخطط",
  no_dates: "مهمة بلا تواريخ",
  no_dependencies: "لا اعتماديات كافية — المسار الحرج غير دقيق",
  critical_path_error: "تعذّر حساب المسار الحرج — عُرِضت المهام دونه",
  constraint_violation: "قيد متعارض (finish_no_later_than)",
  not_converged: "قد توجد حلقة أو قيود متعارضة",
  no_auto_tasks: "لا مهام آلية قابلة للموازنة",
  balanced: "لا حاجة لموازنة — لا تداخل قابل للحل",
  overloaded: "مورد فوق الطاقة",
  unavailable: "مورد غير متاح",
  no_tasks: "لا مهام",
  booking_conflicts: "تعارض حجز موارد",
  unassigned: "مهمة بلا مسؤول",
  baseline_slip: "مهمة تجاوزت خط الأساس",
  overdue: "مهمة متأخرة",
  unscheduled_auto: "مهمة آلية بلا جدولة",
};

// كود مستقر من نص (للعقود القديمة القائمة على strings فقط، بلا type).
function codeFromText(s: string): string {
  const t = s.trim();
  if (/تواريخ|dates/i.test(t)) return "missing_dates";
  if (/اعتمادي|dependenc/i.test(t)) return "no_dependencies";
  if (/المسار الحرج|critical/i.test(t)) return "critical_path_error";
  if (/متأخر|overdue/i.test(t)) return "overdue";
  if (/خط الأساس|baseline/i.test(t)) return "baseline_slip";
  if (/مسؤول|assign/i.test(t)) return "unassigned";
  // كود ثابت مشتق من النص لتجميع المتطابق حرفيًا
  return "text:" + t.slice(0, 48);
}

/** يحوّل قائمة تحذيرات (strings أو objects) إلى مجموعات مدموجة حسب code. */
export function groupWarnings(warnings: Array<RawWarning | string> | null | undefined): WarningGroup[] {
  const map = new Map<string, WarningGroup>();
  for (const w of warnings ?? []) {
    const isStr = typeof w === "string";
    const ar = isStr ? (w as string) : ((w as RawWarning).ar ?? (w as RawWarning).en ?? "");
    const code = isStr ? codeFromText(w as string) : ((w as RawWarning).type || codeFromText(ar || "other"));
    const taskId = isStr ? undefined : (w as RawWarning).task_id;
    let g = map.get(code);
    if (!g) { g = { code, baseLabel: BASE_LABELS[code] ?? ar ?? code, count: 0, items: [] }; map.set(code, g); }
    g.count += 1;
    g.items.push({ ar, task_id: taskId });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/** نص العنوان المجمّع، مثل: «7 مهام بلا تواريخ — لن تظهر على المخطط». */
export function groupHeadline(g: WarningGroup): string {
  return `${g.count} · ${g.baseLabel}`;
}
