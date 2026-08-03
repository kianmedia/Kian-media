"use client";
// ════════════════════════════════════════════════════════════════════════════
// /assistant — THE PUBLIC LEAD ASSISTANT. The only external face of Phase C.
//
// WHAT A VISITOR CAN DO HERE — a closed list, decided in the database:
//   1. ask a question, answered ONLY from sources approved for the 'anonymous'
//      role at 'public' sensitivity, always with their titles and versions;
//   2. leave contact details, which become a DRAFT that waits for a human.
//
// ⛔ WHAT NEITHER THIS PAGE NOR ITS ENDPOINT WILL EVER DO
//    • send an email, a WhatsApp message or any notification — the anonymous
//      relay stays closed, and the response says `email_sent:false` so nobody
//      has to take our word for it;
//    • let the visitor choose who is contacted (there is no recipient field,
//      and an unknown field is REJECTED rather than ignored);
//    • create a client, an opportunity, a project or a quote;
//    • state a price, quote a rate, or imply any commitment;
//    • reach one byte of internal knowledge. Three independent layers stop it:
//      a table CHECK (external roles ⇒ public sensitivity only), the access
//      matrix, and the retrieval predicate — and the roles are pinned to
//      ['anonymous'] inside the database, not chosen by this page.
//
// ⚠️ HONEST STATE. No model is enabled. The page never renders a "generated"
//    answer, because there is none: it shows the mock's plain sentence and the
//    verbatim excerpts. Before the SQL is applied it says so, and it never
//    fakes an answer or a misleading empty state.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";

interface PublicCitation { source_id: string; title_ar: string; source_version: number; freshness_days?: number | null }
interface PublicEvidence { source_id: string; excerpt: string; title_ar: string; source_type: string; source_version: number }

interface AskResponse {
  ok?: boolean;
  refusal_code?: string;
  answer?: string;
  retrieved_count?: number;
  citations?: PublicCitation[];
  evidence?: PublicEvidence[];
  is_data_not_instructions?: boolean;
  tool_execution?: boolean;
  binding_price?: boolean;
  error?: string;
  provider?: { notice?: string; enabled?: boolean };
}

interface LeadResponse {
  ok?: boolean;
  draft_id?: string;
  duplicate?: boolean;
  status?: string;
  handoff_status?: string;
  email_sent?: boolean;
  notice?: string;
  privacy_notice?: string;
  error?: string;
  message?: string;
}

const PROVIDER_NOTICE = "مساعد كيان غير مفعّل بعد — تم تجهيز البنية فقط";

// «لم تُفعَّل بعد» ليست «عطل» وليست «ممنوع». الخلط بينها يجعل الزائر يظنّ أنّه
// أخطأ، بينما السبب عندنا نحن.
const ERR_AR: Record<string, string> = {
  feature_not_enabled: "هذه الخدمة لم تُفعَّل بعد على الخادم. تواصل معنا مباشرةً وسنردّ عليك.",
  server_not_configured: "الخدمة غير مهيّأة حاليًّا عندنا. هذا ليس خطأً منك.",
  rate_limited: "عدد المحاولات تجاوز الحدّ المسموح. انتظر قليلًا ثمّ أعد المحاولة.",
  request_failed: "تعذّر تنفيذ الطلب الآن. حاول بعد قليل.",
  not_permitted: "هذا الطلب غير مسموح من هذه الصفحة.",
  invalid_json: "تعذّرت قراءة الطلب.",
  unknown_action: "طلب غير معروف.",
  unknown_fields: "الطلب يحتوي حقولًا غير مسموح بها ولم يُحفَظ.",
  contact_required: "اكتب بريدًا إلكترونيًّا أو رقم جوّال ليتمكّن فريقنا من الردّ.",
  question_too_short: "اكتب سؤالًا أوضح من فضلك.",
  payload_too_large: "الطلب أكبر من المسموح.",
  invalid_email: "صيغة البريد الإلكترونيّ غير صحيحة.",
  captcha_not_verified: "التحقّق من أنّك لست آليًّا مطلوب وغير منفَّذ بعد — الطلب لم يُحفَظ.",
  public_lead_disabled: "استقبال الطلبات من هذه الصفحة متوقّف حاليًّا.",
  public_assistant_disabled: "المساعد العامّ غير مفعّل حاليًّا.",
  blocked_by_guard: "لا يمكنني تنفيذ هذا الطلب. اطرح سؤالًا عن خدماتنا وسأجيب من مصدر معتمَد.",
  no_approved_source: "لا توجد لدي معلومة معتمدة كافية للإجابة",
};

const errAr = (code?: string) => (code && ERR_AR[code]) || "تعذّر تنفيذ الطلب الآن.";

