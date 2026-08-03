"use client";
// ════════════════════════════════════════════════════════════════════════════
// /secure-document — the ONLY external-facing surface of the compliance centre.
//
// ★ The token lives in the URL FRAGMENT (after #) ★ A fragment is never sent to
// the server, never appears in an access log, and is never forwarded in the
// Referer header when the recipient clicks a link. Putting it in a query string
// would leak it into all three. The page reads it from `location.hash` and
// POSTs it in the request body.
//
// The page shows: who the link was issued to, why, when it expires, how many
// opens and downloads remain, the watermark identity printed on the view, and
// the documents attached to THIS grant. Nothing else exists to it — there is no
// directory, no search, no other document reachable from here.
//
// ⛔ No storage path is ever received by this page. It asks the server, the
//    server authorises in the database, and only a short-lived signed URL comes
//    back. When it expires the link simply stops working.
// ⛔ Before the SQL is applied this page says so honestly. It never renders a
//    fake document list and never shows a misleading empty state.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";

interface GrantDoc {
  document_id: string;
  doc_type: string;
  label_ar: string | null;
  title: string | null;
  doc_language: string | null;
  issued_on: string | null;
  expires_on: string | null;
  allow_download: boolean;
  file_name: string | null;
}

interface OpenResult {
  ok: true;
  action: "open";
  recipient_org: string | null;
  recipient_name: string | null;
  purpose: string | null;
  expires_at: string | null;
  watermark_identity: string | null;
  opens_left: number;
  downloads_left: number;
  documents: GrantDoc[];
  delivery_note_ar: string;
}

const DENY_AR: Record<string, string> = {
  invalid_or_expired: "هذا الرابط غير صالح أو انتهت صلاحيته.",
  download_not_allowed: "هذه الوثيقة للعرض فقط — التنزيل غير مسموح في هذا الرابط.",
  download_limit_reached: "استُنفد عدد التنزيلات المسموح به في هذا الرابط.",
  not_in_grant: "هذه الوثيقة ليست ضمن هذا الرابط.",
  document_no_longer_valid: "هذه الوثيقة لم تعد سارية، فتوقّف الرابط عنها.",
  no_file: "لا يوجد ملفّ مرفق لهذه الوثيقة.",
  document_required: "لم تُحدَّد وثيقة.",
};

const ERR_AR: Record<string, string> = {
  // ⚠️ «لم تُفعَّل بعد» ليست «رابط خاطئ». الخلط بينهما يجعل المتلقّي يظنّ أنّ
  //    من أرسل له أخطأ، بينما السبب عندنا نحن.
  pending_migration: "هذه الخدمة لم تُفعَّل بعد على الخادم. تواصل مع من شارك الرابط معك.",
  server_not_configured: "الخدمة غير مهيّأة حاليًا. تواصل مع من شارك الرابط معك.",
  upstream_error: "تعذّر الوصول إلى الخادم الآن. حاول بعد قليل.",
  sign_failed: "تعذّر تجهيز الملفّ الآن. حاول بعد قليل.",
  method_not_allowed: "طلب غير مدعوم.",
  bad_request: "طلب غير مكتمل.",
  network: "تعذّر الاتصال بالشبكة.",
};

const C = {
  bg: "#0b0b0d",
  card: "rgba(255,255,255,0.04)",
  line: "rgba(255,255,255,0.12)",
  text: "#f2f2f2",
  dim: "rgba(255,255,255,0.55)",
  accent: "#e31e24",
  warn: "#e8b339",
};

function fmt(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return d;
  }
}

