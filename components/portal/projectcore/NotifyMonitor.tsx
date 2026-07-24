"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — «مراقبة الإشعارات» (للإدارة فقط).
// Batch 9C: مراقب الرحلة الكاملة (pc_notify_monitor_v2) — لا الطابور فقط:
//   • حالة القناة (نشطة/معطّلة/مجهولة) + نبضة آخر تشغيل كرون + عدّاداته.
//   • صحّة الرحلة: queued-nowhere (بُثّ ولم يُصفّ) · dead-letter · إعادة محاولة · معطّل.
//   • التصنيف حسب الشدّة/النوع + صندوق البوابة.
//   • الطابور نفسه: الحدث/المستلم/الحالة/المحاولات/الخطأ + إعادة المحاولة/الإلغاء.
// يتراجع تلقائيًا إلى العرض القديم (v1) إن لم تُطبَّق 9C بعد.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  pcNotifyMonitorV2, pcNotifyMonitor, pcEmailRetry, pcEmailCancel, fmtDT, pcErr, EMAIL_STATUS_LABELS,
  type EmailDeliveryRow, type NotifyMonitorV2,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";

const EMPTY_V2: NotifyMonitorV2 = {
  items: [], counts: {}, by_severity: {}, by_event: {}, by_channel: { email: 0, portal_7d: 0 },
  portal_inbox: { last7d: 0, unread_30d: 0 }, queued_nowhere: 0, dead_letter: 0, retrying: 0,
  disabled_pending: 0, channel_state: "unknown", last_run: null, generated_at: "",
};

