"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — «مراقبة الإشعارات» (للإدارة فقط): طابور البريد Outbox —
// الحدث/المستلم/القناة/الحالة/المحاولات/الخطأ/الوقت + إعادة المحاولة/إلغاء المعلّق.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  pcNotifyMonitor, pcEmailRetry, pcEmailCancel, fmtDT, pcErr, EMAIL_STATUS_LABELS,
  type EmailDeliveryRow, type NotifyMonitorData,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-2.5 py-1.5 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";

export function NotifyMonitor({ flash }: { flash: (m: string) => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<NotifyMonitorData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await pcNotifyMonitor(150);
    if (!r.ok) { setErr(pcErr(r.error)); return; }
    setErr(null); setData(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (data?.items ?? []).filter((x) => !fStatus || x.status === fStatus), [data, fStatus]);
  async function act(x: EmailDeliveryRow, action: "retry" | "cancel") {
    if (busy) return; setBusy(x.id);
    const r = action === "retry" ? await pcEmailRetry(x.id) : await pcEmailCancel(x.id);
    setBusy(null);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t(action === "retry" ? { ar: "أُعيد للطابور.", en: "Requeued." } : { ar: "أُلغي.", en: "Cancelled." }));
    void load();
  }
  const stCls: Record<string, string> = {
    sent: "bg-emerald-900/40 text-emerald-300", failed: "bg-red-900/40 text-red-300",
    pending: "bg-amber-900/40 text-amber-300", processing: "bg-sky-900/40 text-sky-300",
    skipped: "bg-stone-800 text-stone-400", bounced: "bg-red-950 text-red-400",
  };
  if (err) return <div className={`${card} p-3 text-xs text-red-400`}>{err}</div>;
  if (!data) return <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(data.counts ?? {}).map(([k, n]) => (
          <button key={k} onClick={() => setFStatus(fStatus === k ? "" : k)}
            className={`px-2 py-0.5 rounded text-[10px] border ${fStatus === k ? "border-red-600 text-white" : "border-stone-700 text-stone-400"}`}>
            {t(EMAIL_STATUS_LABELS[k] ?? { ar: k, en: k })} <span dir="ltr">({n})</span>
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={() => void load()} className={`${btnGhost} px-2.5 py-1 text-[11px]`}>↻ {t({ ar: "تحديث", en: "Refresh" })}</button>
      </div>
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا رسائل في الطابور.", en: "Queue empty." })}</p>}
      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {rows.map((x) => (
          <div key={x.id} className={`${card} p-2.5 text-xs`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${stCls[x.status] ?? "bg-stone-800 text-stone-300"}`}>{t(EMAIL_STATUS_LABELS[x.status] ?? { ar: x.status, en: x.status })}</span>
              {x.severity === "critical" && <span className="text-red-400 text-[10px]">●</span>}
              <span className="text-stone-200 flex-1 min-w-0 truncate">{x.subject}</span>
              <span className="text-[10px] text-stone-500" dir="ltr">{x.recipient_email ?? "—"}</span>
              {x.direct_url && <a href={x.direct_url} className="text-[10px] text-sky-400">{t({ ar: "فتح ←", en: "Open" })}</a>}
              {(x.status === "failed" || x.status === "skipped") && <button disabled={busy === x.id} onClick={() => void act(x, "retry")} className="text-[10px] text-emerald-400">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>}
              {(x.status === "pending" || x.status === "failed") && <button disabled={busy === x.id} onClick={() => void act(x, "cancel")} className="text-[10px] text-stone-500 hover:text-red-400">{t({ ar: "إلغاء", en: "Cancel" })}</button>}
            </div>
            <div className="mt-0.5 text-[10px] text-stone-600 flex gap-3 flex-wrap">
              {x.event_type && <span dir="ltr">{x.event_type}</span>}
              <span dir="ltr">{t({ ar: "محاولات", en: "attempts" })}: {x.attempts}</span>
              <span dir="ltr">{fmtDT(x.created_at)}</span>
              {x.sent_at && <span className="text-emerald-500" dir="ltr">✓ {fmtDT(x.sent_at)}</span>}
              {x.last_error && <span className="text-red-400/80" dir="ltr">{x.last_error}</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-stone-600">{t({ ar: "الإرسال الفعلي عبر كرون /api/cron/notify-email كل 30 دقيقة — يتطلب PROJECT_EMAIL_ALERTS_ENABLED=true وPORTAL_NOTIFY_ENDPOINT على الخادم.", en: "Delivery via cron; requires server env." })}</p>
    </div>
  );
}
