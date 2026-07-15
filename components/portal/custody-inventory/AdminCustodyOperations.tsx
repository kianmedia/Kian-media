"use client";
// ════════════════════════════════════════════════════════════════════════════
// مركز إدارة العهد والإرجاع (نظام مخزون الأصول). قراءة مُثرّاة عبر
// custody_admin_custody_dashboard: اسم الموظف/وظيفته/جواله + اسم المعدة/كودها +
// حساب التأخير + عدّادات — بدل UUID والحالات التقنية. بحث/فلاتر + Drawer تفاصيل +
// فحص الإرجاع (civInspectReturn الموجود). owner/super_admin/admin/manager/custody_officer.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { formatRiyadh } from "@/lib/portal/rentalTime";
import {
  civAdminCustodyDashboard, civInspectReturn, civSignFiles, CIV_ASSETS_BUCKET,
  civAdminConfirmAssignment, civAdminStartReturn, civAdminResendConfirmation, civAdminCancelAssignment,
  type CustodyDashboard, type CustodyDashRow, type CustodyDashItem, type CivInspectResult,
} from "@/lib/portal/custodyInventory";

// الحالة → عربي + لون
const STATUS: Record<string, { ar: string; cls: string }> = {
  draft:                          { ar: "مسودّة",              cls: "text-stone-400 border-stone-600" },
  pending_employee_confirmation:  { ar: "بانتظار تأكيد الموظف", cls: "text-amber-300 border-amber-700" },
  active:                         { ar: "نشطة",                cls: "text-emerald-300 border-emerald-700" },
  return_requested:               { ar: "طلب إرجاع",           cls: "text-sky-300 border-sky-700" },
  under_inspection:               { ar: "تحت الفحص",           cls: "text-indigo-300 border-indigo-700" },
  partially_returned:             { ar: "إرجاع جزئي",          cls: "text-amber-300 border-amber-700" },
  returned:                       { ar: "مُرجعة",              cls: "text-stone-300 border-stone-600" },
  rejected:                       { ar: "مرفوضة",              cls: "text-red-300 border-red-800" },
  disputed:                       { ar: "متنازع عليها",        cls: "text-red-300 border-red-800" },
  cancelled:                      { ar: "ملغاة",               cls: "text-stone-500 border-stone-700" },
};
const COND_AR: Record<string, string> = {
  new: "جديدة", excellent: "ممتازة", good: "جيدة", fair: "مقبولة", damaged: "تالفة",
  under_maintenance: "تحت الصيانة", lost: "مفقودة", retired: "مشطوبة",
};
const INSPECT_OPTS: { v: CivInspectResult; ar: string }[] = [
  { v: "accepted_good", ar: "سليمة — قبول" }, { v: "accepted_damaged", ar: "تالفة — قبول" },
  { v: "maintenance_required", ar: "تحتاج صيانة" }, { v: "missing", ar: "مفقودة" },
  { v: "rejected_return", ar: "رفض الإرجاع" }, { v: "partial_return", ar: "إرجاع جزئي" },
];

function mapAdminErr(e: string): string {
  if (/could not find|schema cache|PGRST\d|does not exist|function/i.test(e)) return "الخدمة غير مطبّقة في قاعدة البيانات — شغّل custody_confirmation_return_FINAL_FIX_RUNME.sql.";
  if (/not authorized|permission denied/i.test(e)) return "لا تملك صلاحية تنفيذ هذا الإجراء.";
  if (/handover_evidence_required/.test(e)) return "لا يمكن التأكيد بلا صور تسليم للعهدة.";
  if (/reason_required/.test(e)) return "السبب إلزامي.";
  if (/not_pending/.test(e)) return "العهدة لم تعد بانتظار التأكيد.";
  if (/not_active/.test(e)) return "العهدة ليست نشطة الآن.";
  if (/cannot_cancel_after_confirmation/.test(e)) return "لا يمكن الإلغاء بعد التأكيد — استخدم بدء الإرجاع.";
  if (/not_found/.test(e)) return "العهدة غير موجودة.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}
function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d} يوم${h > 0 ? ` و${h} ساعة` : ""}`;
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} ساعة${m > 0 ? ` و${m} دقيقة` : ""}`;
  return `${m} دقيقة`;
}

const CARD = "bg-stone-900 border border-stone-800 rounded-xl";
const BTN_GHOST = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-xs disabled:opacity-50";
const BTN_RED = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium";

