"use client";
// ════════════════════════════════════════════════════════════════════════════
// ConflictCenter — Phase 4D §6/§7. مركز تعارضات الموارد التفاعلي: يعرض التعارضات
// (نوع/شدة/مورد/الحجز/المشروعان/الوقت/هل يمكن التجاوز/هل سبق تجاوزه) مع إجراءات ذرّية:
// فتح المشروع · تعديل الموعد · إلغاء · تجاوز بسبب · اقتراح مورد بديل. كل تعديل يعيد فحص
// التعارض ويستخدم Optimistic version. لا تعديل لحجز مشروع لا يملك المستخدم الوصول إليه (RPC).
// بيانات حقيقية عبر resource_conflict_center / resource_conflict_resolutions.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  resourceConflictCenter, resourceConflictResolutions, resourceBookingUpdate, resourceBookingCancel, resErr,
  BOOKING_TYPE_LABELS, type BookingType, type ResourceBooking, type BookingConflict, type ConflictResolutions,
} from "@/lib/portal/projectResources";
import ResourceLabel from "./ResourceLabel";

const fmtDT = (iso: string) => { try { return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return iso.slice(0, 16).replace("T", " "); } };
const SEV: Record<string, { ar: string; color: string }> = {
  hard_conflict: { ar: "حاد", color: "#dc2626" }, capacity_conflict: { ar: "سعة", color: "#d97706" },
  availability_conflict: { ar: "عدم توفر", color: "#7c3aed" }, maintenance_conflict: { ar: "صيانة", color: "#0891b2" },
  custody_conflict: { ar: "عهدة", color: "#0284c7" }, soft_warning: { ar: "تحذير", color: "#78716c" },
};

interface Row { booking: ResourceBooking; conflicts: BookingConflict[] }

