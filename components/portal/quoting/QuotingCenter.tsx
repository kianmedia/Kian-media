"use client";
// ════════════════════════════════════════════════════════════════════════════
// QuotingCenter — مركز التسعير: القائمة، الإنشاء، واعتمادات المالك.
//
// تبويب «الاعتمادات» يظهر فقط حين يقول الخادم internal_visible: true — وهي
// قيمة **ثابتة لكلّ المستخدم** لا تخصّ عرضًا بعينه، فلا تحمل معلومة عن أيّ
// عرض. ومع ذلك ليست هي الحماية: نداءات ذلك التبويب تشترط sq_can_view_cost()
// وتردّ 42501. إخفاء التبويب ترتيبٌ للتجربة، لا تفويض.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  fetchQuotingSettings, fetchQuotes, fetchQuoteDashboard, createQuote,
  fetchOwnerApprovals, fetchOwnerDashboard, decideApproval, fetchMyApprovals,
  sar, pct,
  type QuotingSettings, type QuoteRow, type QuoteDashboard, type QuoteStatus,
  type OwnerApprovalRow, type OwnerDashboard, type QuoteApproval, type SqState,
} from "@/lib/portal/quoting";
import {
  card, btnPrimary, btnGhost, fieldCls, labelCls, Spinner, StateView, Money,
  StatusPill, SectionTitle, Field, Empty, ErrorBox,
} from "./QuotingAtoms";
import QuoteBuilder from "./QuoteBuilder";

type Tab = "quotes" | "my_approvals" | "owner";