export default function SecureDocumentPage() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "denied" | "error">("idle");
  const [grant, setGrant] = useState<OpenResult | null>(null);
  const [message, setMessage] = useState<string>("");
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [docNotice, setDocNotice] = useState<string>("");

  // The fragment is read on the client only; it is never part of any request URL.
  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    setToken(raw ? decodeURIComponent(raw) : "");
  }, []);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch("/api/public/secure-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        return (await res.json()) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (token === null) return;
    if (!token) {
      setState("denied");
      setMessage("لا يوجد رمز في هذا الرابط. تأكّد من نسخ الرابط كاملًا.");
      return;
    }
    let cancelled = false;
    (async () => {
      setState("loading");
      const j = await post({ token, action: "open" });
      if (cancelled) return;
      if (!j) {
        setState("error");
        setMessage(ERR_AR.network);
        return;
      }
      if (j.ok === true) {
        setGrant(j as unknown as OpenResult);
        setState("ready");
        return;
      }
      if (typeof j.error === "string") {
        setState("error");
        setMessage(ERR_AR[j.error] ?? "تعذّر فتح الرابط.");
        return;
      }
      setState("denied");
      setMessage(DENY_AR[String(j.reason ?? "")] ?? DENY_AR.invalid_or_expired);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, post]);

  const openDoc = useCallback(
    async (doc: GrantDoc, action: "open" | "download") => {
      if (!token) return;
      setBusyDoc(doc.document_id);
      setDocNotice("");
      const j = await post({ token, action, documentId: doc.document_id });
      setBusyDoc(null);
      if (!j) {
        setDocNotice(ERR_AR.network);
        return;
      }
      if (j.ok === true && typeof j.url === "string") {
        // The signed URL is short-lived and used immediately. It is not stored.
        window.open(j.url, "_blank", "noopener,noreferrer");
        // Counters changed server-side; refresh them honestly rather than guessing.
        const refreshed = await post({ token, action: "open" });
        if (refreshed && refreshed.ok === true) setGrant(refreshed as unknown as OpenResult);
        return;
      }
      if (typeof j.error === "string") {
        setDocNotice(ERR_AR[j.error] ?? "تعذّر فتح الملفّ.");
        return;
      }
      setDocNotice(DENY_AR[String(j.reason ?? "")] ?? "تعذّر فتح الملفّ.");
    },
    [token, post],
  );

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh", background: C.bg, color: C.text,
        padding: "40px 18px", fontFamily: "system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif",
      }}
    >
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "20px", letterSpacing: "0.5px", marginBottom: "6px" }}>
          وثائق مشتركة بصلاحية محدودة
        </h1>
        <p style={{ color: C.dim, fontSize: "13px", lineHeight: 1.9, marginBottom: "26px" }}>
          هذه الصفحة تعرض وثائق محدَّدة شُوركت معك بصلاحية زمنية وعدد فتحات محدود.
          لا يوجد فهرس ولا بحث: ما تراه أدناه هو كلّ ما يشمله هذا الرابط.
        </p>

        {state === "loading" && (
          <div style={{ color: C.dim, fontSize: "13px" }}>جارٍ التحقّق من الرابط…</div>
        )}

        {(state === "denied" || state === "error") && (
          <div
            style={{
              border: `1px solid ${state === "error" ? C.warn : C.line}`,
              background: C.card, borderRadius: "6px", padding: "18px", fontSize: "13.5px", lineHeight: 2,
            }}
          >
            {message}
            {state === "denied" && (
              <div style={{ color: C.dim, fontSize: "12px", marginTop: "10px" }}>
                إن كنت تتوقّع وصولًا، اطلب رابطًا جديدًا ممّن شاركه معك. لا يمكن تجديد الرابط من هنا.
              </div>
            )}
          </div>
        )}

        {state === "ready" && grant && (
          <>
            <section
              style={{
                border: `1px solid ${C.line}`, background: C.card, borderRadius: "6px",
                padding: "18px", marginBottom: "18px", fontSize: "13px", lineHeight: 2.1,
              }}
            >
              <div>
                <span style={{ color: C.dim }}>صدر إلى: </span>
                {grant.recipient_org ?? "—"}
                {grant.recipient_name ? ` · ${grant.recipient_name}` : ""}
              </div>
              {grant.purpose && (
                <div>
                  <span style={{ color: C.dim }}>الغرض: </span>
                  {grant.purpose}
                </div>
              )}
              <div>
                <span style={{ color: C.dim }}>ينتهي في: </span>
                {fmt(grant.expires_at)}
              </div>
              <div>
                <span style={{ color: C.dim }}>المتبقّي: </span>
                {grant.opens_left} فتحة · {grant.downloads_left} تنزيل
              </div>
              {grant.watermark_identity && (
                <div style={{ color: C.warn, fontSize: "12px", marginTop: "8px" }}>
                  تُطبع هوية المتلقّي على كلّ عرض: {grant.watermark_identity}
                </div>
              )}
              <div style={{ color: C.dim, fontSize: "11.5px", marginTop: "8px" }}>
                {grant.delivery_note_ar}
              </div>
            </section>

            {docNotice && (
              <div
                style={{
                  border: `1px solid ${C.warn}`, borderRadius: "6px", padding: "12px",
                  marginBottom: "14px", fontSize: "13px",
                }}
              >
                {docNotice}
              </div>
            )}

            {grant.documents.length === 0 ? (
              // ⚠️ صفر صادق: الرابط صالح، لكنّ وثائقه لم تعد سارية. لا نقول
              //    «لا وثائق» بلا تفسير، ولا ندّعي عطلًا.
              <div
                style={{
                  border: `1px solid ${C.line}`, background: C.card, borderRadius: "6px",
                  padding: "18px", fontSize: "13px", lineHeight: 2,
                }}
              >
                لا توجد وثيقة سارية في هذا الرابط الآن. قد تكون الوثائق انتهت أو أُلغيت بعد
                إصدار الرابط. تواصل مع من شاركه معك.
              </div>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "10px" }}>
                {grant.documents.map((d) => (
                  <li
                    key={d.document_id}
                    style={{
                      border: `1px solid ${C.line}`, background: C.card, borderRadius: "6px",
                      padding: "14px 16px", display: "flex", flexWrap: "wrap",
                      alignItems: "center", justifyContent: "space-between", gap: "10px",
                    }}
                  >
                    <div style={{ minWidth: "220px" }}>
                      <div style={{ fontSize: "14px" }}>{d.title || d.label_ar || d.doc_type}</div>
                      <div style={{ color: C.dim, fontSize: "11.5px", marginTop: "4px" }}>
                        {d.doc_language ? `اللغة: ${d.doc_language} · ` : ""}
                        {d.expires_on ? `سارية حتّى ${fmt(d.expires_on)}` : "بلا تاريخ انتهاء"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => openDoc(d, "open")}
                        disabled={busyDoc === d.document_id}
                        style={{
                          border: `1px solid ${C.line}`, background: "none", color: C.text,
                          borderRadius: "4px", padding: "8px 14px", fontSize: "12px",
                          cursor: busyDoc === d.document_id ? "wait" : "pointer",
                        }}
                      >
                        عرض
                      </button>
                      {d.allow_download && (
                        <button
                          onClick={() => openDoc(d, "download")}
                          disabled={busyDoc === d.document_id}
                          style={{
                            border: `1px solid ${C.accent}`, background: "rgba(227,30,36,0.12)",
                            color: C.text, borderRadius: "4px", padding: "8px 14px", fontSize: "12px",
                            cursor: busyDoc === d.document_id ? "wait" : "pointer",
                          }}
                        >
                          تنزيل
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p style={{ color: C.dim, fontSize: "11.5px", lineHeight: 2, marginTop: "22px" }}>
              كلّ فتح وكلّ تنزيل يُسجَّل. الروابط المؤقّتة للملفّات تنتهي خلال دقيقتين،
              فإن توقّف ملفّ عن الفتح فأعِد الضغط على «عرض».
            </p>
          </>
        )}
      </div>
    </main>
  );
}
