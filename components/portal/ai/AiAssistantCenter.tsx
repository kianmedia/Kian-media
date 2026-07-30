"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/portal/ai/AiAssistantCenter.tsx — مساعد كيان (المرحلة C).
//
// سطح داخليّ بالكامل. العميل لا يرى هذه الشاشة في التنقّل، وإن فُتحت برابط
// مباشر فالقاعدة ترفض كلّ نداء (ai_can_use_internal = موظّف مخوَّل فقط) فتظهر
// «لا تملك صلاحية» — لا شاشة فارغة ولا ادّعاء ترحيلة ناقصة.
//
// ★ أربع قواعد تحكم كلّ سطر هنا ★
//   ١. لا إجابة بلا مرجع. حين يعود retrieved_count = 0 تُعرَض جملة القاعدة
//      نفسها «لا توجد لدي معلومة معتمدة كافية للإجابة» حرفيًّا — لا نلطّفها،
//      ولا نستبدلها بردّ عامّ، ولا نُخفيها خلف شاشة فارغة.
//   ٢. لا ادّعاء بأنّ المساعد يعمل. <ProviderNotice/> ظاهرة فوق كلّ إجابة،
//      و generated_text مثبَّت على null في طبقة البيانات نفسها.
//   ٣. النصّ المسترجَع **بيانات لا تعليمات**: يمرّ بمنقٍّ ثانٍ ويُعرَض نصًّا
//      خامًا. لا dangerouslySetInnerHTML في هذا الملفّ، ولا رابط يُبنى من نصّ
//      مصدر.
//   ٤. لا زرّ يمنح صلاحية. إخفاء زرّ هنا مجاملة؛ المنع في القاعدة، ولذلك تبقى
//      رسالة الرفض ظاهرة حين ترفض القاعدة رغم ظهور الزرّ.
//
// ⛔ ولا شيء هنا ينفّذ إجراءً: لا إنشاء مشروع ولا عميل ولا عرض سعر ولا إرسال
//    بريد. المساعد يقرأ ويستشهد ويُسلّم لإنسان — لا أكثر.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  aiAssistantState, aiAsk, aiKnowledgeList, aiSourceUpsert, aiSourceSubmit,
  aiSourceApprove, aiSourceReject, aiSourceArchive, aiConversationList,
  aiConversationMessages, aiConversationEscalate, aiConversationRedact,
  aiLeadList, aiLeadReview, aiAdminOverview,
  AI_SOURCE_TYPE_AR, AI_SOURCE_STATUS_AR, AI_SENSITIVITY_AR, AI_ROLE_AR,
  AI_CONFIDENCE_AR, AI_LEAD_STATUS_AR, AI_GUARD_CATEGORY_AR, AI_NO_SOURCE_AR,
  refusalAr, providerIsAnswering,
  type AiState, type AiAnswer, type AiAssistantStatePayload, type AiKnowledgeSource,
  type AiConversationRow, type AiMessageRow, type AiLeadDraft, type AiSourceType,
  type AiSourceStatus, type AiSensitivity, type AiAssistantRole, type AiGuardCategory,
} from "@/lib/portal/aiAssistant";
import {
  AC, Card, PendingMigration, Denied, Offline, ErrorBox, Empty, Badge,
  ProviderNotice, Citation, EvidenceText, Val, Btn, Field, inputStyle,
} from "./AiAtoms";

type Tab = "ask" | "knowledge" | "conversations" | "leads" | "status";

const TABS: { key: Tab; ar: string }[] = [
  { key: "ask", ar: "اسأل المساعد" },
  { key: "knowledge", ar: "سجلّ المعرفة" },
  { key: "conversations", ar: "المحادثات" },
  { key: "leads", ar: "مسوّدات العملاء" },
  { key: "status", ar: "الحالة والمزوّد" },
];

const SOURCE_TYPES: AiSourceType[] = [
  "public_website", "service_catalog", "faq", "company_policy", "operations_procedure",
  "sales_guide", "pricing_guidance", "compliance_guide", "equipment_procedure",
  "hr_policy", "approved_case_study", "approved_template", "other",
];

const ROLES: AiAssistantRole[] = ["owner", "sales", "operations", "collections", "marketing", "client", "anonymous"];

