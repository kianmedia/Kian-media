"use client";
// ════════════════════════════════════════════════════════════════════════════
// AssetReservations.tsx — تبويب الحجوزات.
//
// التدقيق وصف هذا بالضبط: الـRPC والنوع موجودان **بلا شاشة**. ميزة بلا شاشة
// ليست ميزة. هذه الشاشة تعرض التقويم، وتنشئ حجزًا عبر v2، وتُتمّه أو تُنهي مهله.
//
// ثلاثة التزامات في العرض:
//   ١) **التعارض ليس ترحيلة ناقصة**: 23P01 يظهر رسالةَ ازدحام تشرح مَن يشغل
//      الفترة، لا «شغّل الترحيلة».
//   ٢) **صدق التغطية**: ما لا يراه المحرّك (حجوزات طبقة التخطيط) مكتوب على
//      الشاشة، لا مخفيّ خلف ادّعاء شمول.
//   ٣) **لا مال هنا إطلاقًا**: هذا سطح تشغيليّ.
// عربية · RTL · يعمل على الهاتف في الموقع.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  reservationCalendar, createReservationV2, fulfilReservation, expireReservations,
  unwrap, assetFailureAr,
  type AssetReservation, type ConflictCoverage, type AssetFailure,
} from "@/lib/portal/assetIntelligence";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const th = "text-right text-[11px] text-stone-500 font-medium px-2 py-1.5";
const td = "text-right text-xs text-stone-300 px-2 py-1.5 border-t border-stone-800";

const STATUS_AR: Record<string, string> = {
  active: "نشط", fulfilled: "مُنفَّذ", cancelled: "ملغى", expired: "منقضٍ",
};

function fmt(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
}