export default function QuotingCenter() {
  const [settings, setSettings] = useState<SqState<QuotingSettings> | null>(null);
  const [tab, setTab] = useState<Tab>("quotes");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => { setSettings(await fetchQuotingSettings()); }, []);
  useEffect(() => { void load(); }, [load]);

  if (!settings) return <Spinner />;

  return (
    <div dir="rtl">
      <StateView state={settings} onRetry={() => void load()}>
        {(s) => {
          if (selected) {
            return <QuoteBuilder quoteId={selected} onBack={() => setSelected(null)} />;
          }
          return (
            <div className="space-y-4">
              <nav className="flex gap-2 flex-wrap border-b border-stone-800 pb-3">
                <TabBtn active={tab === "quotes"} onClick={() => setTab("quotes")}>العروض</TabBtn>
                <TabBtn active={tab === "my_approvals"} onClick={() => setTab("my_approvals")}>
                  طلبات اعتمادي
                </TabBtn>
                {s.internal_visible && (
                  <TabBtn active={tab === "owner"} onClick={() => setTab("owner")}>
                    اعتمادات المالك والربحية
                  </TabBtn>
                )}
              </nav>

              {tab === "quotes" && <QuotesTab settings={s} onOpen={setSelected} />}
              {tab === "my_approvals" && <MyApprovalsTab />}
              {tab === "owner" && s.internal_visible && <OwnerTab onOpen={setSelected} />}
            </div>
          );
        }}
      </StateView>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-[44px] px-4 rounded-lg text-sm transition-colors ${
        active ? "bg-red-700 text-white" : "bg-stone-800 text-stone-300 hover:bg-stone-700"
      }`}
    >
      {children}
    </button>
  );
}

// ─── العروض ─────────────────────────────────────────────────────────────────

const STATUS_FILTERS: { v: QuoteStatus | ""; ar: string }[] = [
  { v: "", ar: "الكلّ" },
  { v: "draft", ar: "مسودّة" },
  { v: "internal_review", ar: "مراجعة داخلية" },
  { v: "pending_owner_approval", ar: "بانتظار الاعتماد" },
  { v: "approved", ar: "معتمد" },
  { v: "sent_placeholder", ar: "جاهز للإرسال اليدوي" },
  { v: "accepted", ar: "مقبول" },
  { v: "rejected", ar: "مرفوض" },
  { v: "expired", ar: "منتهٍ" },
];

function QuotesTab({ settings, onOpen }: { settings: QuotingSettings; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<SqState<QuoteRow[]> | null>(null);
  const [dash, setDash] = useState<QuoteDashboard | null>(null);
  const [filter, setFilter] = useState<QuoteStatus | "">("");
  const [creating, setCreating] = useState(false);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await fetchQuotes({ status: filter === "" ? null : filter }));
    const d = await fetchQuoteDashboard();
    if (d.state === "ok") setDash(d.data);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      {dash && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="الإجمالي" v={dash.total} />
          <Stat label="بانتظار الاعتماد" v={dash.pending_approval} />
          <Stat label="جاهز للإرسال اليدوي" v={dash.ready_manual_send} />
          <Stat label="مقبول" v={dash.accepted} />
        </div>
      )}

      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <label className={labelCls}>الحالة</label>
          <select
            className={fieldCls} value={filter}
            onChange={(e) => setFilter(e.target.value as QuoteStatus | "")}
          >
            {STATUS_FILTERS.map((f) => <option key={f.v} value={f.v}>{f.ar}</option>)}
          </select>
        </div>
        {settings.can_build && (
          <button className={btnPrimary} onClick={() => setCreating((v) => !v)}>
            {creating ? "إلغاء" : "عرض سعر جديد"}
          </button>
        )}
      </div>

      {creating && settings.can_build && (
        <div className={`${card} p-4 space-y-3`}>
          <SectionTitle note="يُبنى العرض على أحدث نسخة منشورة من دفتر الأسعار. لا يُبنى عرض قبل نشر نسخة.">
            عرض سعر جديد
          </SectionTitle>
          <Field label="مُعرِّف العميل (UUID)">
            <input className={fieldCls} value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </Field>
          <Field label="عنوان العرض">
            <input className={fieldCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <button
            className={btnPrimary} disabled={busy || !clientId || !title}
            onClick={async () => {
              setBusy(true); setMsg(null);
              const r = await createQuote({ clientId, title });
              setBusy(false);
              if (r.state === "ok") {
                setCreating(false); setClientId(""); setTitle("");
                await load();
                if (typeof r.data === "string") onOpen(r.data);
              } else setMsg(r.message);
            }}
          >
            إنشاء
          </button>
          {msg && <ErrorBox message={msg} />}
        </div>
      )}

      {!rows ? <Spinner /> : (
        <StateView
          state={rows} onRetry={() => void load()}
          emptyWhen={(d) => d.length === 0}
          emptyMessage="لا عروض ضمن صلاحيتك بهذا المرشّح."
        >
          {(list) => (
            <div className="space-y-2">
              {list.map((q) => (
                <button
                  key={q.id} onClick={() => onOpen(q.id)}
                  className={`${card} p-4 w-full text-right hover:border-stone-700 transition-colors`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-stone-100 text-sm font-medium truncate">{q.title}</p>
                      <p className="text-xs text-stone-500 mt-1">
                        {q.code} · نسخة {q.version_no}
                        {q.valid_until ? ` · حتى ${q.valid_until}` : ""}
                      </p>
                    </div>
                    <StatusPill status={q.status} />
                  </div>
                  <div className="mt-3 flex gap-4 flex-wrap text-xs">
                    <span className="text-stone-500">
                      المعتمَد: <Money value={q.authorized_price} unknownText="لم يُعتمد بعد" />
                    </span>
                    <span className="text-stone-500">
                      الضريبة: <Money value={q.vat_amount} unknownText="—" />
                    </span>
                    <span className="text-stone-500">
                      بعد الضريبة: <Money value={q.total_after_vat} unknownText="—" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </StateView>
      )}
    </div>
  );
}

function MyApprovalsTab() {
  const [rows, setRows] = useState<SqState<QuoteApproval[]> | null>(null);
  const load = useCallback(async () => { setRows(await fetchMyApprovals()); }, []);
  useEffect(() => { void load(); }, [load]);

  if (!rows) return <Spinner />;
  return (
    <StateView
      state={rows} onRetry={() => void load()}
      emptyWhen={(d) => d.length === 0}
      emptyMessage="لم ترفع طلبات اعتماد بعد."
    >
      {(list) => (
        <div className="space-y-2">
          <p className="text-xs text-stone-500 leading-6">
            ملاحظة القرار نصٌّ يكتبه المالك بيده. ما لا يكتبه لا يظهر هنا.
          </p>
          {list.map((a) => (
            <div key={a.id} className={`${card} p-4`}>
              <div className="flex justify-between gap-3 flex-wrap">
                <span className="text-sm text-stone-200">{a.quote_code}</span>
                <span className="text-xs text-stone-400">{a.status}</span>
              </div>
              <p className="text-xs text-stone-500 mt-2">
                المطلوب: <Money value={a.requested_price} unknownText="—" />
                {a.requested_discount_pct !== null ? ` · خصم ${pct(a.requested_discount_pct)}` : ""}
              </p>
              {a.decision_note && (
                <p className="text-xs text-stone-300 mt-2 leading-6">{a.decision_note}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </StateView>
  );
}

// ─── سطح المالك ─────────────────────────────────────────────────────────────

function OwnerTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<SqState<OwnerApprovalRow[]> | null>(null);
  const [dash, setDash] = useState<OwnerDashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setRows(await fetchOwnerApprovals("pending"));
    const d = await fetchOwnerDashboard();
    if (d.state === "ok") setDash(d.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(async (id: string, decision: "approved" | "rejected") => {
    setBusy(true); setMsg(null);
    const raw = priceEdits[id];
    const r = await decideApproval({
      approvalId: id, decision,
      authorizedPrice: decision === "approved" && raw ? Number(raw) : null,
      note: notes[id] ?? null,
    });
    setBusy(false);
    setMsg(r.state === "ok" ? "سُجّل القرار." : r.message);
    if (r.state === "ok") await load();
  }, [priceEdits, notes, load]);

  if (!rows) return <Spinner />;

  return (
    <div className="space-y-4">
      {dash && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="بانتظار اعتمادك" v={dash.pending_approval} />
            <Stat label="تحت الحدّ الأدنى" v={dash.below_floor} tone="danger" />
            <Stat label="تسعير ناقص التكلفة" v={dash.incomplete_costing} tone="warn" />
            <Stat label="تنبيهات تحسّس" v={dash.probe_alerts} tone="warn" />
          </div>
          <div className={`${card} p-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm`}>
            <KV label="قيمة الصفقات المقبولة" v={sar(dash.accepted_value)} />
            <KV label="ربح الصفقات المقبولة" v={sar(dash.accepted_profit)} />
            <KV label="متوسّط الهامش" v={dash.avg_margin_pct !== null ? pct(dash.avg_margin_pct) : "—"} />
          </div>
          {dash.incomplete_costing > 0 && (
            <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-900/50 rounded-lg p-3 leading-6">
              ⚠️ {dash.incomplete_costing} عرضًا حُسب بتكلفة ناقصة (بنود بلا سعر تكلفة). هوامش تلك
              العروض تبدو أعلى ممّا هي فعلًا — لا تعتمدها قبل إكمال أسعار التكلفة.
            </p>
          )}
        </>
      )}

      <StateView
        state={rows} onRetry={() => void load()}
        emptyWhen={(d) => d.length === 0}
        emptyMessage="لا طلبات اعتماد معلّقة."
      >
        {(list) => (
          <div className="space-y-3">
            {list.map((a) => (
              <div key={a.id} className={`${card} p-4 space-y-3 ${a.below_floor ? "border-red-900/60" : ""}`}>
                <div className="flex justify-between gap-3 flex-wrap">
                  <button className="text-sm text-stone-100 underline" onClick={() => onOpen(a.quote_id)}>
                    {a.quote_code}
                  </button>
                  <span className="text-xs text-stone-500">{a.kind}</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <KV label="السعر المطلوب" v={<Money value={a.requested_price} />} />
                  <KV label="الحدّ الأدنى وقت الطلب" v={<Money value={a.floor_at_request} unknownText="لم يُحسب" />} />
                  <KV label="التكلفة التقديرية" v={<Money value={a.internal_cost_estimate} unknownText="لم تُحسب" />} />
                  <KV label="نسبة الهامش" v={a.margin_pct !== null ? pct(a.margin_pct) : "—"} />
                </div>

                {a.below_floor && (
                  <p className="text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded-lg p-2.5 leading-6">
                    ★ الطلب تحت الحدّ الأدنى. مقدّم الطلب لا يرى هذا الرقم ولم يُخبَر به.
                  </p>
                )}
                {a.reason && <p className="text-xs text-stone-400 leading-6">سبب مقدّم الطلب: {a.reason}</p>}

                <div className="grid gap-2 md:grid-cols-2">
                  <Field label="سعر الاعتماد (اتركه فارغًا لاعتماد المطلوب)">
                    <input
                      className={fieldCls} type="number" min="0" step="0.01"
                      value={priceEdits[a.id] ?? ""}
                      onChange={(e) => setPriceEdits((p) => ({ ...p, [a.id]: e.target.value }))}
                    />
                  </Field>
                  <Field
                    label="ملاحظة لمقدّم الطلب"
                    hint="يراها مقدّم الطلب كما كتبتَها. ما تكتبه هنا اختيارك أنت — ولا يُفصح النظام عن الحدّ الأدنى نيابةً عنك."
                  >
                    <input
                      className={fieldCls} value={notes[a.id] ?? ""}
                      onChange={(e) => setNotes((p) => ({ ...p, [a.id]: e.target.value }))}
                    />
                  </Field>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button className={btnPrimary} disabled={busy} onClick={() => void decide(a.id, "approved")}>
                    اعتماد
                  </button>
                  <button className={btnGhost} disabled={busy} onClick={() => void decide(a.id, "rejected")}>
                    رفض
                  </button>
                </div>
              </div>
            ))}
            {msg && <p className="text-xs text-stone-300">{msg}</p>}
          </div>
        )}
      </StateView>
    </div>
  );
}

function Stat({ label, v, tone }: { label: string; v: number; tone?: "warn" | "danger" }) {
  const c = tone === "danger" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-stone-100";
  return (
    <div className={`${card} p-3`}>
      <p className="text-[11px] text-stone-500">{label}</p>
      <p className={`text-lg font-semibold mt-1 ${c}`} dir="ltr">{v}</p>
    </div>
  );
}

function KV({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-stone-500">{label}</p>
      <p className="text-stone-200 mt-0.5">{v}</p>
    </div>
  );
}
