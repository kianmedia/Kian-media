"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/mfa-diagnostics — TEMPORARY, OWNER-ONLY diagnostic page.
//
// Its single job: prove whether Postgres can see the JWT's `aal` claim from a REAL
// portal session, before any MFA enforcement is designed. It calls
// GET /api/admin/mfa-probe with the live session token; that route re-checks
// is_owner() server-side, and mfa_claim_probe() checks it a third time in SQL.
//
// This page is NOT a security boundary — the route and the SQL function are. It is
// here because the question cannot be answered from the Supabase SQL editor: that
// runs as `postgres` with no session token, so request.jwt.claims is empty there and
// the probe would report aal = null for an unrelated reason.
//
// Nothing here renders or stores the access token. Delete this page once the
// assurance question is settled.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { getValidSession } from "@/lib/portalAuth";
import { useI18n } from "@/lib/i18n";

type Probe = Record<string, unknown>;

export default function MfaDiagnosticsPage() {
  const { t, isAr } = useI18n();
  const [out, setOut] = useState<Probe | null>(null);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setErr(""); setOut(null);
    try {
      const s = await getValidSession();
      if (!s) { setErr(t({ ar: "لا توجد جلسة — سجّل الدخول أولًا.", en: "No session — sign in first." })); return; }
      const res = await fetch("/api/admin/mfa-probe", {
        headers: { Authorization: `Bearer ${s.access_token}` },
        cache: "no-store",
      });
      if (res.status === 403) {
        setErr(t({ ar: "هذه الصفحة للمالك فقط.", en: "This page is owner-only." }));
        return;
      }
      const d = (await res.json()) as { ok?: boolean; probe?: Probe; error?: string; hint?: string };
      if (!d.ok) { setErr(`${d.error ?? "failed"}${d.hint ? ` — ${d.hint}` : ""}`); return; }
      setOut(d.probe ?? {});
    } catch {
      setErr(t({ ar: "تعذّر تنفيذ الفحص.", en: "The check could not run." }));
    } finally { setBusy(false); }
  }

  const aal = out ? String(out.aal ?? "") : "";
  const claimsPresent = out ? out.claims_present === true : false;

  return (
    <div dir={isAr ? "rtl" : "ltr"} style={{ maxWidth: 720, margin: "0 auto", padding: "28px 18px" }}>
      <h1 className="editorial text-white" style={{ fontSize: 24, marginBottom: 8 }}>
        {t({ ar: "فحص ادّعاءات الجلسة (MFA)", en: "Session claim diagnostic (MFA)" })}
      </h1>
      <p className="text-white/60" style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 18 }}>
        {t({
          ar: "يُثبت هذا الفحص ما إذا كانت قاعدة البيانات ترى ادّعاءات جلستك الحقيقية — وأهمها aal. لا يمكن الحصول على هذه الإجابة من محرّر SQL، لأنه يعمل بدور postgres بلا رمز جلسة.",
          en: "This proves whether the database can see your real session's claims — above all aal. The Supabase SQL editor cannot answer this: it runs as the postgres role with no session token.",
        })}
      </p>

      <button onClick={run} disabled={busy} className="btn-red"
        style={{ justifyContent: "center", opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>
        <span>{busy ? "…" : t({ ar: "تشغيل الفحص", en: "Run the check" })}</span>
      </button>

      {err && <p style={{ marginTop: 16, color: "#ff6b6b", fontSize: 14 }} dir="ltr">{err}</p>}

      {out && (
        <div style={{ marginTop: 22 }}>
          <div style={{
            padding: "12px 16px", borderRadius: 4, marginBottom: 14,
            background: aal ? "rgba(16,185,129,0.10)" : "rgba(245,158,11,0.10)",
            border: `1px solid ${aal ? "rgba(16,185,129,0.35)" : "rgba(245,158,11,0.35)"}`,
            color: aal ? "#6ee7b7" : "#fcd34d", fontSize: 14, lineHeight: 1.7,
          }}>
            {aal
              ? t({
                  ar: `النتيجة: قاعدة البيانات ترى aal = ${aal}. يمكن بناء بوّابات الكتابة على auth.jwt()->>'aal'.`,
                  en: `Result: the database sees aal = ${aal}. SQL write gates on auth.jwt()->>'aal' are viable.`,
                })
              : claimsPresent
              ? t({
                  ar: "النتيجة: الادّعاءات تصل لكن بلا حقل aal. لا تُبنَ بوّابات SQL على aal — الإلزام يبقى في طبقة الخادم.",
                  en: "Result: claims arrive but carry no aal field. Do NOT build SQL gates on aal — enforcement stays in the server layer.",
                })
              : t({
                  ar: "النتيجة: لا تصل الادّعاءات إلى قاعدة البيانات إطلاقًا.",
                  en: "Result: claims do not reach the database at all.",
                })}
          </div>
          <pre dir="ltr" style={{
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4, padding: 14, fontSize: 12.5, overflowX: "auto", color: "#e5e5e5",
          }}>{JSON.stringify(out, null, 2)}</pre>
          <p className="text-white/45" style={{ fontSize: 12.5, marginTop: 10 }}>
            {t({
              ar: "أرسل هذا الناتج كما هو. لا يحتوي على رمز الوصول ولا على أي سرّ — فقط ادّعاءات جلستك أنت.",
              en: "Send this output as-is. It contains no access token and no secret — only your own session's claims.",
            })}
          </p>
        </div>
      )}
    </div>
  );
}