/** One place that turns any non-ok state into the right screen. */
function StateScreen<T>({ s, children }: { s: AiState<T>; children: (d: T) => JSX.Element }) {
  if (s.state === "needs_migration") return <PendingMigration />;
  if (s.state === "denied") return <Denied message={s.message} />;
  if (s.state === "offline") return <Offline message={s.message} />;
  if (s.state === "error") return <ErrorBox message={s.message} />;
  return children(s.data);
}

export default function AiAssistantCenter() {
  const [tab, setTab] = useState<Tab>("ask");
  const [state, setState] = useState<AiState<AiAssistantStatePayload> | null>(null);

  const reload = useCallback(async () => { setState(await aiAssistantState()); }, []);
  useEffect(() => { void reload(); }, [reload]);

  if (state === null) return <Card><Empty what="جارٍ قراءة حالة المساعد…" /></Card>;
  if (state.state !== "ok") {
    return (
      <StateScreen s={state}>{() => <></>}</StateScreen>
    );
  }
  const st = state.data;

  return (
    <div>
      {/* الشريط الأعلى: الحقيقة قبل أيّ شيء آخر. */}
      <ProviderNotice provider={st.provider} />

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
        {TABS.map((t) => (
          <button
            key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{
              border: `1px solid ${tab === t.key ? AC.accent : AC.line}`,
              color: tab === t.key ? AC.accent : AC.dim,
              background: "transparent", borderRadius: "4px", padding: "6px 14px",
              fontSize: "12px", cursor: "pointer", fontFamily: "inherit",
            }}
          >{t.ar}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
        <Badge text={`أدوارك: ${(st.roles ?? []).map((r) => AI_ROLE_AR[r] ?? r).join("، ") || "لا دور"}`} tone="blue" />
        <Badge text={st.read_only ? "قراءة فقط" : "⚠️ غير قراءة فقط"} tone={st.read_only ? "green" : "red"} />
        <Badge text={st.tool_execution ? "⚠️ تنفيذ أدوات" : "لا تنفيذ أدوات"} tone={st.tool_execution ? "red" : "green"} />
        <Badge text={st.autonomous_actions ? "⚠️ إجراءات تلقائية" : "لا إجراءات تلقائية"} tone={st.autonomous_actions ? "red" : "green"} />
        <Badge text={`مصادر معتمَدة: ${st.sources_approved} من ${st.sources_total}`} />
      </div>

      {tab === "ask" && <AskTab st={st} />}
      {tab === "knowledge" && <KnowledgeTab st={st} />}
      {tab === "conversations" && <ConversationsTab st={st} />}
      {tab === "leads" && <LeadsTab st={st} />}
      {tab === "status" && <StatusTab st={st} onReload={reload} />}
    </div>
  );
}

// ─── اسأل المساعد ───────────────────────────────────────────────────────────

function AskTab({ st }: { st: AiAssistantStatePayload }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AiState<AiAnswer> | null>(null);
  const [conversation, setConversation] = useState<string | null>(null);

  if (!st.can_use_internal) {
    return (
      <Card title="اسأل المساعد">
        <Denied message="المساعد الداخليّ مخصّص لفريق العمل المخوَّل." />
        <div style={{ color: AC.dim, fontSize: "11.5px", marginTop: "10px", lineHeight: 2 }}>
          {st.assistant_enabled
            ? "حسابك ليس ضمن أدوار المساعد (المالك · المبيعات · التشغيل · التحصيل · التسويق). هذا منع صلاحية لا عطل."
            : "المساعد مطفأ من الإعدادات. هذا قرار مالك لا عطل ولا ترحيلة ناقصة."}
        </div>
      </Card>
    );
  }

  const ask = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    const r = await aiAsk(q, conversation);
    setAnswer(r);
    // ⚠️ The conversation id is captured HERE, in the event handler — never
    // inside a render callback. Updating state while another component renders
    // is a React violation, and the earlier version of this file did exactly
    // that from inside <StateScreen>'s children function.
    if (r.state === "ok" && r.data.conversation_id) setConversation(r.data.conversation_id);
    setBusy(false);
  };

  return (
    <>
      <Card
        title="اسأل المساعد"
        note="الإجابة تأتي من مصادر معتمَدة فقط، ومع كلّ إجابة مراجعها ونسختها وحداثتها. بلا مصدر لا توجد إجابة — ولا يخمّن المساعد."
      >
        <Field label="سؤالك" hint="لا تكتب هنا بيانات شخصية ولا أسرارًا. المحادثة تُحفَظ وتخضع لسياسة احتفاظ.">
          <textarea
            value={q} onChange={(e) => setQ(e.target.value)} rows={3} style={inputStyle}
            placeholder="مثال: ما سياستنا في تسليم المواد الخام للعميل؟"
          />
        </Field>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Btn onClick={() => void ask()} tone="accent" disabled={busy || q.trim().length < 2}>
            {busy ? "جارٍ البحث في المصادر…" : "اسأل"}
          </Btn>
          {conversation && (
            <Btn onClick={() => { setConversation(null); setAnswer(null); }}>محادثة جديدة</Btn>
          )}
        </div>
      </Card>

      {answer && <StateScreen s={answer}>{(a) => <AnswerView a={a} />}</StateScreen>}
    </>
  );
}

function AnswerView({ a }: { a: AiAnswer }) {
  // منع الحارس: يُعرَض سبب المنع مصنَّفًا، ويُقال صراحةً إنّ الاسترجاع لم يقع.
  if (a.refusal_code === "blocked_by_guard") {
    const cats = (a.guard?.categories ?? []) as AiGuardCategory[];
    return (
      <Card title="طلب مرفوض">
        <div style={{ border: `1px solid ${AC.red}`, borderRadius: "6px", padding: "12px 14px", fontSize: "12.5px", lineHeight: 2 }}>
          {refusalAr("blocked_by_guard")}
        </div>
        <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {cats.map((c) => <Badge key={c} text={AI_GUARD_CATEGORY_AR[c] ?? c} tone="red" />)}
        </div>
        <div style={{ color: AC.dim, fontSize: "11.5px", marginTop: "10px", lineHeight: 2 }}>
          ★ لم يُقرأ مصدر واحد: المنع يقع **قبل** الاسترجاع، وعدد النتائج {a.retrieved_count}.
          {" "}المحتوى لدى المساعد بيانات لا تعليمات، ولا يُخرج أسرارًا ولا ينفّذ أوامر.
        </div>
      </Card>
    );
  }

  // لا مصدر: تُعرَض جملة القاعدة حرفيًّا. لا تلطيف ولا بديل.
  if (a.retrieved_count === 0) {
    return (
      <Card title="لا إجابة">
        <div style={{ fontSize: "13px", lineHeight: 2 }}>{a.answer || AI_NO_SOURCE_AR}</div>
        <div style={{ color: AC.dim, fontSize: "11.5px", marginTop: "8px", lineHeight: 2 }}>
          لم يُطابق سؤالك أيّ مصدر معتمَد **ضمن صلاحيتك**. هذا ليس عطلًا ولا ترحيلة ناقصة:
          إمّا أنّ المصدر غير موجود، أو غير معتمَد بعد، أو خارج ما يُسمح لدورك بقراءته.
          {" "}أضِف المصدر في سجلّ المعرفة واعتمده، أو اطلب التسليم لإنسان.
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card title="ما وجدته في المصادر المعتمَدة">
        {providerIsAnswering(a) ? null : (
          <div style={{ color: AC.dim, fontSize: "11.5px", marginBottom: "10px", lineHeight: 2 }}>
            ⚠️ لا يوجد نصّ مولَّد. ما يلي مقتطفات حرفية من المصادر، لا صياغة من نموذج.
          </div>
        )}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
          <Badge text={`عدد المصادر: ${a.retrieved_count}`} tone="blue" />
          {a.confidence && <Badge text={AI_CONFIDENCE_AR[a.confidence] ?? a.confidence} tone={a.confidence === "high" ? "green" : a.confidence === "low" ? "amber" : "dim"} />}
          <Badge text={a.is_data_not_instructions ? "المحتوى بيانات لا تعليمات" : "⚠️ وسم البيانات غائب"} tone={a.is_data_not_instructions ? "green" : "red"} />
          <Badge text={a.tool_execution ? "⚠️ تنفيذ أدوات" : "لا تنفيذ أدوات"} tone={a.tool_execution ? "red" : "green"} />
        </div>
        {a.evidence.map((e, i) => <EvidenceText key={`${e.source_id}-${e.chunk_index ?? i}`} e={e} />)}
      </Card>

      <Card title="المراجع" note="كلّ مقتطف أعلاه مسنَد إلى مصدر معتمَد بنسخته وحداثته. إجابة بلا مراجع لا تُعرَض في هذه الشاشة إطلاقًا.">
        <ul style={{ margin: 0, padding: 0 }}>
          {a.citations.map((c) => <Citation key={`${c.source_id}-${c.source_version}`} c={c} />)}
        </ul>
        {a.citations.length === 0 && (
          <ErrorBox message="⚠️ وصلت نتائج بلا مراجع — لا تعتمد على هذا الردّ وأبلغ الفريق التقنيّ." />
        )}
      </Card>
    </>
  );
}

// ─── سجلّ المعرفة ───────────────────────────────────────────────────────────

function KnowledgeTab({ st }: { st: AiAssistantStatePayload }) {
  const [rows, setRows] = useState<AiState<AiKnowledgeSource[]> | null>(null);
  const [status, setStatus] = useState<AiSourceStatus | "">("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);

  const reload = useCallback(async () => {
    setRows(await aiKnowledgeList(status || null, search || null));
  }, [status, search]);
  useEffect(() => { void reload(); }, [reload]);

  if (!st.can_view_knowledge) {
    return <Card title="سجلّ المعرفة"><Denied message="لا تملك صلاحية عرض سجلّ المعرفة (ai.knowledge.view)." /></Card>;
  }

  const act = async (fn: () => Promise<AiState<Record<string, unknown>>>, okText: string) => {
    const r = await fn();
    if (r.state !== "ok") { setNotice(r.message); return; }
    const d = r.data;
    if (d.ok === false) {
      // الرفض المُصنَّف من القاعدة يُعرَض بسببه لا برسالة عامّة.
      const err = String(d.error ?? "");
      const findings = Array.isArray(d.findings) ? ` (${(d.findings as string[]).join("، ")})` : "";
      setNotice(
        err === "forbidden_content" ? `رُفض المحتوى: يحتوي على سرّ أو بيانات ممنوعة${findings}.`
        : err === "approver_is_submitter" ? "المعتمِد لا يكون هو المُقدِّم — هذا قيد جدوليّ لا إعداد."
        : err === "not_in_review" ? "المصدر ليس قيد المراجعة."
        : err === "content_too_short" ? "النصّ قصير جدًّا للاعتماد."
        : `تعذّر التنفيذ: ${err}`,
      );
      return;
    }
    setNotice(okText);
    await reload();
  };

  return (
    <>
      {notice && <Card><div style={{ fontSize: "12.5px", lineHeight: 2 }}>{notice}</div></Card>}

      <Card
        title="سجلّ المعرفة"
        note="المصدر لا يصير قابلًا للاسترجاع قبل اعتماده من مخوَّل غير مُقدِّمه. غير المعتمَد لا يُفهرَس أصلًا، فلا يظهر في أيّ إجابة."
      >
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
          <select value={status} onChange={(e) => setStatus(e.target.value as AiSourceStatus | "")} style={{ ...inputStyle, width: "auto" }}>
            <option value="">كلّ الحالات</option>
            {(Object.keys(AI_SOURCE_STATUS_AR) as AiSourceStatus[]).map((s) => (
              <option key={s} value={s}>{AI_SOURCE_STATUS_AR[s]}</option>
            ))}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالعنوان" style={{ ...inputStyle, width: "auto" }} />
          {st.can_manage_knowledge && (
            <Btn tone="accent" onClick={() => setDraft({ source_type: "faq", sensitivity: "internal", allowed_roles: ["owner"], language: "ar", content_kind: "inline" })}>
              مصدر جديد
            </Btn>
          )}
        </div>

        {rows === null ? <Empty what="جارٍ التحميل…" /> : (
          <StateScreen s={rows}>
            {(list) => list.length === 0 ? (
              <Empty
                what="لا توجد مصادر مطابقة."
                why={st.sources_total === 0
                  ? "السجلّ فارغ فعلًا — لم يُضَف مصدر بعد. هذا صفر حقيقيّ لا شاشة معطّلة."
                  : "توجد مصادر لكن لا شيء يطابق المرشّحات الحالية."}
              />
            ) : (
              <div style={{ display: "grid", gap: "10px" }}>
                {list.map((s) => (
                  <div key={s.id} style={{ border: `1px solid ${AC.line}`, borderRadius: "6px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
                      <Badge text={AI_SOURCE_STATUS_AR[s.status] ?? s.status} tone={s.status === "approved" ? "green" : s.status === "in_review" ? "amber" : "dim"} />
                      <Badge text={AI_SOURCE_TYPE_AR[s.source_type] ?? s.source_type} />
                      <Badge text={AI_SENSITIVITY_AR[s.sensitivity] ?? s.sensitivity} tone={s.sensitivity === "restricted" ? "red" : s.sensitivity === "internal" ? "amber" : "dim"} />
                      <Badge text={`نسخة ${s.version}`} />
                    </div>
                    <div style={{ fontSize: "13px", marginBottom: "6px" }}>{s.title_ar || "بلا عنوان"}</div>
                    <Val label="الأدوار المسموح لها">
                      {(s.allowed_roles ?? []).map((r) => AI_ROLE_AR[r] ?? r).join("، ") || "لا دور"}
                    </Val>
                    <Val label="السريان">
                      {(s.effective_from ?? "بلا تاريخ بدء")} → {(s.expires_at ?? "بلا انتهاء")}
                    </Val>
                    {s.rejected_reason && <Val label="سبب الرفض">{s.rejected_reason}</Val>}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                      {st.can_manage_knowledge && (s.status === "draft" || s.status === "rejected") && (
                        <Btn onClick={() => void act(() => aiSourceSubmit(s.id), "أُرسل للمراجعة.")}>إرسال للمراجعة</Btn>
                      )}
                      {st.can_approve_knowledge && s.status === "in_review" && (
                        <>
                          <Btn tone="green" onClick={() => void act(() => aiSourceApprove(s.id), "اعتُمد وفُهرِس.")}>اعتماد</Btn>
                          <Btn tone="red" onClick={() => void act(() => aiSourceReject(s.id, "مراجعة بشرية"), "رُفض.")}>رفض</Btn>
                        </>
                      )}
                      {st.can_manage_knowledge && s.status !== "archived" && (
                        <Btn onClick={() => void act(() => aiSourceArchive(s.id), "أُرشف وأُزيل من الفهرس.")}>أرشفة</Btn>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </StateScreen>
        )}
      </Card>

      {draft && st.can_manage_knowledge && (
        <SourceEditor
          draft={draft} setDraft={setDraft}
          onSave={async (input) => { await act(() => aiSourceUpsert(input), "حُفظ كمسودّة — لا يُسترجَع قبل الاعتماد."); setDraft(null); }}
        />
      )}
    </>
  );
}

function SourceEditor({
  draft, setDraft, onSave,
}: {
  draft: Record<string, unknown>;
  setDraft: (d: Record<string, unknown> | null) => void;
  onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const set = (k: string, v: unknown) => setDraft({ ...draft, [k]: v });
  const roles = (draft.allowed_roles as AiAssistantRole[]) ?? [];
  const sensitivity = (draft.sensitivity as AiSensitivity) ?? "internal";
  const externalSelected = roles.includes("client") || roles.includes("anonymous");

  return (
    <Card
      title="مصدر معرفة جديد"
      note="⛔ لا تُدخل هنا ملفّات عملاء ولا مخرجات مشاريع ولا مستندات بنكية ولا سجلّات هوية موظّفين ولا بيانات مورّدين بنكية ولا مالية حسّاسة ولا كلمات مرور ولا مسودّات غير معتمدة. القاعدة تفحص المحتوى وترفض ما يحوي سرًّا."
    >
      <Field label="العنوان (عربي)">
        <input value={String(draft.title_ar ?? "")} onChange={(e) => set("title_ar", e.target.value)} style={inputStyle} />
      </Field>
      <Field label="النوع">
        <select value={String(draft.source_type ?? "faq")} onChange={(e) => set("source_type", e.target.value)} style={inputStyle}>
          {SOURCE_TYPES.map((t) => <option key={t} value={t}>{AI_SOURCE_TYPE_AR[t]}</option>)}
        </select>
      </Field>
      <Field
        label="الحسّاسية"
        hint="المقيَّد للمالك وحده — قيد جدوليّ لا عُرف. والعامّ وحده هو ما يبلغ العميل أو الزائر."
      >
        <select value={sensitivity} onChange={(e) => set("sensitivity", e.target.value)} style={inputStyle}>
          {(Object.keys(AI_SENSITIVITY_AR) as AiSensitivity[]).map((s) => <option key={s} value={s}>{AI_SENSITIVITY_AR[s]}</option>)}
        </select>
      </Field>
      <Field label="الأدوار المسموح لها">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {ROLES.map((r) => (
            <label key={r} style={{ fontSize: "12px", color: AC.text, display: "flex", gap: "4px", alignItems: "center" }}>
              <input
                type="checkbox" checked={roles.includes(r)}
                onChange={(e) => set("allowed_roles", e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))}
              />
              {AI_ROLE_AR[r]}
            </label>
          ))}
        </div>
      </Field>
      {externalSelected && sensitivity !== "public" && (
        <ErrorBox message="⛔ العميل والزائر لا يبلغان إلّا المصادر العامّة. القاعدة سترفض هذا الصفّ بقيد جدوليّ — غيّر الحسّاسية إلى «عامّ» أو أزل الدور الخارجيّ." />
      )}
      <Field label="النصّ المعتمَد" hint="هذا هو ما يُفهرَس ويُقتبَس حرفيًّا. اكتب ما يصحّ اقتباسه أمام عميل أو مدقّق.">
        <textarea value={String(draft.content_text ?? "")} onChange={(e) => set("content_text", e.target.value)} rows={8} style={inputStyle} />
      </Field>
      <div style={{ display: "flex", gap: "8px" }}>
        <Btn tone="accent" onClick={() => void onSave(draft)}>حفظ كمسودّة</Btn>
        <Btn onClick={() => setDraft(null)}>إلغاء</Btn>
      </div>
    </Card>
  );
}

// ─── المحادثات ──────────────────────────────────────────────────────────────

function ConversationsTab({ st }: { st: AiAssistantStatePayload }) {
  const [rows, setRows] = useState<AiState<AiConversationRow[]> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<AiState<AiMessageRow[]> | null>(null);
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => { setRows(await aiConversationList(50)); }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!open) { setMsgs(null); return; }
    void (async () => setMsgs(await aiConversationMessages(open)))();
  }, [open]);

  return (
    <>
      {notice && <Card><div style={{ fontSize: "12.5px", lineHeight: 2 }}>{notice}</div></Card>}
      <Card
        title="المحادثات"
        note="تُحفَظ الرسائل ومراجعها فقط. ⛔ لا تُخزَّن سلسلة تفكير ولا نصّ نظام ولا سياق داخليّ — القيود الجدولية تجعل ذلك غير ممكن أصلًا."
      >
        {rows === null ? <Empty what="جارٍ التحميل…" /> : (
          <StateScreen s={rows}>
            {(list) => list.length === 0 ? (
              <Empty what="لا توجد محادثات بعد." why="هذا صفر حقيقيّ: لم تُطرَح أسئلة، أو أنّ ما وُجد يخصّ مستخدمين آخرين ولا تملك مفتاح عرض الكلّ." />
            ) : (
              <div style={{ display: "grid", gap: "8px" }}>
                {list.map((c) => (
                  <div key={c.id} style={{ border: `1px solid ${AC.line}`, borderRadius: "6px", padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                      <Badge text={c.actor_kind === "public" ? "عامّة" : "داخلية"} tone={c.actor_kind === "public" ? "amber" : "dim"} />
                      <Badge text={`${c.message_count} رسالة`} />
                      {c.redaction_status !== "none" && <Badge text={`تنقيح: ${c.redaction_status}`} tone="amber" />}
                      {c.escalation_status !== "none" && <Badge text={`تسليم بشريّ: ${c.escalation_status}`} tone="blue" />}
                    </div>
                    <div style={{ fontSize: "12.5px" }}>{c.title || "بلا عنوان"}</div>
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                      <Btn onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "إغلاق" : "عرض"}</Btn>
                      <Btn onClick={async () => {
                        const r = await aiConversationEscalate(c.id, "طلب مراجعة بشرية");
                        setNotice(r.state === "ok" ? "سُجّل طلب التسليم البشريّ. ⛔ لم يُرسَل بريد ولا إشعار خارجيّ — الحالة تظهر في هذه الشاشة." : r.message);
                        await reload();
                      }}>تسليم لإنسان</Btn>
                      {st.can_redact && (
                        <Btn tone="red" onClick={async () => {
                          const r = await aiConversationRedact(c.id, "طلب تنقيح");
                          setNotice(r.state === "ok" ? "نُقِّحت الرسائل." : r.message);
                          await reload();
                        }}>تنقيح</Btn>
                      )}
                    </div>
                    {open === c.id && msgs && (
                      <div style={{ marginTop: "10px" }}>
                        <StateScreen s={msgs}>
                          {(list2) => (
                            <div style={{ display: "grid", gap: "8px" }}>
                              {list2.map((m) => (
                                <div key={m.id} style={{ borderInlineStart: `2px solid ${m.role === "user" ? AC.blue : AC.line}`, paddingInlineStart: "10px" }}>
                                  <div style={{ color: AC.dim, fontSize: "10.5px", marginBottom: "3px" }}>
                                    {m.role === "user" ? "سؤال" : m.role === "assistant" ? "ردّ" : "إشعار نظام"}
                                    {" · "}مصادر: {m.retrieved_count}
                                    {m.refusal_code ? ` · رفض: ${m.refusal_code}` : ""}
                                  </div>
                                  <div style={{ fontSize: "12.5px", lineHeight: 2, whiteSpace: "pre-wrap" }}>{m.content}</div>
                                  {(m.citations ?? []).length > 0 && (
                                    <ul style={{ margin: "6px 0 0", padding: 0 }}>
                                      {m.citations.map((ct) => <Citation key={`${ct.source_id}-${ct.source_version}`} c={ct} />)}
                                    </ul>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </StateScreen>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </StateScreen>
        )}
      </Card>
    </>
  );
}

// ─── مسوّدات العملاء المحتملين ──────────────────────────────────────────────

function LeadsTab({ st }: { st: AiAssistantStatePayload }) {
  const [rows, setRows] = useState<AiState<AiLeadDraft[]> | null>(null);
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => { setRows(await aiLeadList(null, 100)); }, []);
  useEffect(() => { void reload(); }, [reload]);

  if (!st.can_review_leads) {
    return <Card title="مسوّدات العملاء المحتملين"><Denied message="لا تملك صلاحية مراجعة المسوّدات (ai.lead.review)." /></Card>;
  }

  return (
    <>
      {notice && <Card><div style={{ fontSize: "12.5px", lineHeight: 2 }}>{notice}</div></Card>}
      <Card
        title="مسوّدات العملاء المحتملين"
        note="⛔ المراجعة هنا لا تُنشئ عميلًا ولا فرصة ولا عرض سعر ولا ترسل بريدًا. التحويل قرار بشريّ في وحدة المبيعات بأدواتها ومسار تدقيقها."
      >
        {rows === null ? <Empty what="جارٍ التحميل…" /> : (
          <StateScreen s={rows}>
            {(list) => list.length === 0 ? (
              <Empty what="لا توجد مسوّدات." why="صفر حقيقيّ: لم يصل طلب من المساعد العامّ بعد." />
            ) : (
              <div style={{ display: "grid", gap: "10px" }}>
                {list.map((d) => (
                  <div key={d.id} style={{ border: `1px solid ${AC.line}`, borderRadius: "6px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
                      <Badge text={AI_LEAD_STATUS_AR[d.status] ?? d.status} tone={d.status === "pending_human_review" ? "amber" : d.status === "accepted" ? "green" : "dim"} />
                      <Badge text={`تسليم: ${d.handoff_status === "awaiting_human" ? "بانتظار إنسان" : d.handoff_status}`} tone="blue" />
                      <Badge text={`CAPTCHA: ${d.captcha_status}`} tone={d.captcha_status === "verified" ? "green" : "dim"} />
                    </div>
                    <Val label="الاسم">{d.full_name || "—"}</Val>
                    <Val label="التواصل">{d.email || d.phone || "—"}</Val>
                    {d.company && <Val label="الجهة">{d.company}</Val>}
                    {d.service_interest && <Val label="الخدمة">{d.service_interest}</Val>}
                    <Val label="الرسالة"><span style={{ whiteSpace: "pre-wrap" }}>{d.message || "—"}</span></Val>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                      {(["accepted", "rejected", "spam"] as const).map((s) => (
                        <Btn key={s} tone={s === "accepted" ? "green" : s === "spam" ? "red" : "dim"} onClick={async () => {
                          const r = await aiLeadReview(d.id, s, "مراجعة يدوية");
                          setNotice(r.state === "ok"
                            ? `حُدِّثت الحالة إلى «${AI_LEAD_STATUS_AR[s]}». ⛔ لم يُرسَل بريد ولم يُنشَأ عميل — التحويل قرار بشريّ منفصل.`
                            : r.message);
                          await reload();
                        }}>{AI_LEAD_STATUS_AR[s]}</Btn>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </StateScreen>
        )}
      </Card>
    </>
  );
}

// ─── الحالة والمزوّد ────────────────────────────────────────────────────────

function StatusTab({ st, onReload }: { st: AiAssistantStatePayload; onReload: () => Promise<void> }) {
  const [overview, setOverview] = useState<AiState<Record<string, unknown>> | null>(null);
  useEffect(() => { void (async () => setOverview(await aiAdminOverview()))(); }, []);

  const p = st.provider;
  const providerCalls = overview?.state === "ok"
    ? (overview.data.provider_calls as Record<string, unknown> | undefined)
    : undefined;

  return (
    <>
      <Card title="حالة المزوّد" note="هذه الشاشة موجودة لتقول الحقيقة صراحةً: لا يوجد نموذج، ولا نداء خارجيّ، ولا إجراء تلقائيّ.">
        <Val label="اسم المزوّد">{p?.provider ?? "mock"}</Val>
        <Val label="مفعّل؟"><Badge text={p?.enabled ? "⚠️ نعم" : "لا"} tone={p?.enabled ? "red" : "green"} /></Val>
        <Val label="الحالة">{p?.status ?? "not_configured"}</Val>
        <Val label="اعتمادات في المستودع"><Badge text={p?.credentials_in_repo ? "⚠️ نعم" : "لا"} tone={p?.credentials_in_repo ? "red" : "green"} /></Val>
        <Val label="نداء من المتصفّح"><Badge text={p?.browser_calls_allowed ? "⚠️ مسموح" : "ممنوع"} tone={p?.browser_calls_allowed ? "red" : "green"} /></Val>
        <Val label="إجراءات تلقائية"><Badge text={p?.autonomous_actions ? "⚠️ مفعّلة" : "معطّلة"} tone={p?.autonomous_actions ? "red" : "green"} /></Val>
        <Val label="تنفيذ أدوات"><Badge text={p?.tool_execution ? "⚠️ مفعّل" : "معطّل"} tone={p?.tool_execution ? "red" : "green"} /></Val>
        <Val label="التكلفة">
          {p?.cost_metadata?.estimated_cost === null || p?.cost_metadata?.estimated_cost === undefined
            ? "غير مقيسة — لا مزوّد. (وليست صفرًا: الصفر يعني «قِيس فكان صفرًا».)"
            : String(p.cost_metadata.estimated_cost)}
        </Val>
        <Val label="النداءات الخارجية المسجَّلة">
          {providerCalls
            ? `محاولات مسجَّلة: ${String(providerCalls.logged_attempts ?? 0)} — نداءات خارجية: ${String(providerCalls.external_calls ?? 0)}`
            : "غير متاحة ضمن صلاحيتك."}
        </Val>
      </Card>

      <Card title="صلاحياتك في المساعد">
        <Val label="استخدام المساعد الداخليّ"><Badge text={st.can_use_internal ? "نعم" : "لا"} tone={st.can_use_internal ? "green" : "dim"} /></Val>
        <Val label="عرض سجلّ المعرفة"><Badge text={st.can_view_knowledge ? "نعم" : "لا"} tone={st.can_view_knowledge ? "green" : "dim"} /></Val>
        <Val label="إدارة المصادر"><Badge text={st.can_manage_knowledge ? "نعم" : "لا"} tone={st.can_manage_knowledge ? "green" : "dim"} /></Val>
        <Val label="اعتماد المصادر"><Badge text={st.can_approve_knowledge ? "نعم" : "لا"} tone={st.can_approve_knowledge ? "green" : "dim"} /></Val>
        <Val label="مراجعة المسوّدات"><Badge text={st.can_review_leads ? "نعم" : "لا"} tone={st.can_review_leads ? "green" : "dim"} /></Val>
        <Val label="تنقيح المحادثات"><Badge text={st.can_redact ? "نعم" : "لا"} tone={st.can_redact ? "green" : "dim"} /></Val>
        <div style={{ color: AC.dim, fontSize: "11.5px", marginTop: "8px", lineHeight: 2 }}>
          هذه قراءة من القاعدة لا من الواجهة. لو ظهر «نعم» ورفضت القاعدة الإجراء فالقاعدة هي الصادقة — أبلغ الفريق التقنيّ.
        </div>
        <div style={{ marginTop: "10px" }}><Btn onClick={() => void onReload()}>تحديث</Btn></div>
      </Card>
    </>
  );
}