export function NotifyMonitor({ flash }: { flash: (m: string) => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<NotifyMonitorV2 | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await pcNotifyMonitorV2(150);
    if (r.ok) { setErr(null); setLegacy(false); setData(r.data); return; }
    // 9C غير مطبّقة بعد — تراجع إلى الطابور القديم (v1) دون فقد الوظيفة الأساسية.
    const v1 = await pcNotifyMonitor(150);
    if (!v1.ok) { setErr(pcErr(v1.error)); return; }
    setErr(null); setLegacy(true);
    setData({ ...EMPTY_V2, items: v1.data.items, counts: v1.data.counts,
      by_channel: { email: v1.data.items.length, portal_7d: 0 } });
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

  const lr = data.last_run;
  const s = (lr?.stats ?? {}) as Record<string, unknown>;
  const num = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : 0);
  const chBanner =
    data.channel_state === "disabled"
      ? { cls: "bg-amber-950/60 border-amber-800 text-amber-300",
          msg: t({ ar: "قناة البريد معطّلة على الخادم — الرسائل تتراكم بانتظار تفعيل PROJECT_EMAIL_ALERTS_ENABLED. إشعارات البوابة تعمل.", en: "Email channel disabled on server — messages queue until PROJECT_EMAIL_ALERTS_ENABLED is on. Portal notifications still work." }) }
      : data.channel_state === "failing"
      ? { cls: "bg-red-950/60 border-red-800 text-red-300",
          msg: t({ ar: "الكرون يعمل لكن كل إرسالات آخر تشغيل فشلت — راجع الأخطاء و«الفشل النهائيّ» أدناه (عطل مزوّد/تهيئة).", en: "Cron ran but every send in the last run failed — check errors and dead-letter below (provider/config fault)." }) }
      : data.channel_state === "unknown"
      ? { cls: "bg-stone-800/60 border-stone-700 text-stone-400",
          msg: t({ ar: "لم تُسجَّل نبضة كرون بعد — تعذّر تأكيد حالة قناة البريد.", en: "No cron heartbeat recorded yet — email channel state unconfirmed." }) }
      : { cls: "bg-emerald-950/50 border-emerald-800 text-emerald-300",
          msg: t({ ar: "قناة البريد نشطة — آخر تشغيل ناجح للكرون مُسجَّل.", en: "Email channel active — last cron run recorded." }) };

  // شرائح صحّة الرحلة (فوق الطابور) — تكشف ما لا يظهر في الطابور نفسه.
  const health: { k: string; label: { ar: string; en: string }; n: number; cls: string; hint: { ar: string; en: string } }[] = [
    { k: "queued_nowhere", n: data.queued_nowhere, cls: "text-amber-300",
      label: { ar: "بُثّ بلا بريد", en: "Queued nowhere" },
      hint: { ar: "أحداث خرجت للـOutbox دون صفّ بريد (معلوماتية بلا مشترِك) — مرئية هنا فقط.", en: "Events emitted with no email row." } },
    { k: "dead_letter", n: data.dead_letter, cls: "text-red-300",
      label: { ar: "فشل نهائيّ", en: "Dead-letter" }, hint: { ar: "استنفد 5 محاولات — يتطلّب تدخّلًا.", en: "Exhausted 5 attempts." } },
    { k: "retrying", n: data.retrying, cls: "text-sky-300",
      label: { ar: "قيد الإعادة", en: "Retrying" }, hint: { ar: "بانتظار محاولة تالية بـBackoff.", en: "Awaiting backoff retry." } },
    { k: "disabled_pending", n: data.disabled_pending, cls: "text-amber-300",
      label: { ar: "معلّق (قناة معطّلة)", en: "Pending (disabled)" }, hint: { ar: "عالق بسبب disabled/no_endpoint.", en: "Stuck on disabled/no_endpoint." } },
  ];

  return (
    <div className="space-y-2.5">
      {!legacy && (
        <div className={`rounded-lg border px-3 py-2 text-[11px] ${chBanner.cls}`}>{chBanner.msg}</div>
      )}

      {/* نبضة آخر تشغيل + عدّادات الماسحات */}
      {!legacy && (
        <div className={`${card} p-2.5 text-[11px] text-stone-400`}>
          {lr ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-stone-300">{t({ ar: "آخر تشغيل كرون", en: "Last cron run" })}:</span>
              <span dir="ltr">{fmtDT(lr.ran_at)}</span>
              <span className="text-stone-600">·</span>
              <span dir="ltr">{t({ ar: "تذكيرات", en: "reminders" })} {num("reminders")}</span>
              <span dir="ltr">{t({ ar: "موارد", en: "resources" })} {num("resourceAlerts")}</span>
              <span dir="ltr">{t({ ar: "حوكمة", en: "gov" })} {num("govAlerts")}</span>
              <span dir="ltr">SLA {num("slaAlerts")}</span>
              <span className="text-stone-600">·</span>
              <span className="text-emerald-400" dir="ltr">✓ {num("sent")}</span>
              <span className="text-red-400" dir="ltr">✗ {num("failed")}</span>
              <span className="text-stone-500" dir="ltr">{t({ ar: "تُخطّي", en: "skip" })} {num("skipped")}</span>
              <span className="text-stone-600">·</span>
              <span dir="ltr">{t({ ar: "البريد", en: "email" })}: {s.email_enabled ? "on" : "off"}</span>
            </div>
          ) : (
            <span>{t({ ar: "لا نبضة كرون مُسجَّلة بعد.", en: "No cron heartbeat yet." })}</span>
          )}
        </div>
      )}

      {/* شرائح صحّة الرحلة */}
      {!legacy && (
        <div className="flex items-center gap-2 flex-wrap">
          {health.map((h) => (
            <span key={h.k} title={t(h.hint)}
              className={`px-2 py-0.5 rounded text-[10px] border border-stone-700 ${h.n > 0 ? h.cls : "text-stone-500"}`}>
              {t(h.label)} <span dir="ltr">({h.n})</span>
            </span>
          ))}
          <span className="px-2 py-0.5 rounded text-[10px] border border-stone-700 text-stone-500"
            title={t({ ar: "إشعارات البوابة خلال 7 أيام / غير المقروءة 30 يومًا", en: "Portal notifications last 7d / unread 30d" })}>
            {t({ ar: "بوابة", en: "portal" })} <span dir="ltr">({data.portal_inbox.last7d} · {data.portal_inbox.unread_30d} unread)</span>
          </span>
        </div>
      )}

      {/* التصنيف حسب الشدّة/النوع */}
      {!legacy && (Object.keys(data.by_severity).length > 0 || Object.keys(data.by_event).length > 0) && (
        <div className="flex items-start gap-4 flex-wrap text-[10px] text-stone-500">
          {Object.keys(data.by_severity).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-stone-400">{t({ ar: "شدّة", en: "severity" })}:</span>
              {Object.entries(data.by_severity).map(([k, n]) => (
                <span key={k} dir="ltr" className="px-1.5 py-0.5 rounded bg-stone-800">{k} {n}</span>
              ))}
            </div>
          )}
          {Object.keys(data.by_event).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-stone-400">{t({ ar: "أعلى الأنواع", en: "top types" })}:</span>
              {Object.entries(data.by_event).slice(0, 8).map(([k, n]) => (
                <span key={k} dir="ltr" className="px-1.5 py-0.5 rounded bg-stone-800">{k} {n}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* عدّادات الطابور حسب الحالة (تُصفّي القائمة) */}
      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(data.counts ?? {}).map(([k, n]) => (
          <button key={k} onClick={() => setFStatus(fStatus === k ? "" : k)}
            className={`px-2 py-0.5 rounded text-[10px] border ${fStatus === k ? "border-red-600 text-white" : "border-stone-700 text-stone-400"}`}>
            {t(EMAIL_STATUS_LABELS[k] ?? { ar: k, en: k })} <span dir="ltr">({n})</span>
          </button>
        ))}
        <span className="flex-1" />
        {legacy && <span className="text-[10px] text-amber-400/80">{t({ ar: "عرض مبسّط — 9C غير مطبّقة", en: "Basic view — 9C not applied" })}</span>}
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
      <p className="text-[10px] text-stone-600">{t({ ar: "الإرسال الفعلي عبر كرون /api/cron/notify-email — يتطلب PROJECT_EMAIL_ALERTS_ENABLED=true وPORTAL_NOTIFY_ENDPOINT على الخادم. إشعارات البوابة مستقلّة وتعمل دائمًا.", en: "Delivery via cron; requires server env. Portal notifications are independent and always on." })}</p>
    </div>
  );
}
