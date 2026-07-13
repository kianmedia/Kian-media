"use client";
// ════════════════════════════════════════════════════════════════════════════
// بوابة تأجير المعدات والتأمين — لوحة الإدارة. تبويبات: نظرة عامة/الطلبات/إنشاء/
// التقويم/التقارير. كل الكتابة عبر RPCs محمية بالقاعدة (state machine + RLS).
// الإجراءات التشغيلية (اعتماد/عقد/توقيع/تسليم/إرجاع/فحص/رسوم/إغلاق) في RentalDetail.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { civListAssets, type CivAsset } from "@/lib/portal/custodyInventory";
import {
  rentalDashboard, rentalListRequests, rentalUpsertRequest, rentalAddItem,
  rentalRemoveItem, rentalAvailability, rentalSubmit, rentalListItems, rentalCalendar,
  rentalSearchClients, rentalLinkPortalClient, emitRentalEvent,
  type RentalDashboard, type RentalRequest, type RentalItem, type RentalStatus,
  type RentalAvailability, type RentalPortalClient,
} from "@/lib/portal/rental";
import { riyadhInputToUtcISO, validateWindow, defaultRentalWindow, endPlus24h, formatRiyadh, rentalErrorAr } from "@/lib/portal/rentalTime";
import RentalDetail from "@/components/portal/rental/RentalDetail";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const th = "text-right text-[11px] text-stone-500 font-medium px-2 py-1.5";
const td = "text-right text-xs text-stone-300 px-2 py-1.5 border-t border-stone-800";
type T = (m: { ar: string; en: string }) => string;
type Tab = "overview" | "requests" | "create" | "calendar" | "reports";
const PAGE = 20;

const STATUS_AR: Record<string, string> = {
  draft: "مسودة", pending_approval: "بانتظار الاعتماد", rejected: "مرفوض", approved: "معتمد",
  awaiting_customer_confirmation: "بانتظار العميل", contract_pending_signature: "بانتظار التوقيع",
  scheduled: "مجدول", preparing: "تجهيز", ready_for_handover: "جاهز للتسليم", active: "نشط",
  return_requested: "طلب إرجاع", inspection_pending: "فحص إرجاع", charges_pending: "تسوية", closed: "مغلق",
  cancelled: "ملغى", overdue: "متأخر", requested: "طلب", reviewing: "مراجعة", quoted: "مسعّر", contracted: "متعاقد", under_inspection: "فحص",
};
export const rentalStatusAr = (s: string) => STATUS_AR[s] ?? s;

