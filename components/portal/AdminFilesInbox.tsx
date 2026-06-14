"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin Client Links & Files. Reads ALL file_links (admin files RLS) + sender
// profiles. Each card opens the submitted URL in a new tab; shows sender,
// label, and created_at. No fake data.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { adminListAllFiles, adminListSenders, type SenderProfile } from "@/lib/portal/admin";
import type { FileLink } from "@/lib/portal/types";

export default function AdminFilesInbox() {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [files, setFiles] = useState<FileLink[]>([]);
  const [senders, setSenders] = useState<Record<string, SenderProfile>>({});
  const [err, setErr] = useState("");

  async function load() {
    const r = await adminListAllFiles();
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setFiles(r.data);
    const ids = Array.from(new Set(r.data.map((f) => f.user_id)));
    const sp = await adminListSenders(ids);
    if (sp.ok) {
      const map: Record<string, SenderProfile> = {};
      sp.data.forEach((p) => { map[p.id] = p; });
      setSenders(map);
    }
    setPhase("ready");
  }
  useEffect(() => { void load(); }, []);

  function senderLine(f: FileLink): string {
    const s = senders[f.user_id];
    if (!s) return f.user_id.slice(0, 8) + "…";
    const name = s.full_name || s.email;
    return s.company ? `${name} · ${s.company}` : name;
  }

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "روابط وملفات العملاء", en: "Client Links & Files" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "الروابط المرسلة من العملاء", en: "Client-Submitted Links" })}
        </h1>
      </div>

      {phase === "loading" && <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "20px 0" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>}
      {phase === "error" && <div className="f-sans" style={{ padding: "14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{err}</div>}
      {phase === "ready" && files.length === 0 && <p className="text-white/45" style={{ fontSize: "14px" }}>{t({ ar: "لا توجد روابط من العملاء بعد.", en: "No client links yet." })}</p>}

      {phase === "ready" && files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {files.map((f) => (
            <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer"
              className="pt-card"
              style={{ display: "block", textDecoration: "none", padding: "15px 18px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", transition: "all 0.3s" }}>
              <div className="flex items-center justify-between gap-3">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="text-white" style={{ fontSize: "14px", fontWeight: 600, marginBottom: "3px" }}>
                    {f.label || t({ ar: "رابط", en: "Link" })}
                  </div>
                  <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", direction: "ltr", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.url}</div>
                  <div className="text-white/40" style={{ fontSize: "11.5px", marginTop: "5px" }}>
                    {senderLine(f)} · <span style={{ direction: "ltr" }}>{new Date(f.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}</span>
                  </div>
                </div>
                <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "#E31E24", border: "1px solid rgba(227,30,36,0.3)", padding: "7px 12px", borderRadius: "2px", whiteSpace: "nowrap" }}>
                  {t({ ar: "فتح ↗", en: "Open ↗" })}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
