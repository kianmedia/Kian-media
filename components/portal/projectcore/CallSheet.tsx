"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — Call Sheet لجلسة التصوير: إصدارات، حفظ مسودّة، إنشاء نسخة، معاينة،
// طباعة/PDF (عبر طباعة المتصفّح من قالب React موثوق)، إرسال (منع Double Send + حرّاس).
// منصّة داخلية للفريق — لا يراها العميل (RLS). لا نظام معدات جديد.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  pcListCallSheets, pcCallSheetSave, pcCallSheetSend, pcErr,
  type CallSheet, type ShootSession,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-2.5 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const lines = (arr: unknown[]) => (arr ?? []).map((x) => typeof x === "string" ? x : JSON.stringify(x)).join("\n");
const toArr = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const fmt = (s: string | null) => s ? new Date(s).toLocaleString("ar") : "—";

export function CallSheetManager({ shoot, canManage, flash }: { shoot: ShootSession; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<CallSheet[]>([]);
  const [edit, setEdit] = useState<CallSheet | "new" | null>(null);
  const [preview, setPreview] = useState<CallSheet | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { const r = await pcListCallSheets(shoot.id); if (r.ok) setRows(r.data); }, [shoot.id]);
  useEffect(() => { void load(); }, [load]);

  async function send(cs: CallSheet) {
    if (busy) return; if (!window.confirm(t({ ar: "إصدار وإرسال Call Sheet؟", en: "Issue & send this Call Sheet?" }))) return;
    setBusy(true); const r = await pcCallSheetSend(cs.id); setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; } flash(t({ ar: "صدرت وأُرسلت.", en: "Issued & sent." })); await load();
  }

  return (
    <div className="mt-2 pt-2 border-t border-stone-800 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-stone-500">{t({ ar: "Call Sheets", en: "Call Sheets" })}</span>
        {canManage && <button onClick={() => setEdit("new")} className={`${btnGhost} px-2 py-1`}>+ {t({ ar: "جديدة", en: "New" })}</button>}
      </div>
      {rows.length === 0 && <p className="text-stone-600">{t({ ar: "لا Call Sheets.", en: "None." })}</p>}
      {rows.map((cs) => (
        <div key={cs.id} className="bg-stone-950 border border-stone-800 rounded p-2 flex items-center justify-between gap-2">
          <div className="min-w-0"><span className="text-stone-200">v{cs.version_number}</span>{cs.title && <span className="mr-2 text-stone-500 truncate">· {cs.title}</span>}
            <span className={`mr-2 px-1.5 rounded text-[10px] ${cs.status === "sent" ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"}`}>{cs.status === "sent" ? t({ ar: "مُرسَلة", en: "Sent" }) : t({ ar: "مسودّة", en: "Draft" })}</span></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setPreview(cs)} className="text-sky-400">{t({ ar: "معاينة", en: "Preview" })}</button>
            {canManage && cs.status === "draft" && <button onClick={() => setEdit(cs)} className="text-stone-400">{t({ ar: "تعديل", en: "Edit" })}</button>}
            {canManage && cs.status === "draft" && <button disabled={busy} onClick={() => void send(cs)} className={`${btnRed} px-2 py-0.5`}>{t({ ar: "إرسال", en: "Send" })}</button>}
          </div>
        </div>
      ))}
      {edit && <CallSheetForm shoot={shoot} existing={edit === "new" ? null : edit} seed={edit === "new" ? (rows[0] ?? null) : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} flash={flash} />}
      {preview && <CallSheetPreview cs={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

type Tr = (m: { ar: string; en: string }) => string;
// حقول بمستوى الوحدة (هوية ثابتة) — لتفادي إعادة التركيب وفقدان التركيز أثناء الكتابة.
function FldCS({ t, f, set, k, ar, en, type = "text" }: { t: Tr; f: Record<string, string>; set: (k: string, v: string) => void; k: string; ar: string; en: string; type?: string }) {
  return <label className="block"><span className="text-[10px] text-stone-500">{t({ ar, en })}</span><input type={type} value={f[k]} onChange={(e) => set(k, e.target.value)} className={`${inp} w-full mt-0.5`} style={type.includes("date") || type.includes("time") ? { colorScheme: "dark" } : {}} /></label>;
}
function AreaCS({ t, f, set, k, ar, en }: { t: Tr; f: Record<string, string>; set: (k: string, v: string) => void; k: string; ar: string; en: string }) {
  return <label className="block"><span className="text-[10px] text-stone-500">{t({ ar, en })} <span className="text-stone-600">({t({ ar: "سطر لكل عنصر", en: "one per line" })})</span></span><textarea value={f[k]} onChange={(e) => set(k, e.target.value)} className={`${inp} w-full mt-0.5 min-h-[52px]`} /></label>;
}

function CallSheetForm({ shoot, existing, seed, onClose, onSaved, flash }: { shoot: ShootSession; existing: CallSheet | null; seed?: CallSheet | null; onClose: () => void; onSaved: () => void; flash: (m: string) => void }) {
  const { t } = useI18n();
  const src = existing ?? seed ?? null;   // تعديل: من النسخة نفسها؛ نسخة جديدة: من أحدث نسخة (لا تُفقَد الحقول)؛ وإلا من الجلسة
  const [f, setF] = useState({
    title: src?.title ?? shoot.title ?? "", shoot_date: src?.shoot_date ?? shoot.session_date ?? "",
    call_time: (src?.call_time ?? shoot.call_time ?? "").slice(0, 16), wrap_time: (src?.wrap_time ?? "").slice(0, 16),
    location_name: src?.location_name ?? shoot.location ?? "", address: src?.address ?? "", map_url: src?.map_url ?? "",
    client_contact: src?.client_contact ?? shoot.client_contact ?? "", client_mobile: src?.client_mobile ?? "",
    permits: src?.permits ?? shoot.permits ?? "", safety_notes: src?.safety_notes ?? shoot.safety_notes ?? "",
    weather_notes: src?.weather_notes ?? shoot.weather_note ?? "", general_notes: src?.general_notes ?? "",
    crew: lines(src?.crew ?? shoot.crew ?? []), equipment: lines(src?.equipment ?? shoot.equipment ?? []),
    vehicles: lines(src?.vehicles ?? shoot.vehicles ?? []), schedule: lines(src?.schedule ?? []),
    shot_list: lines(src?.shot_list ?? shoot.shot_list ?? []), contacts: lines(src?.contacts ?? []),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function save() {
    if (busy || !f.title.trim()) return; setBusy(true);
    const r = await pcCallSheetSave(shoot.id, {
      ...(existing ? { id: existing.id } : {}),
      title: f.title.trim(), shoot_date: f.shoot_date || undefined, call_time: f.call_time || undefined, wrap_time: f.wrap_time || undefined,
      location_name: f.location_name.trim() || undefined, address: f.address.trim() || undefined, map_url: f.map_url.trim() || undefined,
      client_contact: f.client_contact.trim() || undefined, client_mobile: f.client_mobile.trim() || undefined,
      permits: f.permits.trim() || undefined, safety_notes: f.safety_notes.trim() || undefined, weather_notes: f.weather_notes.trim() || undefined,
      general_notes: f.general_notes.trim() || undefined, crew: toArr(f.crew), equipment: toArr(f.equipment), vehicles: toArr(f.vehicles),
      schedule: toArr(f.schedule), shot_list: toArr(f.shot_list), contacts: toArr(f.contacts),
    });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; } onSaved();
  }
  const ff = f as Record<string, string>; const ss = set as (k: string, v: string) => void;
  return (
    <div className="fixed inset-0 z-[75] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (!busy && e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg my-4 bg-stone-950 border border-stone-800 rounded-2xl" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800 sticky top-0 bg-stone-950 rounded-t-2xl"><h3 className="text-sm font-semibold text-white">{existing ? t({ ar: `تعديل Call Sheet v${existing.version_number}`, en: `Edit v${existing.version_number}` }) : t({ ar: "Call Sheet جديدة", en: "New Call Sheet" })}</h3><button onClick={onClose} className="text-stone-400 text-sm">✕</button></div>
        <div className="p-4 space-y-2">
          <FldCS t={t} f={ff} set={ss} k="title" ar="العنوان *" en="Title *" />
          <div className="grid grid-cols-2 gap-2"><FldCS t={t} f={ff} set={ss} k="shoot_date" ar="تاريخ التصوير" en="Shoot date" type="date" /><FldCS t={t} f={ff} set={ss} k="call_time" ar="Call Time" en="Call Time" type="datetime-local" /><FldCS t={t} f={ff} set={ss} k="wrap_time" ar="Wrap Time" en="Wrap Time" type="datetime-local" /><FldCS t={t} f={ff} set={ss} k="location_name" ar="الموقع" en="Location" /></div>
          <FldCS t={t} f={ff} set={ss} k="address" ar="العنوان التفصيلي" en="Address" /><FldCS t={t} f={ff} set={ss} k="map_url" ar="رابط الخريطة" en="Map URL" />
          <div className="grid grid-cols-2 gap-2"><FldCS t={t} f={ff} set={ss} k="client_contact" ar="مسؤول العميل" en="Client contact" /><FldCS t={t} f={ff} set={ss} k="client_mobile" ar="جوال العميل" en="Client mobile" /></div>
          <AreaCS t={t} f={ff} set={ss} k="crew" ar="الفريق" en="Crew" /><AreaCS t={t} f={ff} set={ss} k="equipment" ar="المعدات" en="Equipment" /><AreaCS t={t} f={ff} set={ss} k="vehicles" ar="المركبات" en="Vehicles" />
          <AreaCS t={t} f={ff} set={ss} k="schedule" ar="الجدول" en="Schedule" /><AreaCS t={t} f={ff} set={ss} k="shot_list" ar="Shot List" en="Shot List" /><AreaCS t={t} f={ff} set={ss} k="contacts" ar="جهات الاتصال" en="Contacts" />
          <FldCS t={t} f={ff} set={ss} k="permits" ar="التصاريح" en="Permits" /><FldCS t={t} f={ff} set={ss} k="safety_notes" ar="ملاحظات السلامة" en="Safety" /><FldCS t={t} f={ff} set={ss} k="weather_notes" ar="الطقس" en="Weather" /><FldCS t={t} f={ff} set={ss} k="general_notes" ar="ملاحظات عامة" en="Notes" />
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-stone-800 sticky bottom-0 bg-stone-950 rounded-b-2xl"><button disabled={busy || !f.title.trim()} onClick={() => void save()} className={`${btnRed} flex-1 py-2.5`}>{busy ? "…" : existing ? t({ ar: "حفظ المسودّة", en: "Save draft" }) : t({ ar: "إنشاء نسخة", en: "Create version" })}</button><button disabled={busy} onClick={onClose} className={`${btnGhost} px-4`}>{t({ ar: "إلغاء", en: "Cancel" })}</button></div>
      </div>
    </div>
  );
}

function CallSheetPreview({ cs, onClose }: { cs: CallSheet; onClose: () => void }) {
  const { t } = useI18n();
  const arr = (a: unknown[]) => (a ?? []).map((x) => typeof x === "string" ? x : JSON.stringify(x));
  const Sec = ({ title, items }: { title: string; items: string[] }) => items.length === 0 ? null : (
    <div className="cs-sec"><h4>{title}</h4><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
  );
  return (
    <div className="fixed inset-0 z-[75] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{`@media print { body * { visibility: hidden !important; } .cs-print, .cs-print * { visibility: visible !important; } .cs-print { position: absolute; top: 0; left: 0; right: 0; width: 100%; margin: 0; padding: 24px; background: #fff; color: #111; } .cs-noprint { display: none !important; } }
        .cs-print { font-family: var(--arabic-display, sans-serif); }
        .cs-print h2 { font-size: 20px; font-weight: 800; border-bottom: 2px solid #E31E24; padding-bottom: 6px; margin-bottom: 12px; }
        .cs-print .cs-sec { margin-bottom: 12px; } .cs-print .cs-sec h4 { font-size: 13px; font-weight: 700; color: #E31E24; margin-bottom: 4px; }
        .cs-print .cs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; font-size: 13px; } .cs-print .cs-grid div { border-bottom: 1px solid #eee; padding: 3px 0; }
        .cs-print ul { list-style: disc; padding-inline-start: 20px; font-size: 13px; } .cs-print li { padding: 1px 0; }`}</style>
      <div className="w-full max-w-2xl my-4 bg-white text-stone-900 rounded-2xl overflow-hidden" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cs-noprint flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-stone-100">
          <span className="text-sm font-semibold text-stone-700">{t({ ar: `معاينة Call Sheet v${cs.version_number}`, en: `Preview v${cs.version_number}` })}</span>
          <div className="flex gap-2"><button onClick={() => window.print()} className="rounded-lg bg-red-600 text-white text-sm px-4 py-1.5">{t({ ar: "طباعة / حفظ PDF", en: "Print / Save PDF" })}</button><button onClick={onClose} className="text-stone-500 text-sm px-2">✕</button></div>
        </div>
        <div className="cs-print p-6">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontWeight: 800, color: "#E31E24", fontSize: 16 }}>كيان ميديا · Kian Media</span>
            <span style={{ fontSize: 12, color: "#666" }}>Call Sheet · v{cs.version_number}{cs.status === "sent" ? " · صادرة" : ""}</span>
          </div>
          <h2>{cs.title || t({ ar: "جلسة تصوير", en: "Shoot" })}</h2>
          <div className="cs-grid">
            <div><b>{t({ ar: "التاريخ", en: "Date" })}:</b> {cs.shoot_date || "—"}</div>
            <div><b>Call Time:</b> {fmt(cs.call_time)}</div>
            <div><b>Wrap:</b> {fmt(cs.wrap_time)}</div>
            <div><b>{t({ ar: "الموقع", en: "Location" })}:</b> {cs.location_name || "—"}</div>
            <div style={{ gridColumn: "1 / -1" }}><b>{t({ ar: "العنوان", en: "Address" })}:</b> {cs.address || "—"} {cs.map_url ? `(${cs.map_url})` : ""}</div>
            <div><b>{t({ ar: "مسؤول العميل", en: "Client" })}:</b> {cs.client_contact || "—"}</div>
            <div><b>{t({ ar: "الجوال", en: "Mobile" })}:</b> {cs.client_mobile || "—"}</div>
          </div>
          <div style={{ height: 8 }} />
          <Sec title={t({ ar: "الجدول", en: "Schedule" })} items={arr(cs.schedule)} />
          <Sec title={t({ ar: "الفريق", en: "Crew" })} items={arr(cs.crew)} />
          <Sec title={t({ ar: "المعدات", en: "Equipment" })} items={arr(cs.equipment)} />
          <Sec title={t({ ar: "المركبات", en: "Vehicles" })} items={arr(cs.vehicles)} />
          <Sec title={t({ ar: "Shot List", en: "Shot List" })} items={arr(cs.shot_list)} />
          <Sec title={t({ ar: "جهات الاتصال", en: "Contacts" })} items={arr(cs.contacts)} />
          {(cs.permits || cs.safety_notes || cs.weather_notes || cs.general_notes) && (
            <div className="cs-sec"><h4>{t({ ar: "ملاحظات", en: "Notes" })}</h4>
              <ul>{cs.permits && <li><b>{t({ ar: "تصاريح", en: "Permits" })}:</b> {cs.permits}</li>}{cs.safety_notes && <li><b>{t({ ar: "سلامة", en: "Safety" })}:</b> {cs.safety_notes}</li>}{cs.weather_notes && <li><b>{t({ ar: "طقس", en: "Weather" })}:</b> {cs.weather_notes}</li>}{cs.general_notes && <li>{cs.general_notes}</li>}</ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
