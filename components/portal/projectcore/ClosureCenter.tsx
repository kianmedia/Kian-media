"use client";
// ════════════════════════════════════════════════════════════════════════════
// ClosureCenter — Batch 6C. يوصل طبقة الإغلاق (5C) بالمسارات التنفيذية.
// قبل هذه الدفعة كانت دوال 5C مكتملة في SQL وأغلفتها موجودة في TS، لكن بلا أيّ
// مستهلك في الواجهة: صندوق الإغلاق، إغلاق المحفظة، سجلّ المعرفة، سجلّ الأرشيف.
// أربعة تبويبات، كلّها RPCs حقيقية (لا بيانات وهمية، ولا زرّ بلا RPC).
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { csvDownload } from "@/lib/portal/csv";
import { PC_STAGE_LABELS, type PcStage } from "@/lib/portal/projectCore";
import {
  myClosureInbox, executiveClosureMetrics, closureKnowledgeRegister, archiveRegister,
  projectClosureReview, projectClosureApprove, projectClosureReject, projectClosureRequestChanges,
  projectFinalAcceptanceDecide, projectReopenApprove, projectLessonApproveKnowledge,
  projectArchiveRestore, projectArchiveSetLegalHold,
  CLOSURE_STATUS, LESSON_CATEGORIES, closureErr,
  type ClosureStatus, type ExecutiveClosureMetrics, type KnowledgeRegister, type Dict,
} from "@/lib/portal/projectClosure";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const btn = "text-[11px] rounded-lg px-2.5 py-1 border";
type Tab = "inbox" | "portfolio" | "knowledge" | "archive";
const TABS: { k: Tab; ar: string; en: string }[] = [
  { k: "inbox", ar: "صندوق الإغلاق", en: "Closure inbox" },
  { k: "portfolio", ar: "إغلاق المحفظة", en: "Portfolio closure" },
  { k: "knowledge", ar: "سجلّ المعرفة", en: "Knowledge register" },
  { k: "archive", ar: "سجلّ الأرشيف", en: "Archive register" },
];
const IMPACT: Record<string, { ar: string; c: string }> = {
  critical: { ar: "حرج", c: "#dc2626" }, high: { ar: "عالٍ", c: "#d97706" },
  medium: { ar: "متوسّط", c: "#0891b2" }, low: { ar: "منخفض", c: "#78716c" },
};
const CONF: Record<string, string> = { internal: "داخلي", management: "إدارة", client_shareable: "قابل للمشاركة" };
// تصنيفات الدروس تُعرض بالعربية كبقية المنصّة بدل قيم قاعدة البيانات الخام.
const LESSON_CAT_AR: Record<string, string> = {
  planning: "التخطيط", production: "الإنتاج", post_production: "ما بعد الإنتاج", client_management: "إدارة العميل",
  resources: "الموارد", equipment: "المعدّات", quality: "الجودة", scheduling: "الجدولة", communication: "التواصل",
  governance: "الحوكمة", risk: "المخاطر", supplier: "الموردون", technical: "تقني", other: "أخرى",
};
const str = (v: unknown) => (v == null ? "" : String(v));

export default function ClosureCenter({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("inbox");
  const [msg, setMsg] = useState("");
  const flash = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-auto p-2 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-5xl bg-stone-950 border border-stone-800 rounded-2xl my-2" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-stone-800 sticky top-0 bg-stone-950 z-10">
          <h3 className="text-sm font-semibold text-stone-100">{t({ ar: "مركز الإغلاق المؤسسي", en: "Closure center" })}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-lg" aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>
        {msg && <p className="mx-3 mt-2 text-[11px] text-sky-300 bg-sky-950/40 border border-sky-900 rounded-lg px-3 py-1.5">{msg}</p>}

        <div className="flex gap-1 flex-wrap p-3 border-b border-stone-800" role="tablist" aria-label={t({ ar: "أقسام الإغلاق", en: "Closure sections" })}>
          {TABS.map((x) => (
            <button key={x.k} role="tab" id={`closure-tab-${x.k}`} aria-controls="closure-panel" aria-selected={tab === x.k} onClick={() => setTab(x.k)}
              className={`text-[11px] px-3 py-1 rounded-lg border ${tab === x.k ? "bg-stone-800 border-sky-700 text-white" : "bg-stone-900 border-stone-700 text-stone-400 hover:text-white"}`}>
              {t({ ar: x.ar, en: x.en })}
            </button>
          ))}
        </div>

        <div className="p-3" id="closure-panel" role="tabpanel" aria-labelledby={`closure-tab-${tab}`}>
          {tab === "inbox" && <InboxTab flash={flash} />}
          {tab === "portfolio" && <PortfolioTab flash={flash} />}
          {tab === "knowledge" && <KnowledgeTab flash={flash} />}
          {tab === "archive" && <ArchiveTab flash={flash} />}
        </div>
      </div>
    </div>
  );
}

