"use client";
// ════════════════════════════════════════════════════════════════════════
// Client "My Requests" — the website submissions (quote / meeting / call / files)
// the signed-in user made, matched by their VERIFIED email. On mount it links any
// guest submissions made before signup. Shows the reassuring "estimate is coming"
// message so a client with a request never sees a bare "no quotes" state.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listMyIntake, linkMyRecords, INTAKE_TYPE_LABELS, INTAKE_STATUS_LABELS, type PublicIntake } from "@/lib/portal/intake";
import { safeShortId } from "@/lib/portal/safe";

function timeShort(iso: string, isAr: boolean) {
  try { return new Date(iso).toLocaleDateString(isAr ? "ar-SA" : "en-GB"); } catch { return ""; }
}

export default function MyRequests() {
  const { t, isAr } = useI18n();
  const [rows, setRows] = useState<PublicIntake[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listMyIntake();
    if (r.ok) setRows(r.data);
    setPhase("ready");
  }, []);
  useEffect(() => {
    // Link guest submissions made before signup, then load (RLS shows them by email anyway).
    (async () => { try { await linkMyRecords(); } catch { /* non-blocking */ } await load(); })();
  }, [load]);

  if (phase === "ready" && rows.length === 0) return null; // nothing to show; the quotes list owns the empty state

  return (
    <div style={{ marginBottom: 28 }}>
      <div className="eyebrow mb-1">{t({ ar: "طلباتي", en: "My Requests" })}</div>
      <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 12.5, margin: "0 0 14px", lineHeight: 1.7 }}>
        {t({ ar: "تم استلام طلبك، وسيظهر عرض السعر هنا بعد مراجعته واعتماده من فريق كيان.", en: "Your request was received — the quote will appear here after Kian's team reviews and approves it." })}
      </p>

      {phase === "loading" ? (
        <p className="text-white/45" style={{ fontSize: 13.5 }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => {
            const open = openId === r.id;
            const typeL = INTAKE_TYPE_LABELS[r.request_type] ?? INTAKE_TYPE_LABELS.other;
            const statL = INTAKE_STATUS_LABELS[r.status] ?? { ar: r.status, en: r.status };
            return (
              <div key={r.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, overflow: "hidden" }}>
                <button onClick={() => setOpenId(open ? null : r.id)} style={{ width: "100%", textAlign: isAr ? "right" : "left", background: "transparent", border: "none", cursor: "pointer", padding: "12px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ color: "#fff", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }}>{r.reference || safeShortId(r.id)}</strong>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "rgba(227,30,36,0.16)", color: "#ff9ea1" }}>{t(typeL)}</span>
                  {(r.services?.length ?? 0) > 0 && <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 12.5 }}>{r.services!.join("، ")}</span>}
                  <span style={{ marginInlineStart: "auto", color: "rgba(255,255,255,0.45)", fontSize: 11.5 }}>{t(statL)} · {timeShort(r.created_at, isAr)}</span>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>{open ? "▲" : "▼"}</span>
                </button>
                {open && (
                  <div style={{ padding: "0 16px 14px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, paddingTop: 12 }}>
                    {r.city && <Cell l={t({ ar: "المدينة", en: "City" })} v={r.city} />}
                    {r.preferred_date && <Cell l={t({ ar: "التاريخ المفضّل", en: "Preferred date" })} v={r.preferred_date} />}
                    {r.preferred_contact && <Cell l={t({ ar: "طريقة التواصل", en: "Contact" })} v={r.preferred_contact} />}
                    {r.phone && <Cell l={t({ ar: "الجوال", en: "Phone" })} v={r.phone} />}
                    {r.details && <div style={{ width: "100%", color: "rgba(255,255,255,0.65)", fontStyle: "italic" }}>“{r.details}”</div>}
                    {(r.file_links?.length ?? 0) > 0 && (
                      <div style={{ width: "100%", display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>{t({ ar: "الملفات", en: "Files" })}:</span>
                        {r.file_links!.map((fl, i) => (
                          <a key={i} href={fl.url} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }}>{fl.label || `link ${i + 1}`} ↗</a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cell({ l, v }: { l: string; v: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "baseline" }}>
      <span style={{ color: "rgba(255,255,255,0.4)" }}>{l}:</span>
      <span style={{ color: "rgba(255,255,255,0.85)" }}>{v}</span>
    </span>
  );
}
