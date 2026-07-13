"use client";
// ════════════════════════════════════════════════════════════════════════════
// بوابة تأجير المعدات والتأمين — لوحة الإدارة. تبويبات: نظرة عامة/الطلبات/إنشاء/
// التقويم/التقارير. كل الكتابة عبر RPCs محمية بالقاعدة (state machine + RLS).
// الإجراءات التشغيلية (اعتماد/عقد/توقيع/تسليم/إرجاع/فحص/رسوم/إغلاق) في RentalDetail.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { civListAssets, type CivAsset } from "@/lib/portal/custodyInventory";
import {
  rentalDashboard, rentalListRequests, rentalListCustomers, rentalUpsertRequest, rentalAddItem,
  rentalRemoveItem, rentalAvailability, rentalTransition, rentalListItems, rentalCalendar,
  type RentalDashboard, type RentalRequest, type RentalCustomer, type RentalItem, type RentalStatus,
} from "@/lib/portal/rental";
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
            <td className={td} dir="ltr">{r.rental_from ? new Date(r.rental_from).toLocaleDateString("ar") : "—"}</td>
            <td className={td} dir="ltr">{r.rental_to ? new Date(r.rental_to).toLocaleDateString("ar") : "—"}</td>
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
function CreateTab({ flash, onCreated, t }: { flash: (m: string) => void; onCreated: (id: string) => void; t: T }) {
  const [customers, setCustomers] = useState<RentalCustomer[]>([]);
  const [assets, setAssets] = useState<CivAsset[]>([]);
  const [f, setF] = useState<Record<string, string>>({ party_type: "individual", customer_id: "" });
  const [items, setItems] = useState<RentalItem[]>([]);
  const [reqId, setReqId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(""); const [pickQty, setPickQty] = useState("1"); const [avail, setAvail] = useState<string>("");
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => { void rentalListCustomers().then((r) => { if (r.ok) setCustomers(r.data); }); void civListAssets().then((r) => { if (r.ok) setAssets(r.data); }); }, []);

  async function ensureDraft(): Promise<string | null> {
    if (reqId) return reqId;
    if (!f.customer_id && !f.full_name?.trim()) { flash(t({ ar: "اختر مستأجرًا أو أدخل اسمًا.", en: "Pick or enter a customer." })); return null; }
    if (!f.rental_from || !f.rental_to) { flash(t({ ar: "حدّد تاريخي البداية والنهاية.", en: "Set start and end dates." })); return null; }
    const r = await rentalUpsertRequest({ customer_id: f.customer_id || undefined, party_type: f.party_type, full_name: f.full_name, company_name: f.company_name, phone: f.phone, email: f.email, rental_from: new Date(f.rental_from).toISOString(), rental_to: new Date(f.rental_to).toISOString(), rate_type: f.rate_type, purpose: f.purpose, customer_note: f.customer_note, internal_note: f.internal_note });
    if (!r.ok) { flash(t({ ar: "تعذّر: ", en: "Failed: " }) + r.error); return null; }
    setReqId(r.data.id); return r.data.id;
  }
  async function checkAvail() {
    if (!pick || !f.rental_from || !f.rental_to) return;
    const r = await rentalAvailability(pick, new Date(f.rental_from).toISOString(), new Date(f.rental_to).toISOString(), Number(pickQty) || 1);
    setAvail(r.ok ? (r.data.available ? t({ ar: `متاح (${r.data.free})`, en: `available (${r.data.free})` }) : t({ ar: `غير متاح — متبقٍّ ${r.data.free}`, en: `unavailable (${r.data.free})` })) : "—");
  }
  async function addItem() {
    const id = await ensureDraft(); if (!id || !pick) return;
    setBusy(true); const r = await rentalAddItem(id, pick, Number(pickQty) || 1); setBusy(false);
    if (!r.ok) { flash(/not_available/.test(r.error) ? t({ ar: "الأصل غير متاح لهذه الفترة.", en: "Asset not available." }) : t({ ar: "تعذّر: ", en: "Failed: " }) + r.error); return; }
    setPick(""); setPickQty("1"); setAvail("");
    const li = await rentalListItems(id); if (li.ok) setItems(li.data);
  }
  async function submit() {
    const id = await ensureDraft(); if (!id) return;
    if (items.length === 0) { flash(t({ ar: "أضف معدّة واحدة على الأقل.", en: "Add at least one item." })); return; }
    setBusy(true); const r = await rentalTransition(id, "pending_approval" as RentalStatus, "submitted"); setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر الإرسال: ", en: "Submit failed: " }) + r.error); return; }
    flash(t({ ar: "أُرسل الطلب للاعتماد.", en: "Sent for approval." })); onCreated(id);
  }
  const availList = assets.filter((a) => !["lost", "retired"].includes(a.availability_status) && !a.is_deleted);
  return (
    <div className={`${card} space-y-3`}>
      <h3 className="text-sm font-medium text-white">{t({ ar: "إنشاء طلب تأجير", en: "New rental request" })}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select className={inp} value={f.customer_id} onChange={(e) => set("customer_id", e.target.value)}><option value="">{t({ ar: "مستأجر جديد…", en: "New customer…" })}</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}</select>
        {!f.customer_id && <>
          <select className={inp} value={f.party_type} onChange={(e) => set("party_type", e.target.value)}><option value="individual">فرد</option><option value="company">شركة</option></select>
          <input className={inp} placeholder="الاسم/المنشأة *" value={f.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} />
          <input className={inp} placeholder="الجوال" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          <input className={inp} placeholder="البريد" value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </>}
        <input type="datetime-local" className={inp} title="البداية" value={f.rental_from ?? ""} onChange={(e) => set("rental_from", e.target.value)} />
        <input type="datetime-local" className={inp} title="النهاية" value={f.rental_to ?? ""} onChange={(e) => set("rental_to", e.target.value)} />
        <input className={inp} placeholder="الغرض" value={f.purpose ?? ""} onChange={(e) => set("purpose", e.target.value)} />
        <input className={inp} placeholder="ملاحظة داخلية" value={f.internal_note ?? ""} onChange={(e) => set("internal_note", e.target.value)} />
      </div>
      <div className="border-t border-stone-800 pt-3 space-y-2">
        <div className="flex gap-2 flex-wrap items-center">
          <select className={`${inp} flex-1 min-w-[180px]`} value={pick} onChange={(e) => { setPick(e.target.value); setAvail(""); }}><option value="">{t({ ar: "اختر معدّة…", en: "Pick asset…" })}</option>{availList.map((a) => <option key={a.id} value={a.id}>{a.asset_name} ({a.asset_code})</option>)}</select>
          <input className={`${inp} w-20`} type="number" min={1} value={pickQty} onChange={(e) => setPickQty(e.target.value)} />
          <button disabled={!pick} onClick={() => void checkAvail()} className={`${btnGhost} px-3 py-2 text-xs`}>{t({ ar: "فحص التوفّر", en: "Check" })}</button>
          {avail && <span className="text-[11px] text-stone-400">{avail}</span>}
          <button disabled={busy || !pick} onClick={() => void addItem()} className={`${btnRed} px-3 py-2 text-xs`}>{t({ ar: "+ إضافة", en: "+ Add" })}</button>
        </div>
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 bg-stone-950 border border-stone-800 rounded-lg p-2 text-xs text-stone-300">
            <span className="flex-1">{assets.find((a) => a.id === it.asset_id)?.asset_name ?? it.asset_id.slice(0, 8)} × {it.quantity}</span>
            <button onClick={async () => { const r = await rentalRemoveItem(it.id); if (r.ok && reqId) { const li = await rentalListItems(reqId); if (li.ok) setItems(li.data); } }} className="text-red-400">حذف</button>
          </div>
        ))}
      </div>
      <button disabled={busy} onClick={() => void submit()} className={`${btnRed} w-full py-2.5`}>{t({ ar: "إرسال للاعتماد", en: "Submit for approval" })}</button>
    </div>
  );
}

// ─── التقويم ───
function CalendarTab({ openDetail, t }: { openDetail: (id: string) => void; t: T }) {
  const [events, setEvents] = useState<Array<{ id: string; request_number: string; status: RentalStatus; from: string; to: string; customer: string | null }>>([]);
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const load = useCallback(async () => {
    const from = new Date(month.y, month.m, 1).toISOString();
    const to = new Date(month.y, month.m + 1, 1).toISOString();
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
            <div className="text-[11px] text-stone-400" dir="ltr">{new Date(e.from).toLocaleDateString("ar")} → {new Date(e.to).toLocaleDateString("ar")}</div>
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