export default function ConflictCenter({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Record<string, ConflictResolutions>>({});
  const reqSeq = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++reqSeq.current;
    setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        resourceConflictCenter(projectId ? { project_id: projectId } : {}),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("cc_timeout")), 20000); }),
      ]);
      if (!mountedRef.current || my !== reqSeq.current) return;
      if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[conflicts]", r.error); setErr(/not authorized/.test(r.error) ? t({ ar: "لا تملك صلاحية عرض التعارضات.", en: "Not authorized." }) : resErr(r.error)); setPhase("error"); return; }
      setRows((r.data.conflicts ?? []).filter((c) => (c.conflicts ?? []).length > 0));
      setPhase("ready");
    } catch (e) {
      if (!mountedRef.current || my !== reqSeq.current) return;
      setErr(e instanceof Error && e.message === "cc_timeout" ? t({ ar: "انتهت المهلة.", en: "Timed out." }) : resErr(String(e)));
      setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
  }, [projectId, t]);
  useEffect(() => { void load(); }, [load]);

  async function reschedule(b: ResourceBooking) {
    const s = window.prompt(t({ ar: "بداية جديدة (YYYY-MM-DDالتHH:MM):", en: "New start (ISO):" }), b.starts_at.slice(0, 16));
    if (!s) return;
    const e = window.prompt(t({ ar: "نهاية جديدة:", en: "New end (ISO):" }), b.ends_at.slice(0, 16));
    if (!e) return;
    const sd = new Date(s), ed = new Date(e);   // تحقّق قبل أي setBusy — إدخال غير صالح لا يُعلّق الصف
    if (isNaN(sd.getTime()) || isNaN(ed.getTime()) || ed <= sd) { setErr(t({ ar: "تاريخ غير صالح (النهاية بعد البداية).", en: "Invalid date." })); return; }
    setBusy(true);
    const r = await resourceBookingUpdate(b.id, { starts_at: sd.toISOString(), ends_at: ed.toISOString() }, b.version);
    setBusy(false);
    if (!r.ok) { setErr(resErr(r.error)); return; }
    await load();
  }
  async function cancel(b: ResourceBooking) {
    const reason = window.prompt(t({ ar: "سبب الإلغاء:", en: "Cancel reason:" })); if (reason === null) return;
    setBusy(true); const r = await resourceBookingCancel(b.id, reason, b.version); setBusy(false);
    if (!r.ok) { setErr(resErr(r.error)); return; } await load();
  }
  async function override(b: ResourceBooking) {
    const reason = window.prompt(t({ ar: "سبب التجاوز (إلزامي):", en: "Override reason (required):" }));
    if (!reason || !reason.trim()) return;
    setBusy(true);
    const r = await resourceBookingUpdate(b.id, { override: true, override_reason: reason }, b.version);
    setBusy(false);
    if (!r.ok) { setErr(resErr(r.error)); return; } await load();
  }
  async function suggest(b: ResourceBooking) {
    if (res[b.id]) { setRes((s) => { const n = { ...s }; delete n[b.id]; return n; }); return; }
    const r = await resourceConflictResolutions(b.id);
    if (!r.ok) { setErr(resErr(r.error)); return; }
    setRes((s) => ({ ...s, [b.id]: r.data }));
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-auto p-3 sm:p-4" onClick={onClose}>
      <div className="bg-stone-950 border border-stone-800 rounded-2xl w-full max-w-4xl my-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-stone-800">
          <h3 className="text-sm font-semibold text-stone-100">{t({ ar: "مركز تعارضات الموارد", en: "Resource Conflict Center" })}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} className="text-xs text-stone-400 hover:text-white">↻</button>
            <button onClick={onClose} className="text-stone-400 hover:text-white text-sm" aria-label="close">✕</button>
          </div>
        </div>
        <div className="p-4 space-y-2">
          {phase === "loading" && <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ الفحص…", en: "Scanning…" })}</p>}
          {phase === "error" && <div className="py-8 text-center space-y-2"><p className="text-sm text-red-300">{err}</p><button onClick={() => void load()} className="text-xs bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-stone-200">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button></div>}
          {phase === "ready" && rows.length === 0 && (
            <div className="py-10 text-center space-y-1">
              <p className="text-2xl">✓</p>
              <p className="text-sm text-green-300">{t({ ar: "لا تعارضات حاجبة في هذه الفترة.", en: "No blocking conflicts in range." })}</p>
              <p className="text-[11px] text-stone-500">{t({ ar: "قد توجد تعارضات خارج الفترة الافتراضية (٦٠ يومًا).", en: "Conflicts may exist outside the default 60-day range." })}</p>
            </div>
          )}
          {err && phase === "ready" && <p className="text-[11px] text-red-400">{err}</p>}
          {rows.map(({ booking: b, conflicts }) => (
            <div key={b.id} className="border border-stone-800 rounded-xl p-2.5 bg-stone-900/40 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <ResourceLabel r={b.resource} sub={`${BOOKING_TYPE_LABELS[b.booking_type as BookingType]} · ${fmtDT(b.starts_at)}→${fmtDT(b.ends_at)}`} />
                <div className="flex items-center gap-1 flex-wrap">
                  {b.conflict_override_by && <span className="text-[9px] text-amber-400 border border-amber-800 rounded px-1">{t({ ar: "سبق تجاوزه", en: "overridden" })}</span>}
                  {Array.from(new Set(conflicts.map((c) => c.severity))).map((s) => <span key={s} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: (SEV[s]?.color ?? "#78716c") + "22", color: SEV[s]?.color ?? "#78716c" }}>{SEV[s]?.ar ?? s}</span>)}
                </div>
              </div>
              <ul className="text-[10px] text-stone-400 space-y-0.5">
                {conflicts.map((c, i) => <li key={i}>· {c.explanation_ar}{c.project_id && c.project_id !== b.project_id ? ` (${t({ ar: "مشروع آخر", en: "other project" })})` : ""}</li>)}
              </ul>
              <div className="flex items-center gap-2 flex-wrap text-[10px]">
                {b.project_id && <a href={`/client-portal/project-core/${b.project_id}?tab=resources`} className="text-sky-300 hover:text-sky-200">{t({ ar: "فتح المشروع", en: "Open project" })}</a>}
                <button disabled={busy} onClick={() => void reschedule(b)} className="text-stone-300 hover:text-white disabled:opacity-50">{t({ ar: "تعديل الموعد", en: "Reschedule" })}</button>
                <button disabled={busy} onClick={() => void suggest(b)} className="text-violet-300 hover:text-violet-200 disabled:opacity-50">{t({ ar: "مورد بديل", en: "Alternatives" })}</button>
                {conflicts.some((c) => c.can_override) && <button disabled={busy} onClick={() => void override(b)} className="text-amber-300 hover:text-amber-200 disabled:opacity-50">{t({ ar: "تجاوز بسبب", en: "Override" })}</button>}
                <button disabled={busy} onClick={() => void cancel(b)} className="text-red-400 hover:text-red-300 disabled:opacity-50">{t({ ar: "إلغاء الحجز", en: "Cancel" })}</button>
              </div>
              {res[b.id] && (
                <div className="border-t border-stone-800 pt-1.5 space-y-1">
                  <p className="text-[9px] text-stone-500">{res[b.id].note_ar}</p>
                  {res[b.id].resolutions.alternative_resources.filter((a) => a.available).slice(0, 5).map((a) => (
                    <div key={a.resource.id} className="flex items-center justify-between gap-2">
                      <ResourceLabel r={a.resource} size="xs" sub={a.reason_ar} />
                      <span className="text-[9px] text-green-400 shrink-0">{t({ ar: "متاح", en: "available" })}</span>
                    </div>
                  ))}
                  {res[b.id].resolutions.alternative_resources.filter((a) => a.available).length === 0 && <p className="text-[9px] text-stone-500">{t({ ar: "لا مورد بديل متاح في نفس الموعد.", en: "No alternative available." })}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