export default function RentalConsole() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("overview");
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3600); };
  const [detail, setDetail] = useState<string | null>(null);

  const TABS: { k: Tab; ar: string; en: string }[] = [
    { k: "overview", ar: "نظرة عامة", en: "Overview" }, { k: "requests", ar: "الطلبات", en: "Requests" },
    { k: "create", ar: "إنشاء طلب", en: "New" }, { k: "calendar", ar: "التقويم", en: "Calendar" }, { k: "reports", ar: "التقارير", en: "Reports" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((x) => (
          <button key={x.k} onClick={() => setTab(x.k)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${tab === x.k ? "bg-red-600 text-white" : "bg-stone-800 text-stone-300 border border-stone-700"}`}>{t({ ar: x.ar, en: x.en })}</button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab onGo={() => setTab("requests")} openDetail={setDetail} t={t} />}
      {tab === "requests" && <RequestsTab openDetail={setDetail} t={t} />}
      {tab === "create" && <CreateTab flash={flash} onCreated={(id) => { setDetail(id); setTab("requests"); }} t={t} />}
      {tab === "calendar" && <CalendarTab openDetail={setDetail} t={t} />}
      {tab === "reports" && <ReportsTab t={t} />}

      {detail && <RentalDetail requestId={detail} onClose={() => setDetail(null)} onChanged={() => { /* الأبناء يعيدون التحميل */ }} t={t} />}
      {toast && <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-md bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}

// ─── نظرة عامة ───
function OverviewTab({ onGo, openDetail, t }: { onGo: () => void; openDetail: (id: string) => void; t: T }) {
  const [dash, setDash] = useState<RentalDashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void rentalDashboard().then((r) => { if (r.ok) setDash(r.data); else setErr(r.error); }); }, []);
  if (err) return <div className="bg-red-950/40 border border-red-900/60 rounded-xl p-3 text-sm text-red-300">{t({ ar: "تعذّر التحميل: ", en: "Failed: " })}<span dir="ltr">{err}</span></div>;
  if (!dash) return <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  const cards: [string, number][] = [
    ["طلبات جديدة", dash.new], ["بانتظار الاعتماد", dash.pending_approval], ["بانتظار التوقيع", dash.pending_signature],
    ["تسليم اليوم", dash.handover_today], ["إرجاع اليوم", dash.return_today], ["تأجيرات نشطة", dash.active],
    ["متأخرة", dash.overdue], ["مطالبات مفتوحة", dash.open_charges], ["تأمينات محتجزة", dash.deposits_held], ["بانتظار رد التأمين", dash.deposits_release_pending],
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map(([l, v]) => (
        <button key={l} onClick={onGo} className={`${card} text-right hover:border-red-700`}>
          <div className="text-2xl font-semibold text-white">{v}</div><div className="text-[11px] text-stone-400 mt-1">{l}</div>
        </button>
      ))}
    </div>
  );
}

// ─── الطلبات ───
function RequestsTab({ openDetail, t }: { openDetail: (id: string) => void; t: T }) {
  const [rows, setRows] = useState<RentalRequest[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "not_prepared" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const reload = useCallback(async () => {
    setState("loading");
    const r = await rentalListRequests(status ? { status } : undefined);
    if (!r.ok) { setErrMsg(r.error); setState(/does not exist|PGRST|schema|relation/i.test(r.error) ? "not_prepared" : "error"); return; }
    setRows(r.data); setPage(0); setState("ready");
  }, [status]);
  useEffect(() => { void reload(); }, [reload]);
  const filtered = rows.filter((r) => !q || r.request_number.toLowerCase().includes(q.toLowerCase()));
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const STATUSES = ["", "draft", "pending_approval", "approved", "contract_pending_signature", "scheduled", "active", "overdue", "return_requested", "inspection_pending", "charges_pending", "closed", "cancelled"];
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث برقم الطلب", en: "Search #" })} className={`${inp} flex-1 min-w-[160px]`} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inp} w-auto`}>{STATUSES.map((s) => <option key={s} value={s}>{s ? rentalStatusAr(s) : t({ ar: "كل الحالات", en: "All" })}</option>)}</select>
        <button onClick={() => void reload()} className={`${btnGhost} px-3 py-2 text-xs`}>↻</button>
      </div>
      {state === "loading" && <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {state === "not_prepared" && <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-3 text-sm text-amber-300"><div>{t({ ar: "وحدة التأجير غير مجهزة في قاعدة البيانات.", en: "Rental module not prepared." })}</div><div className="font-mono text-[11px]" dir="ltr">Run: docs/rental_insurance_production_RUNME.sql</div></div>}
      {state === "error" && <div className="bg-red-950/40 border border-red-900/60 rounded-xl p-3 text-sm text-red-300">{t({ ar: "تعذّر: ", en: "Failed: " })}<span dir="ltr">{errMsg}</span></div>}
      {state === "ready" && filtered.length === 0 && <p className="text-sm text-stone-400 bg-stone-900 border border-stone-800 rounded-xl p-3">{t({ ar: "لا طلبات.", en: "No requests." })}</p>}
      {state === "ready" && pageRows.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[640px]">
        <thead><tr><th className={th}>رقم الطلب</th><th className={th}>الحالة</th><th className={th}>من</th><th className={th}>إلى</th><th className={th}>الإجمالي</th><th className={th}>الوديعة</th><th className={th}></th></tr></thead>
        <tbody>{pageRows.map((r) => (
          <tr key={r.id}>
            <td className={`${td} font-mono`} dir="ltr">{r.request_number}</td>
            <td className={td}><span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800 border border-stone-700">{rentalStatusAr(r.status)}</span></td>
            <td className={td} dir="ltr">{formatRiyadh(r.rental_from, false)}</td>
            <td className={td} dir="ltr">{formatRiyadh(r.rental_to, false)}</td>
            <td className={td} dir="ltr">{r.grand_total ? `${r.grand_total} ${r.currency}` : "—"}</td>
            <td className={td}>{r.deposit_amount ? rentalStatusAr(r.deposit_status) : "—"}</td>
            <td className={td}><button onClick={() => openDetail(r.id)} className={`${btnGhost} px-2 py-1 text-[11px]`}>تفاصيل</button></td>
          </tr>
        ))}</tbody>
      </table></div>}
      {state === "ready" && pages > 1 && <div className="flex items-center justify-center gap-2"><button disabled={page === 0} onClick={() => setPage(page - 1)} className={`${btnGhost} px-3 py-1 text-xs`}>‹</button><span className="text-[11px] text-stone-500">{page + 1}/{pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className={`${btnGhost} px-3 py-1 text-xs`}>›</button></div>}
    </div>
  );
}

// ─── إنشاء طلب ───
const lbl = "block text-[11px] text-stone-400 mb-1";
const field = "space-y-0.5";

function availAr(a: RentalAvailability): string {
  if (a.available) return `متاح · الكمية المتاحة: ${a.available_quantity}`;
  if (a.available_quantity > 0 && a.requested_quantity > a.available_quantity)
    return `الكمية المطلوبة غير متاحة. المتاح حاليًا: ${a.available_quantity}`;
  const st = a.availability_status ?? "";
  const reason =
    a.conflicting_source === "asset_status" || /lost/.test(a.reason) ? (/, retired/.test(st) ? "الأصل غير نشط." : "الأصل تالف أو مفقود.")
    : a.conflicting_source === "other_rental" ? "الأصل محجوز لتأجير آخر."
    : a.conflicting_source === "custody_reservation" ? "الأصل في عهدة موظف."
    : a.conflicting_source === "maintenance" ? "الأصل في الصيانة."
    : "الكمية غير كافية.";
  const next = a.next_available_at ? ` · يتاح بعد: ${formatRiyadh(a.next_available_at, false)}` : "";
  return `غير متاح في الفترة المحددة — الكمية المتاحة: ${a.available_quantity}. ${reason}${next}`;
}

function CreateTab({ flash, onCreated, t }: { flash: (m: string) => void; onCreated: (id: string) => void; t: T }) {
  const [renterType, setRenterType] = useState<"registered" | "external">("registered");
  const [clientQ, setClientQ] = useState("");
  const [clientResults, setClientResults] = useState<RentalPortalClient[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [clientSearched, setClientSearched] = useState(false);
  const [chosen, setChosen] = useState<{ customer_id: string; full_name: string | null; company: string | null; email: string | null; phone: string | null } | null>(null);

  const dw = useRef(defaultRentalWindow()).current;
  const [assets, setAssets] = useState<CivAsset[]>([]);
  const [f, setF] = useState<Record<string, string>>({ party_type: "individual", rental_from: dw.from, rental_to: dw.to });
  const [items, setItems] = useState<RentalItem[]>([]);
  const [reqId, setReqId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [winErr, setWinErr] = useState<string | null>(null);
  const [pick, setPick] = useState(""); const [pickQty, setPickQty] = useState("1");
  const [avail, setAvail] = useState<RentalAvailability | null>(null);
  const [availBusy, setAvailBusy] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { void civListAssets().then((r) => { if (r.ok) setAssets(r.data); }); }, []);
  // أي تغيير في المعدّة/الكمية/النافذة يُلغي نتيجة الفحص القديمة (لا اعتماد عليها).
  useEffect(() => { setAvail(null); }, [pick, pickQty, f.rental_from, f.rental_to]);
  useEffect(() => { const e = validateWindow(f.rental_from, f.rental_to); setWinErr(e ? rentalErrorAr(e) : null); }, [f.rental_from, f.rental_to]);

  function onFromChange(v: string) {
    set("rental_from", v);
    const fromISO = riyadhInputToUtcISO(v);
    const toISO = riyalToISO(f.rental_to);
    if (fromISO && (!toISO || new Date(toISO).getTime() <= new Date(fromISO).getTime())) { const np = endPlus24h(v); if (np) set("rental_to", np); }
  }
  function riyalToISO(v?: string) { return riyadhInputToUtcISO(v); }

  async function searchClients() {
    setClientSearching(true); const r = await rentalSearchClients(clientQ.trim() || undefined, 20, 0); setClientSearching(false);
    setClientSearched(true);
    if (r.ok) setClientResults(r.data.rows); else { setClientResults([]); flash(rentalErrorAr(r.error)); }
  }
  async function pickClient(c: RentalPortalClient) {
    // إن كان العميل مرتبطًا مسبقًا (rental_customer_id) استخدمه مباشرة — لا upsert/تكرار.
    if (c.rental_customer_id) {
      setChosen({ customer_id: c.rental_customer_id, full_name: c.full_name, company: c.company, email: c.email, phone: c.mobile });
      set("customer_id", c.rental_customer_id); set("party_type", (c.company && c.company.trim()) ? "company" : "individual");
      setReqId(null); setClientResults([]); setClientSearched(false); return;
    }
    setBusy(true); const r = await rentalLinkPortalClient(c.profile_id); setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    setChosen({ customer_id: r.data.customer_id, full_name: r.data.full_name, company: r.data.company, email: r.data.email, phone: r.data.phone });
    set("customer_id", r.data.customer_id); set("party_type", r.data.party_type);
    setReqId(null); setClientResults([]); setClientSearched(false);
  }
  function clearClient() { setChosen(null); set("customer_id", ""); setReqId(null); setClientResults([]); setClientSearched(false); }

  // ينشئ المسودة أو يزامن نافذتها/مواقعها إن كانت موجودة (يمرّر id) — كي لا تُرسَل نافذة قديمة.
  async function ensureDraft(): Promise<string | null> {
    const we = validateWindow(f.rental_from, f.rental_to); if (we) { flash(rentalErrorAr(we)); return null; }
    if (renterType === "registered" && !chosen) { flash(t({ ar: "اختر عميلًا مسجلًا في البوابة.", en: "Pick a registered client." })); return null; }
    if (renterType === "external" && !f.full_name?.trim()) { flash(t({ ar: "أدخل اسم/منشأة المستأجر.", en: "Enter renter name." })); return null; }
    const r = await rentalUpsertRequest({
      id: reqId ?? undefined,
      customer_id: chosen?.customer_id || undefined,
      party_type: f.party_type, full_name: f.full_name, company_name: f.company_name, phone: f.phone, email: f.email,
      rental_from: riyadhInputToUtcISO(f.rental_from), rental_to: riyadhInputToUtcISO(f.rental_to),
      delivery_location: f.delivery_location, return_location: f.return_location,
      rate_type: f.rate_type, purpose: f.purpose, customer_note: f.customer_note, internal_note: f.internal_note,
    });
    if (!r.ok) { flash(rentalErrorAr(r.error)); return null; }
    if (!reqId) setReqId(r.data.id);
    return r.data.id;
  }
  async function checkAvail() {
    const we = validateWindow(f.rental_from, f.rental_to); if (we) { flash(rentalErrorAr(we)); return; }
    if (!pick) return;
    setAvailBusy(true);
    const r = await rentalAvailability(pick, riyadhInputToUtcISO(f.rental_from)!, riyadhInputToUtcISO(f.rental_to)!, Number(pickQty) || 1);
    setAvailBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); setAvail(null); return; }
    setAvail(r.data);
  }
  async function addItem() {
    if (!pick) return;
    if (!avail) { flash(t({ ar: "افحص التوفّر أولًا.", en: "Check availability first." })); return; }
    if (!avail.available) { flash(t({ ar: "لا يمكن إضافة أصل غير متاح.", en: "Cannot add an unavailable asset." })); return; }
    const id = await ensureDraft(); if (!id) return;
    setBusy(true); const r = await rentalAddItem(id, pick, Number(pickQty) || 1); setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    setPick(""); setPickQty("1"); setAvail(null);
    const li = await rentalListItems(id); if (li.ok) setItems(li.data);
  }
  async function submit() {
    if (busy) return;
    const id = await ensureDraft(); if (!id) return;
    if (items.length === 0) { flash(t({ ar: "أضف معدّة واحدة على الأقل.", en: "Add at least one item." })); return; }
    setBusy(true); const r = await rentalSubmit(id); setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    emitRentalEvent("rental_pending_approval", id);
    flash(t({ ar: "أُرسل الطلب للاعتماد.", en: "Sent for approval." })); onCreated(id);
  }
  const availList = assets.filter((a) => !["lost", "retired"].includes(a.availability_status));

  return (
    <div className={`${card} space-y-4`}>
      <h3 className="text-sm font-medium text-white">{t({ ar: "إنشاء طلب تأجير", en: "New rental request" })}</h3>

      {/* نوع المستأجر */}
      <div className="flex gap-2">
        {(["registered", "external"] as const).map((v) => (
          <button key={v} onClick={() => { setRenterType(v); clearClient(); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${renterType === v ? "bg-red-600 text-white" : "bg-stone-800 text-stone-300 border border-stone-700"}`}>
            {v === "registered" ? t({ ar: "اختيار عميل مسجل", en: "Registered client" }) : t({ ar: "إضافة مستأجر خارجي", en: "External renter" })}
          </button>
        ))}
      </div>

      {/* اختيار عميل البوابة */}
      {renterType === "registered" && (
        <div className={field}>
          <label className={lbl}>{t({ ar: "العميل المسجّل في البوابة", en: "Portal client" })}</label>
          {chosen ? (
            <div className="flex items-center justify-between bg-stone-950 border border-stone-800 rounded-lg p-2 text-xs text-stone-200">
              <span>{chosen.company || chosen.full_name} <span className="text-stone-500" dir="ltr">· {chosen.email ?? ""} {chosen.phone ?? ""}</span></span>
              <button onClick={clearClient} className="text-red-400 text-[11px]">{t({ ar: "تغيير", en: "Change" })}</button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input className={`${inp} flex-1`} placeholder={t({ ar: "بحث بالاسم/الشركة/البريد/الجوال", en: "Search name/company/email/phone" })} value={clientQ} onChange={(e) => setClientQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void searchClients(); }} />
                <button disabled={clientSearching} onClick={() => void searchClients()} className={`${btnGhost} px-3 py-2 text-xs`}>{clientSearching ? "…" : t({ ar: "بحث", en: "Search" })}</button>
              </div>
              {clientSearching && <div className="mt-1 text-[11px] text-stone-500">{t({ ar: "جارٍ البحث…", en: "Searching…" })}</div>}
              {!clientSearching && clientSearched && clientResults.length === 0 && <div className="mt-1 text-[11px] text-amber-400">{t({ ar: "لا توجد نتائج مطابقة.", en: "No matching clients." })}</div>}
              {clientResults.length > 0 && <div className="mt-1 max-h-44 overflow-y-auto space-y-1">
                {clientResults.map((c) => (
                  <button key={c.profile_id} onClick={() => void pickClient(c)} className="w-full text-right bg-stone-950 border border-stone-800 rounded-lg p-2 text-xs text-stone-200 hover:border-red-700">
                    <div>{c.company || c.full_name || c.email} <span className="text-[10px] px-1 rounded bg-stone-800">{c.account_type}</span>{c.rental_customer_id ? <span className="text-[9px] text-emerald-500/80 ms-1">مرتبط</span> : ""}</div>
                    <div className="text-[10px] text-stone-500" dir="ltr">{c.email ?? ""} {c.mobile ?? ""}</div>
                  </button>
                ))}
              </div>}
            </>
          )}
        </div>
      )}

      {/* مستأجر خارجي — نموذج يدوي */}
      {renterType === "external" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className={field}><label className={lbl}>{t({ ar: "نوع المستأجر", en: "Type" })}</label><select className={inp} value={f.party_type} onChange={(e) => set("party_type", e.target.value)}><option value="individual">فرد</option><option value="company">شركة</option></select></div>
          <div className={field}><label className={lbl}>{t({ ar: "الاسم/المنشأة *", en: "Name/Company *" })}</label><input className={inp} value={f.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} /></div>
          <div className={field}><label className={lbl}>{t({ ar: "الجوال", en: "Phone" })}</label><input className={inp} dir="ltr" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className={field}><label className={lbl}>{t({ ar: "البريد", en: "Email" })}</label><input className={inp} dir="ltr" value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} /></div>
        </div>
      )}

      {/* التواريخ والمواقع */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={field}><label className={lbl}>{t({ ar: "بداية التأجير (استلام)", en: "Rental start" })}</label><input type="datetime-local" className={inp} value={f.rental_from ?? ""} onChange={(e) => onFromChange(e.target.value)} /></div>
        <div className={field}><label className={lbl}>{t({ ar: "نهاية التأجير (إرجاع)", en: "Rental end" })}</label><input type="datetime-local" className={inp} value={f.rental_to ?? ""} min={f.rental_from} onChange={(e) => set("rental_to", e.target.value)} />{winErr && <span className="text-[11px] text-red-400">{winErr}</span>}</div>
        <div className={field}><label className={lbl}>{t({ ar: "موقع التسليم", en: "Delivery location" })}</label><input className={inp} value={f.delivery_location ?? ""} onChange={(e) => set("delivery_location", e.target.value)} /></div>
        <div className={field}><label className={lbl}>{t({ ar: "موقع الإرجاع", en: "Return location" })}</label><input className={inp} value={f.return_location ?? ""} onChange={(e) => set("return_location", e.target.value)} /></div>
        <div className={field}><label className={lbl}>{t({ ar: "الغرض", en: "Purpose" })}</label><input className={inp} value={f.purpose ?? ""} onChange={(e) => set("purpose", e.target.value)} /></div>
        <div className={field}><label className={lbl}>{t({ ar: "ملاحظة داخلية", en: "Internal note" })}</label><input className={inp} value={f.internal_note ?? ""} onChange={(e) => set("internal_note", e.target.value)} /></div>
      </div>
      <div className="text-[11px] text-stone-500">{t({ ar: "التوقيت بتوقيت الرياض. النهاية يجب أن تكون بعد البداية.", en: "Times are Asia/Riyadh. End must be after start." })}</div>

      {/* اختيار المعدّة + فحص التوفّر */}
      <div className="border-t border-stone-800 pt-3 space-y-2">
        <label className={lbl}>{t({ ar: "المعدّة والكمية", en: "Asset & quantity" })}</label>
        <div className="flex gap-2 flex-wrap items-center">
          <select className={`${inp} flex-1 min-w-[180px]`} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">{t({ ar: "اختر معدّة…", en: "Pick asset…" })}</option>{availList.map((a) => <option key={a.id} value={a.id}>{a.asset_name} ({a.asset_code})</option>)}</select>
          <input className={`${inp} w-20`} type="number" min={1} value={pickQty} onChange={(e) => setPickQty(e.target.value)} />
          <button disabled={!pick || availBusy || !!winErr} onClick={() => void checkAvail()} className={`${btnGhost} px-3 py-2 text-xs`}>{availBusy ? "…" : t({ ar: "فحص التوفّر", en: "Check availability" })}</button>
          <button disabled={busy || !pick || !avail?.available} onClick={() => void addItem()} className={`${btnRed} px-3 py-2 text-xs`}>{t({ ar: "+ إضافة", en: "+ Add" })}</button>
        </div>
        {avail && <div className={`text-[11px] ${avail.available ? "text-emerald-400" : "text-amber-400"}`}>{availAr(avail)}</div>}
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 bg-stone-950 border border-stone-800 rounded-lg p-2 text-xs text-stone-300">
            <span className="flex-1">{assets.find((a) => a.id === it.asset_id)?.asset_name ?? it.asset_id.slice(0, 8)} × {it.quantity}</span>
            <button onClick={async () => { const r = await rentalRemoveItem(it.id); if (r.ok && reqId) { const li = await rentalListItems(reqId); if (li.ok) setItems(li.data); } }} className="text-red-400">{t({ ar: "حذف", en: "Remove" })}</button>
          </div>
        ))}
      </div>

      <button disabled={busy || !!winErr} onClick={() => void submit()} className={`${btnRed} w-full py-2.5 flex items-center justify-center gap-2`}>
        {busy && <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
        {t({ ar: "إرسال للاعتماد", en: "Submit for approval" })}
      </button>
    </div>
  );
}

// ─── التقويم ───
function CalendarTab({ openDetail, t }: { openDetail: (id: string) => void; t: T }) {
  const [events, setEvents] = useState<Array<{ id: string; request_number: string; status: RentalStatus; from: string; to: string; customer: string | null }>>([]);
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const load = useCallback(async () => {
    // حدود الشهر بتوقيت الرياض الثابت (لا browser-local) — اتساقًا مع تخزين/عرض بقية النظام.
    const pad = (n: number) => String(n).padStart(2, "0");
    const ny = month.m === 11 ? month.y + 1 : month.y; const nm = month.m === 11 ? 0 : month.m + 1;
    const from = riyadhInputToUtcISO(`${month.y}-${pad(month.m + 1)}-01T00:00`)!;
    const to = riyadhInputToUtcISO(`${ny}-${pad(nm + 1)}-01T00:00`)!;
    const r = await rentalCalendar(from, to); if (r.ok) setEvents(r.data);
  }, [month]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={() => setMonth((p) => ({ y: p.m === 0 ? p.y - 1 : p.y, m: p.m === 0 ? 11 : p.m - 1 }))} className={`${btnGhost} px-3 py-1 text-xs`}>‹</button>
        <span className="text-sm text-stone-200">{new Date(month.y, month.m, 1).toLocaleDateString("ar", { month: "long", year: "numeric" })}</span>
        <button onClick={() => setMonth((p) => ({ y: p.m === 11 ? p.y + 1 : p.y, m: p.m === 11 ? 0 : p.m + 1 }))} className={`${btnGhost} px-3 py-1 text-xs`}>›</button>
      </div>
      {events.length === 0 ? <p className="text-xs text-stone-500">{t({ ar: "لا تأجيرات هذا الشهر.", en: "No rentals this month." })}</p>
        : <div className="space-y-2">{events.map((e) => (
          <button key={e.id} onClick={() => openDetail(e.id)} className={`${card} w-full text-right flex items-center justify-between hover:border-red-700`}>
            <div><div className="text-sm text-stone-200 font-mono" dir="ltr">{e.request_number}</div><div className="text-[11px] text-stone-500">{e.customer ?? "—"} · {rentalStatusAr(e.status)}</div></div>
            <div className="text-[11px] text-stone-400" dir="ltr">{formatRiyadh(e.from, false)} → {formatRiyadh(e.to, false)}</div>
          </button>
        ))}</div>}
    </div>
  );
}

// ─── التقارير ───
function ReportsTab({ t }: { t: T }) {
  const [rows, setRows] = useState<RentalRequest[]>([]);
  useEffect(() => { void rentalListRequests().then((r) => { if (r.ok) setRows(r.data); }); }, []);
  const active = rows.filter((r) => r.status === "active").length;
  const overdue = rows.filter((r) => r.status === "overdue").length;
  const heldDeposits = rows.filter((r) => ["held", "partially_applied"].includes(r.deposit_status)).reduce((s, r) => s + (r.deposit_received || 0), 0);
  const expectedRevenue = rows.filter((r) => !["cancelled", "rejected"].includes(r.status)).reduce((s, r) => s + (r.grand_total || 0), 0);
  const cards: [string, string | number][] = [
    ["تأجيرات نشطة", active], ["متأخرة", overdue], ["الإيراد المتوقع", `${Math.round(expectedRevenue).toLocaleString("ar")} ر.س`], ["تأمينات محتجزة", `${Math.round(heldDeposits).toLocaleString("ar")} ر.س`],
  ];
  function exportCsv() {
    const keys = ["request_number", "status", "rental_from", "rental_to", "grand_total", "currency", "deposit_status"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => esc((r as unknown as Record<string, unknown>)[k])).join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "rentals.csv"; a.click(); URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{cards.map(([l, v]) => <div key={l} className={card}><div className="text-xl font-semibold text-white">{v}</div><div className="text-[11px] text-stone-400 mt-1">{l}</div></div>)}</div>
      <button onClick={exportCsv} className={`${btnGhost} px-3 py-1.5 text-xs`}>{t({ ar: "تصدير CSV", en: "Export CSV" })}</button>
    </div>
  );
}
