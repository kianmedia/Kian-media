"use client";
// §6 Chronological project timeline. Role-scoped by the server RPC — the client
// only ever receives client-visible events (no financial/staff/internal).
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { projectTimeline, EVENT_LABELS, type TimelineEvent } from "@/lib/portal/timeline";

export default function TimelineView({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void projectTimeline(projectId).then((r) => { if (!alive) return; if (r.ok) setEvents(r.data); else setErr(r.error); });
    return () => { alive = false; };
  }, [projectId]);

  const visColor: Record<string, string> = { admin: "#ff8a8e", internal: "rgba(255,210,138,0.9)", client: "#7CFC9A" };
  const visLabel = (v: string) => v === "admin" ? t({ ar: "إداري", en: "Admin" }) : v === "internal" ? t({ ar: "داخلي", en: "Internal" }) : t({ ar: "مرئي للعميل", en: "Client" });
  const label = (e: TimelineEvent) => { const l = EVENT_LABELS[e.event_type]; return l ? t(l) : e.event_type; };

  if (err) return <p className="text-white/45" style={{ fontSize: "13px" }}>{t({ ar: "تعذّر تحميل السجل.", en: "Couldn't load the timeline." })}</p>;
  if (!events) return <p className="text-white/45" style={{ fontSize: "13px" }}>{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (events.length === 0) return <p className="text-white/45" style={{ fontSize: "13px" }}>{t({ ar: "لا أحداث بعد.", en: "No events yet." })}</p>;

  return (
    <div style={{ position: "relative", paddingInlineStart: "14px" }}>
      <div style={{ position: "absolute", insetInlineStart: "4px", top: 0, bottom: 0, width: "1px", background: "rgba(255,255,255,0.1)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {events.map((e, i) => (
          <div key={i} style={{ position: "relative" }}>
            <span style={{ position: "absolute", insetInlineStart: "-14px", top: "5px", width: "9px", height: "9px", borderRadius: "50%", background: visColor[e.visibility], border: "2px solid #0a0a0a" }} />
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "9px 12px" }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-white/90" style={{ fontSize: "13px", fontWeight: 600 }}>{label(e)}</span>
                <span className="f-sans" style={{ fontSize: "9px", color: visColor[e.visibility], border: `1px solid ${visColor[e.visibility]}44`, borderRadius: "2px", padding: "2px 6px" }}>{visLabel(e.visibility)}</span>
              </div>
              <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "3px" }}>
                {e.actor_name ? `${e.actor_name} · ` : ""}{e.role ? `${e.role} · ` : ""}<span dir="ltr">{new Date(e.ts).toLocaleString("en-GB")}</span>
                {typeof e.meta?.version === "number" ? ` · V${e.meta.version}` : ""}
              </div>
              {typeof e.meta?.note === "string" && e.meta.note ? <div className="text-white/70" style={{ fontSize: "12px", marginTop: "3px" }}>{e.meta.note}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