// ─── حالة تحميل موحّدة (نفس نمط بقية اللوحات: تسلسل الطلبات + مهلة + حارس Unmount) ───
function useLoader<T>(fn: () => Promise<{ ok: boolean; data?: T; error?: string }>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const seq = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async () => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        fn(),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("closure_timeout")), 20000); }),
      ]);
      if (!mounted.current || my !== seq.current) return;
      if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[closure-center]", r.error); setErr(closureErr(r.error ?? "")); setPhase("error"); return; }
      setData(r.data as T); setPhase("ready");
    } catch (e) {
      if (!mounted.current || my !== seq.current) return;
      setErr(e instanceof Error && e.message === "closure_timeout" ? "انتهت المهلة." : closureErr(String(e))); setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return { data, phase, err, reload: load };
}

function Shell({ phase, err, reload, empty, children }:
  { phase: string; err: string; reload: () => void; empty?: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  if (phase === "loading") return <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-2">
      <p className="text-sm text-red-300">{err}</p>
      <button onClick={reload} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة", en: "Retry" })}</button>
    </div>
  );
  if (empty) return <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "لا عناصر.", en: "Nothing here." })}</p>;
  return <>{children}</>;
}

const plink = (id: string) => `/client-portal/project-core/${id}`;

// ════════════════ 1) صندوق الإغلاق — الطلبات المطلوب بتّها منّي ════════════════
function InboxTab({ flash }: { flash: (m: string) => void }) {
  const { t } = useI18n();
  const { data, phase, err, reload } = useLoader(() => myClosureInbox({}), []);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    if (busy) return;                                   // منع الإرسال المزدوج
    setBusy(true); const r = await fn(); setBusy(false);
    if (!r.ok) { flash(closureErr(r.error ?? "")); return; }
    flash(okMsg); void reload();
  }
  const ask = (label: string) => { const v = window.prompt(label); return v && v.trim() ? v.trim() : null; };   // إلغاء أو فراغ ⇒ لا نداء

  const closures = (data?.closure_requests ?? []) as Dict[];
  const accepts = (data?.acceptances ?? []) as Dict[];
  const reopens = (data?.reopen_requests ?? []) as Dict[];
  const empty = closures.length === 0 && accepts.length === 0 && reopens.length === 0;

  return (
    <Shell phase={phase} err={err} reload={reload} empty={empty}>
      <div className="space-y-4">
        {closures.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-stone-300 mb-1.5">{t({ ar: "طلبات إغلاق بانتظار المراجعة/الاعتماد", en: "Closure requests" })} ({closures.length})</h4>
            <div className="space-y-1.5">
              {closures.map((c) => (
                <div key={str(c.id)} className={`${card} p-2.5 flex items-start gap-2 flex-wrap`}>
                  <div className="min-w-0 flex-1">
                    <Link href={plink(str(c.project_id))} className="text-xs text-stone-100 hover:text-sky-300" dir="auto">{str(c.project_name) || "—"}</Link>
                    <div className="text-[10px] text-stone-500">{str(c.request_no)} · {str(c.status)} · <span dir="ltr">{str(c.requested_at).slice(0, 10)}</span></div>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {str(c.status) === "submitted" && (
                      <button disabled={busy} onClick={() => void act(() => projectClosureReview(str(c.id), "start_review"), t({ ar: "بدأت المراجعة.", en: "Review started." }))}
                        className={`${btn} border-stone-700 text-stone-300 disabled:opacity-40`}>{t({ ar: "بدء المراجعة", en: "Start review" })}</button>
                    )}
                    <button disabled={busy} onClick={() => void act(() => projectClosureApprove(str(c.id)), t({ ar: "اعتُمد الطلب.", en: "Approved." }))}
                      className={`${btn} border-emerald-800 text-emerald-300 disabled:opacity-40`}>{t({ ar: "اعتماد", en: "Approve" })}</button>
                    <button disabled={busy} onClick={() => { const r = ask(t({ ar: "سبب طلب التعديل (إلزامي):", en: "Required changes:" })); if (r) void act(() => projectClosureRequestChanges(str(c.id), r), t({ ar: "أُرسل طلب التعديل.", en: "Changes requested." })); }}
                      className={`${btn} border-amber-800 text-amber-300 disabled:opacity-40`}>{t({ ar: "طلب تعديل", en: "Request changes" })}</button>
                    <button disabled={busy} onClick={() => { const r = ask(t({ ar: "سبب الرفض (إلزامي):", en: "Rejection reason:" })); if (r) void act(() => projectClosureReject(str(c.id), r), t({ ar: "رُفض الطلب.", en: "Rejected." })); }}
                      className={`${btn} border-red-900 text-red-300 disabled:opacity-40`}>{t({ ar: "رفض", en: "Reject" })}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {accepts.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-stone-300 mb-1.5">{t({ ar: "قبول نهائي مطلوب", en: "Final acceptances" })} ({accepts.length})</h4>
            <div className="space-y-1.5">
              {accepts.map((a) => (
                <div key={str(a.id)} className={`${card} p-2.5 flex items-start gap-2 flex-wrap`}>
                  <div className="min-w-0 flex-1">
                    <Link href={plink(str(a.project_id))} className="text-xs text-stone-100 hover:text-sky-300" dir="auto">{str(a.project_name) || "—"}</Link>
                    <div className="text-[10px] text-stone-500">{str(a.acceptance_type)} · {str(a.status)}{a.due_at ? <> · <span dir="ltr">{str(a.due_at).slice(0, 10)}</span></> : null}</div>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <button disabled={busy} onClick={() => void act(() => projectFinalAcceptanceDecide(str(a.id), "accept"), t({ ar: "سُجّل القبول.", en: "Accepted." }))}
                      className={`${btn} border-emerald-800 text-emerald-300 disabled:opacity-40`}>{t({ ar: "قبول", en: "Accept" })}</button>
                    <button disabled={busy} onClick={() => { const r = ask(t({ ar: "التعديلات المطلوبة (إلزامي):", en: "Requested changes:" })); if (r) void act(() => projectFinalAcceptanceDecide(str(a.id), "request_changes", r), t({ ar: "أُرسلت التعديلات.", en: "Changes requested." })); }}
                      className={`${btn} border-amber-800 text-amber-300 disabled:opacity-40`}>{t({ ar: "طلب تعديل", en: "Request changes" })}</button>
                    <button disabled={busy} onClick={() => { const r = ask(t({ ar: "سبب الرفض (إلزامي):", en: "Rejection reason:" })); if (r) void act(() => projectFinalAcceptanceDecide(str(a.id), "reject", r), t({ ar: "سُجّل الرفض.", en: "Rejected." })); }}
                      className={`${btn} border-red-900 text-red-300 disabled:opacity-40`}>{t({ ar: "رفض", en: "Reject" })}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {reopens.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-stone-300 mb-1.5">{t({ ar: "طلبات إعادة الفتح", en: "Reopen requests" })} ({reopens.length})</h4>
            <div className="space-y-1.5">
              {reopens.map((r) => (
                <div key={str(r.id)} className={`${card} p-2.5 flex items-start gap-2 flex-wrap`}>
                  <div className="min-w-0 flex-1">
                    <Link href={plink(str(r.project_id))} className="text-xs text-stone-100 hover:text-sky-300" dir="auto">{str(r.project_name) || "—"}</Link>
                    <div className="text-[10px] text-stone-500">{t({ ar: "إلى مرحلة", en: "to stage" })}: {t(PC_STAGE_LABELS[str(r.requested_target_stage) as PcStage] ?? { ar: str(r.requested_target_stage), en: str(r.requested_target_stage) })} · <span dir="ltr">{str(r.requested_at).slice(0, 10)}</span></div>
                  </div>
                  {/* إلغاء الـprompt يعني إلغاء الإجراء — لا يجوز أن يمرّ null كـ«بلا تعليق» فيُعتمد الطلب */}
                  <button disabled={busy} onClick={() => { const c = window.prompt(t({ ar: "تعليق الاعتماد (اختياري — إلغاء يوقف الإجراء):", en: "Approval comment (optional — cancel aborts):" })); if (c === null) return; void act(() => projectReopenApprove(str(r.id), c || undefined), t({ ar: "اعتُمدت إعادة الفتح.", en: "Reopen approved." })); }}
                    className={`${btn} border-violet-800 text-violet-300 disabled:opacity-40`}>{t({ ar: "اعتماد إعادة الفتح", en: "Approve reopen" })}</button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Shell>
  );
}

// ════════════════ 2) إغلاق المحفظة — العدسة التنفيذية ════════════════
function PortfolioTab({ flash }: { flash: (m: string) => void }) {
  const { t } = useI18n();
  const { data, phase, err, reload } = useLoader<ExecutiveClosureMetrics>(() => executiveClosureMetrics({}), []);

  function exportCsv() {
    if (!data) return;
    const rows: (string | number | null)[][] = [["القسم", "المشروع", "التفصيل", "قيمة"]];
    Object.entries(data.distribution ?? {}).forEach(([k, v]) => rows.push(["توزيع الحالات", "", CLOSURE_STATUS[k as ClosureStatus]?.ar ?? k, v]));
    (data.in_progress_rows ?? []).forEach((r) => rows.push(["قيد الإغلاق", r.project_name ?? "", CLOSURE_STATUS[r.closure_status]?.ar ?? r.closure_status, ""]));
    (data.overdue_closures ?? []).forEach((r) => rows.push(["إغلاق متأخّر", r.project_name ?? "", r.planned_closure_date ?? "", r.days_overdue ?? ""]));
    (data.delivered_not_closed ?? []).forEach((r) => rows.push(["مُسلَّم بلا إغلاق", r.project_name ?? "", r.due_date ?? "", r.days_since_due ?? ""]));
    (data.pending_client_acceptance ?? []).forEach((r) => rows.push(["بانتظار قبول العميل", r.project_name ?? "", r.acceptance_type, r.overdue ? "متأخّر" : ""]));
    csvDownload("portfolio-closure", rows);
    flash(t({ ar: "تم تصدير CSV.", en: "CSV exported." }));
  }

  return (
    <Shell phase={phase} err={err} reload={reload}>
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            {[
              { ar: "إجمالي", n: data.total },
              { ar: "متوسّط زمن الإغلاق (يوم)", n: data.avg_closure_cycle_days ?? "—" },
              { ar: "إغلاقات متأخّرة", n: (data.overdue_closures ?? []).length, red: true },
              { ar: "مُسلَّم بلا إغلاق", n: (data.delivered_not_closed ?? []).length },
              { ar: "مؤرشف", n: data.archived_count },
            ].map((x, i) => (
              <div key={i} className="border border-stone-800 rounded-lg p-2">
                <div className="text-base font-bold" style={{ color: x.red && Number(x.n) > 0 ? "#dc2626" : "#e7e5e4" }}>{x.n}</div>
                <div className="text-[10px] text-stone-500">{x.ar}</div>
              </div>
            ))}
          </div>
          {/* المقام صفر ⇒ null: لا نعرض 0% مضلِّلة حين لا مشاريع مغلقة بعد */}
          <p className="text-[10px] text-stone-500">
            {t({ ar: "التقاط الدروس", en: "Lessons capture" })}: {data.lessons?.capture_rate == null
              ? t({ ar: "غير متاح (لا مشاريع مغلقة)", en: "n/a (no closed projects)" })
              : `${data.lessons.capture_rate}% (${data.lessons.with_lessons}/${data.lessons.closed_projects})`}
            {data.closure_cycle_sample > 0 ? ` · ${t({ ar: "عيّنة زمن الإغلاق", en: "cycle sample" })}: ${data.closure_cycle_sample}` : ""}
          </p>

          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.distribution ?? {}).map(([k, v]) => (
              <span key={k} className="text-[10px] px-2 py-0.5 rounded border border-stone-800"
                style={{ color: CLOSURE_STATUS[k as ClosureStatus]?.color ?? "#a8a29e" }}>
                {CLOSURE_STATUS[k as ClosureStatus]?.ar ?? k}: {v}
              </span>
            ))}
          </div>

          <RowGroup title={t({ ar: "قيد الإغلاق", en: "In progress" })} rows={(data.in_progress_rows ?? []).map((r) => ({
            id: r.project_id, name: r.project_name, note: CLOSURE_STATUS[r.closure_status]?.ar ?? r.closure_status }))} />
          <RowGroup title={t({ ar: "إغلاقات متأخّرة عن التاريخ المخطّط", en: "Overdue closures" })} danger rows={(data.overdue_closures ?? []).map((r) => ({
            id: r.project_id, name: r.project_name, note: `${r.days_overdue ?? "?"} ${t({ ar: "يوم تأخّر", en: "days late" })}` }))} />
          <RowGroup title={t({ ar: "مُسلَّم ولم يُغلق", en: "Delivered, not closed" })} rows={(data.delivered_not_closed ?? []).map((r) => ({
            id: r.project_id, name: r.project_name, note: r.days_since_due != null ? `${r.days_since_due} ${t({ ar: "يوم منذ الاستحقاق", en: "days since due" })}` : "—" }))} />
          {/* الحالة التي لا يعبّر عنها محرّك حالة الإغلاق ⇒ كانت غائبة تنفيذيًّا قبل 6C */}
          <RowGroup title={t({ ar: "بانتظار قبول العميل", en: "Awaiting client acceptance" })} rows={(data.pending_client_acceptance ?? []).map((r) => ({
            id: r.project_id, name: r.project_name, note: r.overdue ? t({ ar: "متأخّر", en: "overdue" }) : r.acceptance_type }))} />

          <button onClick={exportCsv} className="text-[11px] text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5">
            {t({ ar: "تصدير CSV", en: "Export CSV" })}
          </button>
        </div>
      )}
    </Shell>
  );
}

function RowGroup({ title, rows, danger }: { title: string; rows: { id: string; name: string | null; note: string }[]; danger?: boolean }) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  return (
    <section>
      <h4 className={`text-xs font-semibold mb-1 ${danger ? "text-red-300" : "text-stone-300"}`}>{title} ({rows.length})</h4>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={`${r.id}-${i}`} className="flex items-center gap-2 text-[11px] border border-stone-800 rounded-lg px-2 py-1">
            <Link href={plink(r.id)} className="text-stone-200 hover:text-sky-300 truncate flex-1" dir="auto">{r.name || t({ ar: "بلا اسم", en: "Untitled" })}</Link>
            <span className={danger ? "text-red-400" : "text-stone-500"}>{r.note}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ════════════════ 3) سجلّ المعرفة المؤسسي (عبر المشاريع) ════════════════
function KnowledgeTab({ flash }: { flash: (m: string) => void }) {
  const { t } = useI18n();
  const [cat, setCat] = useState("");
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const { data, phase, err, reload } = useLoader<KnowledgeRegister>(
    () => closureKnowledgeRegister({ category: cat || undefined, search: applied || undefined, approved_only: approvedOnly, limit: 50, offset }),
    [cat, applied, approvedOnly, offset]);

  async function approve(id: string, next: boolean) {
    if (busy) return;
    setBusy(true); const r = await projectLessonApproveKnowledge(id, next); setBusy(false);
    if (!r.ok) { flash(closureErr(r.error ?? "")); return; }
    flash(next ? "اعتُمد الدرس معرفيًّا." : t({ ar: "أُلغي الاعتماد.", en: "Approval revoked." })); void reload();
  }
  function exportCsv() {
    if (!data) return;
    csvDownload("knowledge-register", [
      ["المشروع", "التصنيف", "العنوان", "الأثر", "السرّية", "معتمد", "التوصية"],
      ...data.lessons.map((l) => [l.project_name ?? "", l.category, l.title, l.impact_level, l.confidentiality, l.approved_for_knowledge_base ? "نعم" : "لا", l.recommendation ?? ""]),
    ]);
    flash(t({ ar: "تم تصدير CSV.", en: "CSV exported." }));
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap items-center">
        <select value={cat} onChange={(e) => { setCat(e.target.value); setOffset(0); }}
          aria-label={t({ ar: "تصنيف الدرس", en: "Lesson category" })}
          className="bg-stone-900 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200">
          <option value="">{t({ ar: "كل التصنيفات", en: "All categories" })}</option>
          {LESSON_CATEGORIES.map((c) => <option key={c} value={c}>{LESSON_CAT_AR[c] ?? c}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setApplied(search.trim()); setOffset(0); } }}
          placeholder={t({ ar: "بحث في العناوين والتوصيات…", en: "Search titles & recommendations…" })}
          className="flex-1 min-w-[160px] bg-stone-900 border border-stone-700 rounded-lg px-3 py-1.5 text-xs text-stone-200" />
        <button onClick={() => { setApplied(search.trim()); setOffset(0); }} className="text-[11px] text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5">{t({ ar: "بحث", en: "Search" })}</button>
        <label className="flex items-center gap-1 text-[11px] text-stone-400">
          <input type="checkbox" checked={approvedOnly} onChange={(e) => { setApprovedOnly(e.target.checked); setOffset(0); }} />
          {t({ ar: "المعتمدة معرفيًّا فقط", en: "Approved only" })}
        </label>
      </div>

      {/* صفحة فارغة بعد الصفحة الأولى: لا نمرّر empty كي يبقى زرّ «السابق» ظاهرًا */}
      <Shell phase={phase} err={err} reload={reload} empty={data?.lessons.length === 0 && offset === 0}>
        {data && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-[10px] text-stone-500">
              <span>{t({ ar: "إجمالي", en: "Total" })}: {data.stats?.total ?? 0}</span>
              <span>{t({ ar: "معتمد", en: "Approved" })}: {data.stats?.approved ?? 0}</span>
              <span className="text-red-400">{t({ ar: "أثر حرج", en: "Critical" })}: {data.stats?.critical ?? 0}</span>
              <span>{t({ ar: "مشاريع", en: "Projects" })}: {data.stats?.projects ?? 0}</span>
              {!data.can_see_management && <span className="text-amber-500">{t({ ar: "دروس «إدارة» مخفيّة بحسب صلاحيتك", en: "Management-confidential lessons hidden" })}</span>}
            </div>
            {data.lessons.length === 0 && <p className="text-xs text-stone-500 py-6 text-center">{t({ ar: "لا نتائج في هذه الصفحة.", en: "No results on this page." })}</p>}
            {data.lessons.map((l) => (
              <div key={l.id} className={`${card} p-2.5 space-y-1`}>
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-stone-100" dir="auto">{l.title}</p>
                    <div className="text-[10px] text-stone-500 flex gap-1.5 flex-wrap">
                      <Link href={plink(l.project_id)} className="hover:text-sky-300" dir="auto">{l.project_name || "—"}</Link>
                      <span>· {LESSON_CAT_AR[l.category] ?? l.category}</span>
                      <span style={{ color: IMPACT[l.impact_level]?.c ?? "#78716c" }}>· {IMPACT[l.impact_level]?.ar ?? l.impact_level}</span>
                      <span>· {CONF[l.confidentiality] ?? l.confidentiality}</span>
                    </div>
                  </div>
                  <button disabled={busy} onClick={() => void approve(l.id, !l.approved_for_knowledge_base)}
                    className={`${btn} disabled:opacity-40 ${l.approved_for_knowledge_base ? "border-emerald-800 text-emerald-300" : "border-stone-700 text-stone-400"}`}>
                    {l.approved_for_knowledge_base ? t({ ar: "معتمد ✓", en: "Approved ✓" }) : t({ ar: "اعتماد معرفي", en: "Approve" })}
                  </button>
                </div>
                {l.recommendation && <p className="text-[11px] text-stone-400" dir="auto">{t({ ar: "التوصية", en: "Recommendation" })}: {l.recommendation}</p>}
                {l.reusable_practice && <p className="text-[11px] text-emerald-400/80" dir="auto">{t({ ar: "ممارسة قابلة لإعادة الاستخدام", en: "Reusable practice" })}: {l.reusable_practice}</p>}
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="text-[11px] text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "السابق", en: "Prev" })}</button>
              <button onClick={exportCsv} className="text-[11px] text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-3 py-1">{t({ ar: "تصدير CSV", en: "Export CSV" })}</button>
              <button disabled={!data.has_more} onClick={() => setOffset(offset + 50)} className="text-[11px] text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "التالي", en: "Next" })}</button>
            </div>
          </div>
        )}
      </Shell>
    </div>
  );
}

// ════════════════ 4) سجلّ الأرشيف — استعادة وحجز قانوني ════════════════
function ArchiveTab({ flash }: { flash: (m: string) => void }) {
  const { t } = useI18n();
  const { data, phase, err, reload } = useLoader<{ archives: Dict[] }>(() => archiveRegister({}), []);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    if (busy) return;
    setBusy(true); const r = await fn(); setBusy(false);
    if (!r.ok) { flash(closureErr(r.error ?? "")); return; }
    flash(okMsg); void reload();
  }
  const rows = data?.archives ?? [];

  return (
    <Shell phase={phase} err={err} reload={reload} empty={rows.length === 0}>
      <div className="space-y-1.5">
        {rows.map((a) => {
          const hold = a.legal_hold === true;
          const restored = str(a.status) === "restored";   // الاستعادة مرّة واحدة — لا سجلّ تدقيق مكرّر
          return (
            <div key={str(a.id)} className={`${card} p-2.5 flex items-start gap-2 flex-wrap`}>
              <div className="min-w-0 flex-1">
                <Link href={plink(str(a.project_id))} className="text-xs text-stone-100 hover:text-sky-300" dir="auto">{str(a.project_name) || "—"}</Link>
                <div className="text-[10px] text-stone-500">
                  {str(a.status)} · {str(a.archive_policy)} · <span dir="ltr">{str(a.archived_at).slice(0, 10)}</span>
                  {a.retention_until ? <> · {t({ ar: "الاحتفاظ حتى", en: "retain until" })} <span dir="ltr">{str(a.retention_until)}</span></> : null}
                  {hold && <span className="text-amber-400"> · {t({ ar: "حجز قانوني", en: "legal hold" })}</span>}
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                <button disabled={busy} onClick={() => { const r = window.prompt(hold ? t({ ar: "سبب رفع الحجز القانوني (اختياري — إلغاء يوقف الإجراء):", en: "Release reason (optional — cancel aborts):" }) : t({ ar: "سبب الحجز القانوني (اختياري — إلغاء يوقف الإجراء):", en: "Legal hold reason (optional — cancel aborts):" })); if (r === null) return; void act(() => projectArchiveSetLegalHold(str(a.id), !hold, r || undefined), hold ? t({ ar: "رُفع الحجز.", en: "Hold released." }) : t({ ar: "طُبّق الحجز.", en: "Hold applied." })); }}
                  className={`${btn} ${hold ? "border-amber-800 text-amber-300" : "border-stone-700 text-stone-400"} disabled:opacity-40`}>
                  {hold ? t({ ar: "رفع الحجز", en: "Release hold" }) : t({ ar: "حجز قانوني", en: "Legal hold" })}
                </button>
                {/* الاستعادة مرفوضة من الخادم تحت الحجز القانوني — نعطّل الزرّ أيضًا صراحةً */}
                {!restored && <button disabled={busy || hold} title={hold ? t({ ar: "تحت حجز قانوني", en: "Under legal hold" }) : undefined}
                  onClick={() => { const r = window.prompt(t({ ar: "سبب الاستعادة (إلزامي):", en: "Restore reason (required):" })); if (r && r.trim()) void act(() => projectArchiveRestore(str(a.id), r.trim()), t({ ar: "تمت الاستعادة.", en: "Restored." })); }}
                  className={`${btn} border-violet-800 text-violet-300 disabled:opacity-40`}>{t({ ar: "استعادة", en: "Restore" })}</button>}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