export default function AdminCustodyOperations() {
  const { t } = useI18n();
  const [data, setData] = useState<CustodyDashboard | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "not_prepared">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3600); };

  const load = useCallback(async () => {
    setPhase("loading");
    const r = await civAdminCustodyDashboard({ status: status || undefined, search: search || undefined, overdueOnly });
    if (!r.ok) {
      setErrMsg(r.error);
      setPhase(/could not find|schema cache|PGRST\d|does not exist|function/i.test(r.error) ? "not_prepared" : "error");
      return;
    }
    setData(r.data);
    setPhase("ready");
  }, [status, overdueOnly, search]);
  useEffect(() => { void load(); }, [status, overdueOnly]);   // البحث يدويًا بزر

  const c = data?.counters ?? {};
  const open = data?.rows.find((r) => r.custody_id === openId) || null;

  const chips: { k: string; ar: string; n: number; filter?: () => void }[] = [
    { k: "total_active", ar: "عهد نشطة", n: c.total_active ?? 0, filter: () => { setStatus(""); setOverdueOnly(false); } },
    { k: "pending_confirm", ar: "بانتظار تأكيد الموظف", n: c.pending_confirm ?? 0, filter: () => { setStatus("pending_employee_confirmation"); setOverdueOnly(false); } },
    { k: "due_today", ar: "مستحقة اليوم", n: c.due_today ?? 0 },
    { k: "overdue", ar: "متأخرة", n: c.overdue ?? 0, filter: () => { setStatus(""); setOverdueOnly(true); } },
    { k: "return_requested", ar: "طلبات إرجاع", n: c.return_requested ?? 0, filter: () => { setStatus("return_requested"); setOverdueOnly(false); } },
    { k: "under_inspection", ar: "تحت الفحص", n: c.under_inspection ?? 0, filter: () => { setStatus("under_inspection"); setOverdueOnly(false); } },
  ];

  return (
    <div className="space-y-3">
      {/* لوحة المؤشرات */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {chips.map((ch) => (
          <button key={ch.k} onClick={ch.filter} disabled={!ch.filter}
            className={`${CARD} p-3 text-center ${ch.filter ? "hover:border-red-700 cursor-pointer" : "cursor-default opacity-90"}`}>
            <div className="text-xl font-bold text-white">{ch.n}</div>
            <div className="text-[11px] text-stone-400 mt-0.5">{ch.ar}</div>
          </button>
        ))}
      </div>

      {/* بحث + فلاتر */}
      <div className={`${CARD} p-3 flex flex-wrap items-center gap-2`}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(); }}
          placeholder={t({ ar: "بحث: موظف / جوال / معدة / كود / رقم العهدة / مشروع", en: "Search…" })}
          className="flex-1 min-w-[220px] bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="bg-stone-800 border border-stone-700 rounded-lg px-2 py-1.5 text-xs text-stone-200" style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "كل الحالات", en: "All statuses" })}</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-stone-300">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> {t({ ar: "المتأخر فقط", en: "Overdue only" })}
        </label>
        <button onClick={() => void load()} className={`${BTN_GHOST} px-3 py-1.5`}>{t({ ar: "بحث", en: "Search" })}</button>
        <button onClick={() => { setSearch(""); setStatus(""); setOverdueOnly(false); }} className={`${BTN_GHOST} px-3 py-1.5`}>{t({ ar: "مسح", en: "Reset" })}</button>
      </div>

      {phase === "loading" && <p className="text-xs text-stone-500 text-center py-8">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {phase === "not_prepared" && (
        <div className={`${CARD} p-4 text-sm text-amber-300 space-y-1`} dir="rtl">
          <div>مركز إدارة العهد غير مُجهّز في قاعدة البيانات بعد.</div>
          <div className="font-mono text-[11px] text-amber-400/90" dir="ltr">Run: docs/custody_admin_operations_FINAL_RUNME.sql</div>
        </div>
      )}
      {phase === "error" && <div className={`${CARD} p-4 text-sm text-red-300`}>{t({ ar: "تعذّر التحميل: ", en: "Failed: " })}<span dir="ltr">{errMsg}</span></div>}
      {phase === "ready" && (data?.rows.length ?? 0) === 0 && <div className={`${CARD} p-6 text-sm text-stone-400 text-center`}>{t({ ar: "لا توجد عهد مطابقة.", en: "No matching custody records." })}</div>}

      {phase === "ready" && data!.rows.map((r) => <CustodyCard key={r.custody_id} r={r} onOpen={() => setOpenId(r.custody_id)} />)}

      {open && <CustodyDrawer r={open} onClose={() => setOpenId(null)} onChanged={load} flash={flash} />}
      {toast && <div className="fixed bottom-4 inset-x-4 z-[70] mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}

function StatusBadge({ status, overdue }: { status: string; overdue: number }) {
  if (overdue > 0 && ["active", "return_requested", "under_inspection"].includes(status))
    return <span className="text-[10px] px-2 py-0.5 rounded border text-red-300 border-red-800">متأخرة</span>;
  const s = STATUS[status] ?? { ar: status, cls: "text-stone-400 border-stone-600" };
  return <span className={`text-[10px] px-2 py-0.5 rounded border ${s.cls}`}>{s.ar}</span>;
}

function Initials({ name }: { name: string }) {
  const init = (name || "؟").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  return <div className="w-9 h-9 rounded-full bg-stone-700 border border-stone-600 flex items-center justify-center text-xs text-stone-200 shrink-0">{init}</div>;
}

function CustodyCard({ r, onOpen }: { r: CustodyDashRow; onOpen: () => void }) {
  const primary = r.items?.[0];
  const more = (r.item_count || 0) - 1;
  return (
    <div className={`${CARD} p-3`}>
      <div className="flex items-start gap-3">
        <Initials name={r.employee_name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{r.employee_name}</span>
            <StatusBadge status={r.status} overdue={r.overdue_seconds} />
            {r.issue_count > 0 && <span className="text-[10px] px-2 py-0.5 rounded border text-red-300 border-red-800">⚠ تلف/نقص</span>}
            <span className="font-mono text-[10px] text-stone-500" dir="ltr">{r.custody_number}</span>
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">
            {[r.employee_job_title, r.employee_department].filter(Boolean).join(" · ")}
            {r.employee_mobile ? <span dir="ltr"> · {r.employee_mobile}</span> : null}
          </div>
          <div className="text-xs text-stone-300 mt-1.5">
            {primary ? <>{primary.asset_name} <span className="text-stone-500" dir="ltr">({primary.asset_code})</span>{primary.serial_number ? <span className="text-stone-500" dir="ltr"> · SN {primary.serial_number}</span> : null}{more > 0 ? <span className="text-stone-500"> +{more}</span> : null}</> : <span className="text-stone-500">لا توجد معدات</span>}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-[11px] text-stone-400 mt-1.5">
            <span>الصرف: <span dir="ltr">{formatRiyadh(r.issued_at)}</span></span>
            <span>الإرجاع: <span dir="ltr">{formatRiyadh(r.expected_return_at)}</span></span>
            {r.overdue_seconds > 0
              ? <span className="text-red-400">متأخرة {fmtDuration(r.overdue_seconds)}</span>
              : r.remaining_seconds > 0 ? <span className="text-emerald-400">متبقٍ {fmtDuration(r.remaining_seconds)}</span> : null}
            {r.project_name ? <span>· {r.project_name}</span> : null}
            {r.status === "pending_employee_confirmation" ? <span className="text-amber-400">لم يؤكّد الموظف بعد</span> : null}
          </div>
        </div>
        <button onClick={onOpen} className={`${BTN_GHOST} px-3 py-1.5 shrink-0`}>تفاصيل</button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === "") return null;
  return <div className="flex justify-between gap-3 text-xs py-1 border-b border-stone-800/60"><span className="text-stone-500">{k}</span><span className="text-stone-200 text-left" dir="auto">{v}</span></div>;
}

function CustodyDrawer({ r, onClose, onChanged, flash }: { r: CustodyDashRow; onClose: () => void; onChanged: () => Promise<void>; flash: (m: string) => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [inspecting, setInspecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, CivInspectResult>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    const paths = (r.items || []).map((i) => i.photo_path).filter((p): p is string => !!p);
    if (paths.length) void civSignFiles(CIV_ASSETS_BUCKET, paths).then(setUrls);
  }, [r.custody_id]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submitInspect() {
    if (busy) return;
    const items = (r.items || []).map((i) => ({
      assignment_item_id: i.item_id,
      result: results[i.item_id] ?? ("accepted_good" as CivInspectResult),
      quantity: i.quantity,
      note: notes[i.item_id]?.trim() || undefined,
    }));
    if (items.length === 0) { flash("لا توجد بنود للفحص."); return; }
    setBusy(true);
    const res = await civInspectReturn(r.custody_id, items);
    setBusy(false);
    if (!res.ok) { flash(/could not find|schema|PGRST/i.test(res.error) ? "خدمة الفحص غير مطبّقة في قاعدة البيانات." : /not authorized|permission/i.test(res.error) ? "لا تملك صلاحية الفحص." : "تعذّر تنفيذ الفحص."); return; }
    flash(res.data.closed ? "تم الفحص وأُغلقت العهدة." : "تم تسجيل الفحص.");
    setInspecting(false);
    await onChanged();
    onClose();
  }

  async function doAdmin(action: "confirm" | "resend" | "start_return" | "cancel") {
    if (busy) return;
    let reason = "";
    if (action !== "resend") {
      const p = window.prompt(
        action === "confirm" ? "سبب التأكيد الإداري (إلزامي — لا يُزوَّر توقيع الموظف):"
        : action === "cancel" ? "سبب إلغاء التسليم (إلزامي — تُرجَع المعدات للمخزون):"
        : "سبب بدء الإرجاع نيابة عن الموظف (إلزامي):");
      if (p === null) return;
      if (!p.trim()) { flash("السبب إلزامي."); return; }
      reason = p.trim();
    }
    setBusy(true);
    const res =
      action === "confirm"      ? await civAdminConfirmAssignment(r.custody_id, r.employee_name, reason)
      : action === "resend"     ? await civAdminResendConfirmation(r.custody_id)
      : action === "start_return" ? await civAdminStartReturn(r.custody_id, reason)
      :                           await civAdminCancelAssignment(r.custody_id, reason);
    setBusy(false);
    if (!res.ok) { flash(mapAdminErr(res.error)); return; }
    flash(action === "confirm" ? "تم التأكيد إداريًا." : action === "resend" ? "أُرسل التذكير للموظف." : action === "start_return" ? "بدأ إجراء الإرجاع." : "أُلغي التسليم وأُرجعت المعدات.");
    await onChanged();
    onClose();
  }

  const canInspect = ["return_requested", "under_inspection"].includes(r.status);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl my-4 bg-stone-950 border border-stone-800 rounded-2xl shadow-2xl" onMouseDown={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-800 sticky top-0 bg-stone-950 rounded-t-2xl z-10">
          <div className="min-w-0 flex items-center gap-2">
            <Initials name={r.employee_name} />
            <div>
              <div className="text-sm font-semibold text-white">{r.employee_name}</div>
              <div className="font-mono text-[11px] text-stone-500" dir="ltr">{r.custody_number}</div>
            </div>
            <StatusBadge status={r.status} overdue={r.overdue_seconds} />
          </div>
          <button onClick={onClose} className={`${BTN_GHOST} px-3 py-1`}>✕ إغلاق</button>
        </div>

        <div className="p-4 space-y-4">
          {/* الموظف */}
          <section>
            <h3 className="text-xs font-medium text-stone-400 mb-1">بيانات الموظف</h3>
            <div className={`${CARD} p-3`}>
              <Row k="الاسم" v={r.employee_name} />
              <Row k="المسمى الوظيفي" v={r.employee_job_title} />
              <Row k="القسم" v={r.employee_department} />
              <Row k="الجوال" v={r.employee_mobile ? <span dir="ltr">{r.employee_mobile}</span> : null} />
              <Row k="البريد" v={r.employee_email ? <span dir="ltr">{r.employee_email}</span> : null} />
              <Row k="حالة الحساب" v={r.employee_account_status} />
            </div>
          </section>

          {/* العهدة */}
          <section>
            <h3 className="text-xs font-medium text-stone-400 mb-1">بيانات العهدة</h3>
            <div className={`${CARD} p-3`}>
              <Row k="رقم العهدة" v={<span className="font-mono" dir="ltr">{r.custody_number}</span>} />
              <Row k="الحالة" v={<StatusBadge status={r.status} overdue={r.overdue_seconds} />} />
              <Row k="النوع" v={r.assignment_type} />
              <Row k="الغرض" v={r.purpose} />
              <Row k="المشروع" v={r.project_name} />
              <Row k="وقت الصرف" v={<span dir="ltr">{formatRiyadh(r.issued_at)}</span>} />
              <Row k="موعد الإرجاع" v={<span dir="ltr">{formatRiyadh(r.expected_return_at)}</span>} />
              <Row k="تأكيد الموظف" v={r.employee_confirmed ? <span className="text-emerald-400">مؤكَّد · {formatRiyadh(r.employee_confirmed_at)}</span> : <span className="text-amber-400">بانتظار التأكيد</span>} />
              <Row k={r.overdue_seconds > 0 ? "مدة التأخير" : "الوقت المتبقي"} v={r.overdue_seconds > 0 ? <span className="text-red-400">{fmtDuration(r.overdue_seconds)}</span> : r.remaining_seconds > 0 ? <span className="text-emerald-400">{fmtDuration(r.remaining_seconds)}</span> : "—"} />
            </div>
          </section>

          {/* المعدات */}
          <section>
            <h3 className="text-xs font-medium text-stone-400 mb-1">المعدات ({r.item_count})</h3>
            <div className="space-y-2">
              {(r.items || []).map((i: CustodyDashItem) => (
                <div key={i.item_id} className={`${CARD} p-2 flex items-center gap-2`}>
                  {i.photo_path && urls[i.photo_path]
                    ? <img src={urls[i.photo_path]} alt="" className="w-12 h-12 object-cover rounded border border-stone-700" />
                    : <div className="w-12 h-12 rounded bg-stone-800 border border-stone-700 flex items-center justify-center text-stone-600">📦</div>}
                  <div className="flex-1 min-w-0 text-xs">
                    <div className="text-stone-200">{i.asset_name} <span className="text-stone-500" dir="ltr">({i.asset_code})</span></div>
                    <div className="text-[11px] text-stone-500" dir="ltr">{[i.serial_number ? `SN ${i.serial_number}` : "", i.brand, i.model].filter(Boolean).join(" · ")}</div>
                    <div className="text-[11px] text-stone-400 mt-0.5">
                      الكمية: {i.quantity}{i.quantity_returned ? ` · مُرجَع: ${i.quantity_returned}` : ""}
                      {i.condition_at_issue ? ` · عند الصرف: ${COND_AR[i.condition_at_issue] ?? i.condition_at_issue}` : ""}
                      {i.condition_at_return ? ` · عند الإرجاع: ${COND_AR[i.condition_at_return] ?? i.condition_at_return}` : ""}
                    </div>
                  </div>
                  {inspecting && canInspect && (
                    <div className="flex flex-col gap-1 shrink-0 w-40">
                      <select value={results[i.item_id] ?? "accepted_good"} onChange={(e) => setResults((p) => ({ ...p, [i.item_id]: e.target.value as CivInspectResult }))}
                        className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-[11px] text-stone-200" style={{ colorScheme: "dark" }}>
                        {INSPECT_OPTS.map((o) => <option key={o.v} value={o.v}>{o.ar}</option>)}
                      </select>
                      <input value={notes[i.item_id] ?? ""} onChange={(e) => setNotes((p) => ({ ...p, [i.item_id]: e.target.value }))} placeholder="ملاحظة"
                        className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-[11px] text-stone-200" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* إجراءات إدارية حسب الحالة */}
          {(r.status === "pending_employee_confirmation" || r.status === "active") && (
            <section className="flex flex-wrap gap-2">
              {r.status === "pending_employee_confirmation" && <>
                <button disabled={busy} onClick={() => void doAdmin("confirm")} className={`${BTN_RED} px-4 py-2`}>تأكيد إداري</button>
                <button disabled={busy} onClick={() => void doAdmin("resend")} className={`${BTN_GHOST} px-4 py-2`}>إعادة إرسال التأكيد</button>
                <button disabled={busy} onClick={() => void doAdmin("cancel")} className={`${BTN_GHOST} px-4 py-2 text-red-400 border-red-900/60`}>إلغاء التسليم</button>
              </>}
              {r.status === "active" && <button disabled={busy} onClick={() => void doAdmin("start_return")} className={`${BTN_RED} px-4 py-2`}>بدء إرجاع العهدة</button>}
            </section>
          )}

          {/* إجراء الفحص (return_requested / under_inspection) */}
          {canInspect && (
            <section className="flex gap-2">
              {!inspecting
                ? <button onClick={() => setInspecting(true)} className={`${BTN_RED} px-4 py-2`}>بدء فحص الإرجاع</button>
                : <>
                    <button disabled={busy} onClick={() => void submitInspect()} className={`${BTN_RED} px-4 py-2`}>{busy ? "…" : "اعتماد الفحص"}</button>
                    <button disabled={busy} onClick={() => setInspecting(false)} className={`${BTN_GHOST} px-4 py-2`}>إلغاء</button>
                  </>}
            </section>
          )}
          <p className="text-[10px] text-stone-600">الإجراءات المالية واعتماد المسؤولية لا يعتمدها أمين العهدة منفردًا — تُنفَّذ عبر الإدارة/المالية.</p>
        </div>
      </div>
    </div>
  );
}