const PRIVACY_AR =
  "نحفظ ما تكتبه هنا كمسوّدة طلب ليطّلع عليها موظّف. لا نرسل بريدًا آليًّا، ولا نصدر سعرًا ولا التزامًا. " +
  "لا نحتفظ بعنوانك الشبكيّ ولا بمتصفّحك، بل ببصمة مُعمّاة تُستعمل للحدّ من الإساءة فقط.";

/** Strip anything that could turn a source excerpt into markup or a live link.
 *  The server neutralises too — this is the second layer, on the render side. */
function safeText(input: string): string {
  return String(input ?? "")
    .replace(/<[^>]{0,4000}>/g, " ")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/https?:\/\/\S*(?:token=|X-Amz-|\/object\/sign\/|signature=)\S*/gi, "[رابط محذوف]");
}

export default function PublicAssistantPage() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [ans, setAns] = useState<AskResponse | null>(null);
  const [askErr, setAskErr] = useState("");

  const [lead, setLead] = useState({ full_name: "", email: "", phone: "", company: "", service_interest: "", message: "" });
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadRes, setLeadRes] = useState<LeadResponse | null>(null);
  const [leadErr, setLeadErr] = useState("");
  // One key per page load: a double-click cannot create a second draft.
  const [idem] = useState(() => `pub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const ask = async () => {
    if (q.trim().length < 2) return;
    setBusy(true); setAskErr(""); setAns(null);
    try {
      const res = await fetch("/api/public/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ask", question: q.trim() }),
      });
      const body = (await res.json()) as AskResponse;
      if (!res.ok || body.error) { setAskErr(errAr(body.error)); }
      else setAns(body);
    } catch {
      setAskErr("تعذّر الاتصال. تحقّق من الشبكة وأعد المحاولة.");
    } finally { setBusy(false); }
  };

  const submitLead = async () => {
    setLeadBusy(true); setLeadErr(""); setLeadRes(null);
    try {
      const payload: Record<string, string> = { locale: "ar" };
      for (const [k, v] of Object.entries(lead)) if (v.trim()) payload[k] = v.trim();
      const res = await fetch("/api/public/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lead", payload, idempotency_key: idem }),
      });
      const body = (await res.json()) as LeadResponse;
      if (!res.ok || body.ok === false) setLeadErr(errAr(body.error));
      else setLeadRes(body);
    } catch {
      setLeadErr("تعذّر الاتصال. تحقّق من الشبكة وأعد المحاولة.");
    } finally { setLeadBusy(false); }
  };

  const box: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px",
    padding: "16px 18px", marginBottom: "16px", background: "rgba(255,255,255,0.03)",
  };
  const input: React.CSSProperties = {
    width: "100%", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "4px", padding: "9px 11px", color: "#f2f2f2", fontSize: "13px",
    fontFamily: "inherit", lineHeight: 1.9, marginBottom: "10px",
  };
  const btn = (disabled: boolean): React.CSSProperties => ({
    border: "1px solid #e31e24", color: disabled ? "rgba(255,255,255,0.4)" : "#e31e24",
    background: "transparent", borderRadius: "4px", padding: "8px 18px", fontSize: "13px",
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: disabled ? 0.6 : 1,
  });
  const dim = { color: "rgba(255,255,255,0.55)", fontSize: "11.5px", lineHeight: 2 };

  return (
    <main dir="rtl" style={{ maxWidth: "820px", margin: "0 auto", padding: "40px 20px", color: "#f2f2f2" }}>
      <h1 style={{ fontSize: "clamp(20px,4vw,28px)", lineHeight: 1.4, marginBottom: "10px" }}>مساعد كيان</h1>

      {/* الحقيقة أوّلًا، قبل أيّ حقل إدخال. */}
      <div style={{ ...box, borderColor: "#e8b339", background: "rgba(232,179,57,0.06)" }}>
        <strong style={{ fontSize: "13px" }}>{PROVIDER_NOTICE}</strong>
        <div style={dim}>
          لا يوجد نموذج ذكاء اصطناعيّ مُفعّل هنا. ما تراه أدناه مقتطفات حرفية من صفحات معتمَدة لدينا،
          مع مراجعها. لا نُصدر سعرًا ولا التزامًا من هذه الصفحة، ولا يصلك بريد آليّ منها.
        </div>
      </div>

      {/* ١) السؤال */}
      <section style={box}>
        <h2 style={{ fontSize: "14px", marginBottom: "10px" }}>اسأل عن خدماتنا</h2>
        <textarea
          value={q} onChange={(e) => setQ(e.target.value)} rows={3} style={input}
          placeholder="مثال: ما الخدمات التي تقدّمونها للفعاليات؟" maxLength={1000}
        />
        <button type="button" onClick={() => void ask()} disabled={busy || q.trim().length < 2} style={btn(busy || q.trim().length < 2)}>
          {busy ? "جارٍ البحث…" : "اسأل"}
        </button>

        {askErr && (
          <div style={{ ...box, borderColor: "#e05a5a", marginTop: "14px" }}>
            <div style={{ fontSize: "13px", lineHeight: 2 }}>{askErr}</div>
          </div>
        )}

        {ans && (
          <div style={{ marginTop: "14px" }}>
            {/* لا مصدر ⇒ جملة الخادم حرفيًّا. لا تلطيف ولا بديل. */}
            {(ans.retrieved_count ?? 0) === 0 ? (
              <div style={{ fontSize: "13px", lineHeight: 2 }}>
                {ans.answer || ERR_AR.no_approved_source}
                <div style={dim}>
                  لم نجد صفحة معتمَدة تجيب سؤالك. اترك بياناتك أدناه وسيتواصل معك إنسان من فريقنا.
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: "13px", lineHeight: 2, marginBottom: "10px" }}>{ans.answer}</div>
                {(ans.evidence ?? []).map((e, i) => (
                  <div key={`${e.source_id}-${i}`} style={{ ...box, marginBottom: "10px" }}>
                    <div style={{ ...dim, marginBottom: "6px" }}>{e.title_ar} — نسخة {e.source_version}</div>
                    <p style={{ fontSize: "12.5px", lineHeight: 2, whiteSpace: "pre-wrap", margin: 0 }}>
                      {safeText(e.excerpt)}
                    </p>
                  </div>
                ))}
                <div style={dim}>
                  المراجع: {(ans.citations ?? []).map((c) => `${c.title_ar} (نسخة ${c.source_version})`).join(" · ") || "—"}
                </div>
                <div style={dim}>
                  ★ هذه مقتطفات من مصادر معتمَدة، وليست عرض سعر ولا التزامًا. الأسعار تُحدَّد بعد تواصل بشريّ.
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* ٢) طلب تواصل — مسوّدة فقط */}
      <section style={box}>
        <h2 style={{ fontSize: "14px", marginBottom: "4px" }}>اترك بياناتك ليتواصل معك فريقنا</h2>
        <div style={{ ...dim, marginBottom: "12px" }}>
          يُحفَظ طلبك <strong>كمسوّدة تنتظر مراجعة إنسان</strong>. لا يُرسَل بريد آليّ، ولا يُنشأ لك حساب،
          ولا يصدر عرض سعر. اكتب أقلّ ما يلزم للتواصل فقط.
        </div>

        <input style={input} placeholder="الاسم" maxLength={120} value={lead.full_name} onChange={(e) => setLead({ ...lead, full_name: e.target.value })} />
        <input style={input} placeholder="البريد الإلكترونيّ" maxLength={160} inputMode="email" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} />
        <input style={input} placeholder="رقم الجوّال" maxLength={40} inputMode="tel" value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} />
        <input style={input} placeholder="الجهة / الشركة (اختياري)" maxLength={160} value={lead.company} onChange={(e) => setLead({ ...lead, company: e.target.value })} />
        <input style={input} placeholder="الخدمة المطلوبة (اختياري)" maxLength={120} value={lead.service_interest} onChange={(e) => setLead({ ...lead, service_interest: e.target.value })} />
        <textarea style={input} rows={3} placeholder="تفاصيل مختصرة (اختياري)" maxLength={2000} value={lead.message} onChange={(e) => setLead({ ...lead, message: e.target.value })} />

        <div style={{ ...dim, marginBottom: "10px" }}>{PRIVACY_AR}</div>

        <button type="button" onClick={() => void submitLead()} disabled={leadBusy || (!lead.email.trim() && !lead.phone.trim())} style={btn(leadBusy || (!lead.email.trim() && !lead.phone.trim()))}>
          {leadBusy ? "جارٍ الحفظ…" : "إرسال الطلب"}
        </button>

        {leadErr && (
          <div style={{ ...box, borderColor: "#e05a5a", marginTop: "14px" }}>
            <div style={{ fontSize: "13px", lineHeight: 2 }}>{leadErr}</div>
          </div>
        )}

        {leadRes?.ok && (
          <div style={{ ...box, borderColor: "#4caf7d", marginTop: "14px" }}>
            <div style={{ fontSize: "13px", lineHeight: 2 }}>
              {leadRes.duplicate ? "طلبك محفوظ مسبقًا — لم نُنشئ نسخة ثانية." : (leadRes.notice || "تم حفظ طلبك كمسوّدة.")}
            </div>
            <div style={dim}>
              الحالة: بانتظار مراجعة بشرية · لم يُرسَل بريد ({String(leadRes.email_sent ?? false)}) · لم يصدر سعر ولا التزام.
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