export default function AssetReservations({ assets }: { assets: { id: string; asset_code: string; asset_name: string }[] }) {
  const [rows, setRows] = useState<AssetReservation[]>([]);
  const [coverage, setCoverage] = useState<ConflictCoverage | null>(null);
  const [coverageNote, setCoverageNote] = useState<string>("");
  const [pending, setPending] = useState(false);       // الميزة بانتظار تفعيل القاعدة
  const [failure, setFailure] = useState<AssetFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 4200); };

  const [form, setForm] = useState({ asset_id: "", quantity: "1", from: "", to: "", hold: "", note: "" });

  const load = useCallback(async () => {
    const r = unwrap(await reservationCalendar());
    setLoaded(true);
    setPending(r.pending);
    setFailure(r.pending ? null : r.failure);
    if (r.data) {
      setRows(r.data.rows ?? []);
      setCoverage(r.data.coverage ?? null);
      setCoverageNote(r.data.note_ar ?? "");
    } else {
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!form.asset_id) { flash("اختر الأصل أوّلًا."); return; }
    setBusy(true);
    const r = unwrap(await createReservationV2({
      asset_id: form.asset_id,
      quantity: Number(form.quantity) || 1,
      reserved_from: form.from ? new Date(form.from).toISOString() : null,
      reserved_to: form.to ? new Date(form.to).toISOString() : null,
      hold_expires_at: form.hold ? new Date(form.hold).toISOString() : null,
      note: form.note.trim() || null,
    }));
    setBusy(false);
    if (r.data) {
      flash(`تمّ الحجز — ${r.data.asset_code ?? ""}`);
      setForm({ asset_id: "", quantity: "1", from: "", to: "", hold: "", note: "" });
      void load();
      return;
    }
    // ★ التعارض والحالة والصلاحية والترحيلة: أربع رسائل مختلفة، لا رسالة واحدة.
    if (r.failure) flash(assetFailureAr(r.failure));
  }

  async function fulfil(id: string) {
    const assignment = window.prompt("معرّف العهدة التي نفّذت هذا الحجز (اتركه فارغًا إن لم يوجد):", "");
    if (assignment === null) return;
    setBusy(true);
    const r = unwrap(await fulfilReservation(id, assignment.trim() || null));
    setBusy(false);
    flash(r.data ? "سُجِّل تنفيذ الحجز." : r.failure ? assetFailureAr(r.failure) : "تعذّر التسجيل.");
    if (r.data) void load();
  }

  async function expire() {
    setBusy(true);
    const r = unwrap(await expireReservations());
    setBusy(false);
    // التحويل لا يحذف: الصفوف تبقى بحالة «منقضٍ» فيبقى الأثر.
    flash(r.data !== null ? `انقضى ${r.data} حجزًا — حُوّلت ولم تُحذف.` : r.failure ? assetFailureAr(r.failure) : "تعذّر التنفيذ.");
    if (r.data !== null) void load();
  }

  // ─── حالة «بانتظار تفعيل القاعدة» — لا انهيار ولا بيانات وهمية ───────────
  if (loaded && pending) {
    return (
      <div className={card}>
        <p className="text-sm text-amber-300">الميزة بانتظار تفعيل قاعدة البيانات.</p>
        <p className="text-xs text-stone-500 mt-1.5">
          شغّل <code className="text-stone-400">docs/asset_intelligence_PREFLIGHT.sql</code> ثمّ
          {" "}<code className="text-stone-400">RUNME.sql</code>. لا تُعرض هنا أرقام تقديرية إلى حين ذلك.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" dir="rtl">
      {toast && <div className="rounded-lg bg-stone-800 border border-stone-700 px-3 py-2 text-xs text-stone-200">{toast}</div>}

      {/* ★ صدق التغطية: ما يراه المحرّك وما لا يراه — معروض لا مخفيّ */}
      {coverage && (
        <div className={`${card} border-stone-700`}>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Badge on={coverage.reservations} label="الحجوزات" />
            <Badge on={coverage.live_custody} label="العهد الحيّة" />
            <Badge on={coverage.production_jobs} label="أوامر التشغيل" />
            <Badge on={coverage.planning_bookings} label="حجوزات التخطيط" />
          </div>
          {coverageNote && <p className="text-[11px] text-stone-500 mt-2 leading-relaxed">{coverageNote}</p>}
        </div>
      )}

      {/* إنشاء حجز */}
      <div className={card}>
        <h3 className="text-sm font-medium text-white mb-3">حجز جديد</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select className={inp} value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })}>
            <option value="">— اختر الأصل —</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</option>)}
          </select>
          <input className={inp} type="number" min={1} value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="الكمّية" />
          <label className="text-[11px] text-stone-500">من
            <input className={inp} type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </label>
          <label className="text-[11px] text-stone-500">إلى
            <input className={inp} type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </label>
          <label className="text-[11px] text-stone-500">مهلة الحجز المؤقّت (اختياريّة)
            <input className={inp} type="datetime-local" value={form.hold} onChange={(e) => setForm({ ...form, hold: e.target.value })} />
          </label>
          <input className={inp} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="ملاحظة" />
        </div>
        <div className="flex gap-2 mt-3">
          <button disabled={busy} onClick={() => void create()} className={`${btnRed} px-4 py-2`}>حجز</button>
          <button disabled={busy} onClick={() => void expire()} className={`${btnGhost} px-4 py-2`}>إنهاء المهل المنقضية</button>
        </div>
        <p className="text-[11px] text-stone-600 mt-2 leading-relaxed">
          الحجز يُفحص على الخادم: أصل مخرَّد أو مفقود أو في الصيانة يُرفض بحالته،
          وفترة متقاطعة مع حجز أو عهدة حيّة تُرفض كتعارض. الرفضان مختلفان ورسالتاهما مختلفتان.
        </p>
      </div>

      {failure && failure.kind !== "pending_migration" && (
        <div className={`${card} border-red-900`}>
          <p className="text-xs text-red-300">{assetFailureAr(failure)}</p>
        </div>
      )}

      {/* التقويم */}
      <div className={card}>
        <h3 className="text-sm font-medium text-white mb-3">التقويم</h3>
        {rows.length === 0 ? (
          <p className="text-xs text-stone-500">لا حجوزات في النافذة المعروضة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead><tr>
                <th className={th}>الأصل</th><th className={th}>الكمّية</th><th className={th}>من</th>
                <th className={th}>إلى</th><th className={th}>المهلة</th><th className={th}>الحالة</th><th className={th}></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.is_overdue_hold ? "bg-amber-950/30" : undefined}>
                    <td className={td}>{r.asset_code ?? "—"} <span className="text-stone-500">{r.asset_name ?? ""}</span></td>
                    <td className={td}>{r.quantity}</td>
                    <td className={td}>{fmt(r.reserved_from)}</td>
                    <td className={td}>{fmt(r.reserved_to)}</td>
                    <td className={td}>
                      {fmt(r.hold_expires_at)}
                      {r.is_overdue_hold && <span className="text-amber-400 mr-1">مهلة منقضية</span>}
                    </td>
                    <td className={td}>{STATUS_AR[r.status] ?? r.status}</td>
                    <td className={td}>
                      {r.status === "active" && (
                        <button disabled={busy} onClick={() => void fulfil(r.id)} className={`${btnGhost} px-2.5 py-1 text-[11px]`}>
                          تسجيل التنفيذ
                        </button>
                      )}
                      {r.fulfilled_by_assignment_id && <span className="text-[11px] text-stone-500">مرتبط بعهدة</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`px-2 py-1 rounded-lg border ${on
      ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
      : "bg-stone-800 border-stone-700 text-stone-500"}`}>
      {on ? "يراه المحرّك" : "خارج التغطية"} · {label}
    </span>
  );
}
