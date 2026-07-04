"use client";
// ════════════════════════════════════════════════════════════════════════
// Equipment Custody & Rental — shared UI, ported 1:1 from the approved
// prototype (docs/custody/kian-custody-prototype.jsx): viewfinder corner
// brackets, per-item + overall photo capture, click-to-sign block, the
// one-page record card (party info, before/after evidence, signature line,
// admin note, audit timeline). Icons are tiny inline SVGs (repo rule: no new
// packages). Tailwind stone/red per prototype — `red` is remapped to Kian
// brand red in tailwind.config.ts.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  CUSTODY_STATUS_LABELS, listCustodyItems, listCustodyEvents, signEvidence,
  type CustodyRecord, type CustodyItem, type CustodyEvent, type RecordStatus,
} from "@/lib/portal/custody";

// ─── Inline icons (stroke = currentColor) ───
function I({ d, size = 15, className = "" }: { d: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
export const Ic = {
  camera: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z|M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  alert: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z|M12 9v4|M12 17h.01",
  check: "M22 11.08V12a10 10 0 1 1-5.93-9.14|M22 4 12 14.01l-3-3",
  sign: "M20 19.5v.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8.5L20 7.5V13|M8 13h4|M8 17h3|M17.5 15.5a2.1 2.1 0 0 1 3 3L17 22l-4 1 1-4 3.5-3.5z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M12 6v6l4 2",
  plus: "M12 5v14|M5 12h14",
  trash: "M3 6h18|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
  pkg: "M16.5 9.4 7.55 4.24|M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z|M3.27 6.96 12 12.01l8.73-5.05|M12 22.08V12",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  shield: "M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8z|M9 12l2 2 4-4",
  send: "m22 2-7 20-4-9-9-4 20-7z|M22 2 11 13",
  aperture: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|m14.31 8 5.74 9.94|M9.69 8h11.48|m7.38 12 5.74-9.94|M9.69 16 3.95 6.06|M14.31 16H2.83|m16.62 12-5.74 9.94",
};

// ─── Legal text (brief §9 — verbatim, bilingual) ───
export const CUSTODY_CLAUSES: { ar: string; en: string }[] = [
  { ar: "أستلم المعدات الموضحة بحالة سليمة وكاملة وفق الصور المرفقة لكل قطعة وإجمالي المعدات.",
    en: "I receive the listed equipment in sound and complete condition, as documented by the attached per-item and overall photos." },
  { ar: "أتحمل المسؤولية الكاملة عن العهدة من لحظة الاستلام حتى إعادتها واعتماد الإقفال من الإدارة.",
    en: "I bear full responsibility for the custody from the moment of receipt until its return and management's approval of closure." },
  { ar: "أي فقد أو تلف أو نقص يقع تحت مسؤوليتي، وألتزم بمعالجته وفق سياسة المؤسسة.",
    en: "Any loss, damage, or shortage falls under my responsibility, and I commit to remedying it per company policy." },
];
export const CUSTODY_AGREE = {
  ar: "أقر باستلام العهدة وأتعهد بالمسؤولية الكاملة عنها حتى إقفالها من الإدارة. (التأشير هنا بمثابة توقيع)",
  en: "I acknowledge receipt of the custody and undertake full responsibility for it until closed by management. (Checking here constitutes a signature.)",
};
export const RENT_CLAUSES: { ar: string; en: string }[] = [
  { ar: "يقر المستأجر باستلام المعدات الموضحة بحالة سليمة وكاملة وفق الصور المرفقة لكل قطعة وإجمالي المعدات.",
    en: "The Lessee acknowledges receipt of the listed equipment in sound and complete condition, as documented by the attached per-item and overall photos." },
  { ar: "يتحمل المستأجر المسؤولية القانونية والمالية الكاملة عن المعدات من لحظة الاستلام حتى إعادتها واعتماد الإقفال من إدارة كيان.",
    en: "The Lessee bears full legal and financial responsibility for the equipment from receipt until its return and Kian management's approval of closure." },
  { ar: "في حال أي فقد أو تلف أو سرقة أو نقص، يلتزم المستأجر بقيمة الإصلاح أو الاستبدال بالقيمة السوقية الكاملة دون اعتراض.",
    en: "In the event of any loss, damage, theft, or shortage, the Lessee shall pay the full cost of repair or replacement at full market value without objection." },
  { ar: "تبقى جميع المعدات ملكاً خالصاً لمؤسسة كيان، ولا يحق للمستأجر تأجيرها من الباطن أو نقل حيازتها للغير.",
    en: "All equipment remains the sole property of Kian; the Lessee may not sublease it or transfer possession to any third party." },
  { ar: "يلتزم المستأجر بإعادة المعدات في الموعد المتفق عليه، ويخضع أي تأخير لرسوم إضافية عن كل يوم.",
    en: "The Lessee shall return the equipment by the agreed date; any delay is subject to additional daily fees." },
  { ar: "يحق لكيان المطالبة بقيمة التأمين واتخاذ الإجراءات النظامية اللازمة عند الإخلال بأي بند من هذا العقد.",
    en: "Kian reserves the right to claim the security deposit and pursue all lawful measures upon breach of any clause herein." },
  { ar: "يُعد تأشير المستأجر بالموافقة الإلكترونية أدناه توقيعاً ملزماً وإقراراً بقراءة العقد كاملاً وفهم شروطه.",
    en: "The Lessee's electronic acceptance below constitutes a binding signature and acknowledgment of having fully read and understood this contract." },
];
export const RENT_AGREE = {
  ar: "أقر بأني قرأت عقد الإيجار كاملاً، وأوافق على جميع شروطه، وأتعهد بالمسؤولية القانونية والمالية الكاملة عن المعدات. (التأشير هنا بمثابة توقيع ملزم)",
  en: "I confirm I have read this rental contract in full, agree to all its terms, and undertake full legal and financial responsibility for the equipment. (Checking here constitutes a binding signature.)",
};

// ─── Status badge (prototype color map, literal Tailwind classes) ───
const STATUS_CLS: Record<RecordStatus, string> = {
  out:             "bg-amber-950 text-amber-300 border-amber-800",
  review_handover: "bg-sky-950 text-sky-300 border-sky-800",
  rented:          "bg-amber-950 text-amber-300 border-amber-800",
  review_return:   "bg-sky-950 text-sky-300 border-sky-800",
  closed:          "bg-emerald-950 text-emerald-300 border-emerald-800",
  rejected:        "bg-red-950 text-red-300 border-red-800",
  flagged:         "bg-red-950 text-red-300 border-red-800",
};
export function StatusBadge({ status }: { status: RecordStatus }) {
  const { t } = useI18n();
  const l = CUSTODY_STATUS_LABELS[status] ?? { ar: status, en: status };
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_CLS[status] || "bg-stone-800 text-stone-300 border-stone-700"}`}>
      {t(l)}
    </span>
  );
}

// ─── Section title / empty state ───
export function SectionTitle({ icon, children }: { icon: keyof typeof Ic; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-red-500"><I d={Ic[icon]} size={18} /></span>
      <h2 className="text-base font-medium text-stone-100">{children}</h2>
    </div>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-stone-800 rounded-xl py-8 px-4 text-center text-sm text-stone-500">
      {children}
    </div>
  );
}

// ─── Viewfinder corner brackets (prototype signature look) ───
export function Viewfinder({ active, children }: { active: boolean; children: React.ReactNode }) {
  const c = active ? "border-red-500" : "border-stone-600";
  return (
    <div className="relative">
      <span className={`pointer-events-none absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 ${c}`} />
      <span className={`pointer-events-none absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 ${c}`} />
      <span className={`pointer-events-none absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 ${c}`} />
      <span className={`pointer-events-none absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 ${c}`} />
      {children}
    </div>
  );
}

// ─── Photo capture (File-based; upload happens at submit) ───
function useFilePick(onPick: (f: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const open = () => ref.current?.click();
  const input = (
    <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
      className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
  );
  return { open, input };
}

/** 56×48 per-item shot button (dashed → solid red when filled). */
export function ItemShot({ preview, onPick }: { preview: string | null; onPick: (f: File) => void }) {
  const { open, input } = useFilePick(onPick);
  return (
    <>
      {input}
      <button type="button" onClick={open}
        className={`w-14 h-12 shrink-0 rounded-md overflow-hidden bg-stone-900 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-red-500 ${preview ? "border border-red-500" : "border border-dashed border-stone-600"}`}>
        {preview
          ? <img src={preview} alt="" className="w-full h-full object-cover" />
          : <span className="text-stone-500"><I d={Ic.camera} size={16} /></span>}
      </button>
    </>
  );
}

/** Full-width overall capture with viewfinder brackets. */
export function PhotoCapture({ label, preview, onPick }: { label: string; preview: string | null; onPick: (f: File) => void }) {
  const { t } = useI18n();
  const { open, input } = useFilePick(onPick);
  return (
    <div>
      <div className="text-[11px] font-mono text-stone-500 mb-1">{label}</div>
      {input}
      <Viewfinder active={!!preview}>
        <button type="button" onClick={open}
          className="w-full h-28 rounded-lg overflow-hidden bg-stone-800 flex flex-col items-center justify-center gap-1 text-stone-400 focus:outline-none focus:ring-2 focus:ring-red-500">
          {preview
            ? <img src={preview} alt="" className="w-full h-full object-cover" />
            : <><I d={Ic.camera} size={22} /><span className="text-xs">{t({ ar: "اضغط للتصوير", en: "Tap to capture" })}</span></>}
        </button>
      </Viewfinder>
    </div>
  );
}

/** Read-only per-item thumb (signed URL) with قبل/بعد label. */
export function Thumb({ url, label }: { url: string | null; label: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-mono text-stone-500 mb-0.5">{label}</div>
      <div className="w-14 h-12 rounded-md overflow-hidden bg-stone-900 border border-stone-700 flex items-center justify-center">
        {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <span className="text-stone-600 text-xs">—</span>}
      </div>
    </div>
  );
}

/** Read-only overall photo (signed URL) inside brackets. */
export function PhotoView({ url, label }: { url: string | null; label: string }) {
  const { t } = useI18n();
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="text-[11px] font-mono text-stone-500 mb-1">{label}</div>
      <Viewfinder active={false}>
        <div className="w-full h-20 rounded-lg overflow-hidden bg-stone-900 border border-stone-800 flex items-center justify-center">
          {url ? <img src={url} alt="" className="w-full h-full object-cover" />
               : <span className="text-xs text-stone-600">{t({ ar: "لا توجد صورة", en: "No photo" })}</span>}
        </div>
      </Viewfinder>
    </div>
  );
}

// ─── Click-to-sign block (bilingual clauses; checkbox = signature) ───
export function SignBlock({ title, clauses, agree, signerName, checked, onChange }: {
  title: string; clauses: { ar: string; en: string }[]; agree: { ar: string; en: string };
  signerName: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  const { t, isAr } = useI18n();
  return (
    <div className="bg-stone-800 border border-stone-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 text-stone-200 text-sm font-medium">
        <span className="text-red-400"><I d={Ic.sign} size={15} /></span>{title}
      </div>
      <div className="max-h-40 overflow-y-auto bg-stone-900 border border-stone-700 rounded-lg p-3 space-y-2">
        {clauses.map((c, i) => (
          <div key={i} className="text-xs text-stone-400 leading-relaxed">
            <span className="font-mono text-stone-600">{i + 1}.</span> {isAr ? c.ar : c.en}
            <div className="text-[10px] text-stone-600 mt-0.5" dir={isAr ? "ltr" : "rtl"}>{isAr ? c.en : c.ar}</div>
          </div>
        ))}
      </div>
      <label className="flex items-start gap-2 cursor-pointer text-xs text-stone-300 leading-relaxed">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-red-600 shrink-0" />
        <span>{t(agree)}</span>
      </label>
      {checked && (
        <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-mono">
          <I d={Ic.check} size={13} />
          {t({ ar: `وُقّع إلكترونياً باسم: ${signerName}`, en: `Signed electronically by: ${signerName}` })}
        </div>
      )}
    </div>
  );
}

// ─── Draft items editor (name + qty + per-item photo) ───
export interface DraftItem { name: string; qty: number; file: File | null; preview: string | null; }

export function ItemPhotoEditor({ items, setItems }: {
  items: DraftItem[]; setItems: (fn: (p: DraftItem[]) => DraftItem[]) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const add = () => {
    const n = name.trim();
    if (!n) return;
    setItems((p) => [...p, { name: n, qty: Math.max(Number(qty) || 1, 1), file: null, preview: null }]);
    setName(""); setQty("1");
  };
  const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={t({ ar: "اسم المعدة (مثال: كاميرا Sony FX6)", en: "Equipment name (e.g. Sony FX6)" })}
          className={`flex-1 min-w-0 ${inp}`} />
        <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min={1}
          className={`w-16 text-center ${inp}`} aria-label={t({ ar: "الكمية", en: "Qty" })} />
        <button type="button" onClick={add}
          className="px-3 rounded-lg bg-stone-800 border border-stone-700 text-stone-300 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-500">
          <I d={Ic.plus} size={16} />
        </button>
      </div>
      {items.length === 0 && (
        <div className="text-xs text-stone-500">{t({ ar: "أضف المعدات، وصوّر كل قطعة (📷 بجانبها).", en: "Add items and photograph each one (📷 next to it)." })}</div>
      )}
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 bg-stone-900 border border-stone-800 rounded-lg p-2">
          <span className="flex-1 min-w-0 truncate text-sm text-stone-200">{it.name}</span>
          <span className="font-mono text-xs text-stone-500">×{it.qty}</span>
          <ItemShot preview={it.preview}
            onPick={(f) => setItems((p) => p.map((x, j) => j === i
              ? { ...x, file: f, preview: URL.createObjectURL(f) } : x))} />
          <button type="button" aria-label={t({ ar: "حذف", en: "Remove" })}
            onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
            className="text-stone-500 hover:text-red-400 p-1"><I d={Ic.trash} size={15} /></button>
        </div>
      ))}
    </div>
  );
}

// ─── Return panel (per-item after photos + shortage path) ───
export function ReturnPanel({ record, items, busy, onSubmit }: {
  record: CustodyRecord; items: CustodyItem[]; busy: boolean;
  onSubmit: (afters: Map<string, File>, overall: File, shortage: boolean, note: string) => void;
}) {
  const { t } = useI18n();
  const [afters, setAfters] = useState<Map<string, { file: File; preview: string }>>(new Map());
  const [overall, setOverall] = useState<{ file: File; preview: string } | null>(null);
  const [shortage, setShortage] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setErr(null);
    if (items.some((it) => !afters.get(it.id))) { setErr(t({ ar: "صوّر كل قطعة عند الإرجاع.", en: "Photograph every item at return." })); return; }
    if (!overall) { setErr(t({ ar: "صوّر إجمالي المعدات عند الإرجاع.", en: "Capture the overall photo at return." })); return; }
    if (shortage && !note.trim()) { setErr(t({ ar: "صف النقص أو التلف قبل الإرسال.", en: "Describe the shortage/damage first." })); return; }
    const m = new Map<string, File>();
    afters.forEach((v, k) => m.set(k, v.file));
    onSubmit(m, overall.file, shortage, note.trim());
  };

  return (
    <div className="mt-3 border-t border-stone-800 pt-3 space-y-3">
      <div className="text-sm font-medium text-stone-200">{t({ ar: "إرجاع العدة", en: "Return equipment" })}</div>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 bg-stone-900 border border-stone-800 rounded-lg p-2">
            <span className="flex-1 min-w-0 truncate text-sm text-stone-200">{it.name}</span>
            <span className="font-mono text-xs text-stone-500">×{it.qty}</span>
            <ItemShot preview={afters.get(it.id)?.preview ?? null}
              onPick={(f) => setAfters((p) => new Map(p).set(it.id, { file: f, preview: URL.createObjectURL(f) }))} />
          </div>
        ))}
      </div>
      <PhotoCapture label={t({ ar: "صورة إجمالي المعدات عند الإرجاع", en: "Overall photo at return" })}
        preview={overall?.preview ?? null} onPick={(f) => setOverall({ file: f, preview: URL.createObjectURL(f) })} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setShortage(false)}
          className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${!shortage ? "bg-emerald-950 border-emerald-700 text-emerald-300" : "bg-stone-900 border-stone-700 text-stone-400"}`}>
          {t({ ar: "الكل سليم وكامل", en: "All sound & complete" })}
        </button>
        <button type="button" onClick={() => setShortage(true)}
          className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${shortage ? "bg-red-950 border-red-700 text-red-300" : "bg-stone-900 border-stone-700 text-stone-400"}`}>
          {t({ ar: "يوجد نقص/تلف", en: "Shortage / damage" })}
        </button>
      </div>
      {shortage && (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder={t({ ar: "صف النقص أو التلف (مثال: عدسة بها خدش / بطارية مفقودة)", en: "Describe it (e.g. scratched lens / missing battery)" })}
          className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500" />
      )}
      {err && <div className="flex items-center gap-1.5 text-red-400 text-xs"><I d={Ic.alert} size={14} />{err}</div>}
      <button type="button" onClick={submit} disabled={busy}
        className="w-full rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 flex items-center justify-center gap-2">
        <I d={Ic.send} size={15} />{busy ? t({ ar: "جارٍ الرفع والإرسال…", en: "Uploading & sending…" }) : t({ ar: "إرسال الإرجاع للإدارة", en: "Send return to management" })}
      </button>
      <div className="text-[11px] text-stone-500">{t({ ar: "الإقفال النهائي من الأدمن فقط.", en: "Final closure is admin-only." })}</div>
    </div>
  );
}

// ─── Record card — the full one-page report (expandable) ───
export function RecordCard({ record, renterInfo, defaultOpen = false, children }: {
  record: CustodyRecord;
  renterInfo?: { id_number: string; phone: string; email: string; address: string } | null;
  defaultOpen?: boolean;
  children?: (ctx: { items: CustodyItem[]; reloadDetails: () => void }) => React.ReactNode;
}) {
  const { t, isAr } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState<CustodyItem[]>([]);
  const [events, setEvents] = useState<CustodyEvent[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const loadDetails = useCallback(async () => {
    const [it, ev] = await Promise.all([listCustodyItems(record.id), listCustodyEvents(record.id)]);
    const its = it.ok ? it.data : [];
    setItems(its);
    setEvents(ev.ok ? ev.data : []);
    const paths = [
      record.overall_before_path, record.overall_after_path,
      ...its.flatMap((x) => [x.photo_before_path, x.photo_after_path]),
    ];
    setUrls(await signEvidence(paths));
    setLoaded(true);
  }, [record.id, record.overall_before_path, record.overall_after_path]);

  useEffect(() => { if (open && !loaded) void loadDetails(); }, [open, loaded, loadDetails]);

  const u = (p: string | null) => (p ? urls[p] ?? null : null);
  const fmt = (iso: string) => new Date(iso).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
      {/* Header row (always visible) */}
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 p-3 text-start focus:outline-none focus:ring-2 focus:ring-red-500">
        <span className="text-red-400"><I d={record.kind === "rental" ? Ic.pkg : Ic.user} size={16} /></span>
        <span className="text-sm font-medium text-stone-100 truncate">{record.party_name}</span>
        <StatusBadge status={record.status} />
        {record.shortage && <span className="text-red-400"><I d={Ic.alert} size={14} /></span>}
        <span className="ms-auto font-mono text-xs text-stone-500" dir="ltr">{record.record_no}</span>
        <span className="text-stone-500 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Party / renter info */}
          <div className="text-[11px] font-mono text-stone-500">
            {record.kind === "rental" ? t({ ar: "تأجير خارجي", en: "External rental" }) : t({ ar: "عهدة داخلية", en: "Internal custody" })}
            {record.party_phone ? <> • <span dir="ltr">{record.party_phone}</span></> : null}
            {" • "}{fmt(record.created_at)}
          </div>
          {renterInfo && (
            <div className="text-[11px] font-mono text-stone-500 leading-relaxed">
              {t({ ar: "هوية", en: "ID" })}: {renterInfo.id_number} • {t({ ar: "جوال", en: "Phone" })}: <span dir="ltr">{renterInfo.phone}</span>
              <br />{t({ ar: "بريد", en: "Email" })}: <span dir="ltr">{renterInfo.email}</span> • {t({ ar: "عنوان", en: "Address" })}: {renterInfo.address}
            </div>
          )}

          {/* Shortage banner */}
          {record.shortage && record.shortage_note && (
            <div className="flex items-start gap-2 bg-red-950 border border-red-800 rounded-lg p-2.5 text-xs text-red-300">
              <I d={Ic.alert} size={14} className="mt-0.5 shrink-0" />
              <span>{t({ ar: "بلاغ نقص/تلف: ", en: "Shortage/damage: " })}{record.shortage_note}</span>
            </div>
          )}

          {/* Items with before/after */}
          <div>
            <div className="text-[11px] font-mono text-stone-500 mb-1.5">{t({ ar: "المعدات — صورة لكل قطعة", en: "Equipment — photo per item" })}</div>
            <div className="space-y-1.5">
              {(loaded ? items : []).map((it) => (
                <div key={it.id} className="flex items-center gap-2 bg-stone-950 border border-stone-800 rounded-lg p-2">
                  <span className="flex-1 min-w-0 truncate text-sm text-stone-200">{it.name}</span>
                  <span className="font-mono text-xs text-stone-500">×{it.qty}</span>
                  <Thumb url={u(it.photo_before_path)} label={t({ ar: "قبل", en: "Before" })} />
                  <Thumb url={u(it.photo_after_path)} label={t({ ar: "بعد", en: "After" })} />
                </div>
              ))}
              {!loaded && <div className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</div>}
            </div>
          </div>

          {/* Overall before/after */}
          <div className="flex gap-3 flex-wrap">
            <PhotoView url={u(record.overall_before_path)} label={t({ ar: "إجمالي — قبل", en: "Overall — before" })} />
            <PhotoView url={u(record.overall_after_path)} label={t({ ar: "إجمالي — بعد", en: "Overall — after" })} />
          </div>

          {/* Signature line */}
          {record.ack_signed && (
            <div className="flex items-center gap-2 text-xs text-stone-400">
              <span className="text-red-400"><I d={Ic.sign} size={14} /></span>
              {t({ ar: "وُقّع: ", en: "Signed: " })}{record.ack_signature}
              <span className="font-mono text-stone-600" dir="ltr">{record.ack_signed_at ? fmt(record.ack_signed_at) : ""}</span>
              <span className="text-stone-600">({record.ack_type === "rental_contract" ? t({ ar: "عقد إيجار", en: "Rental contract" }) : t({ ar: "إقرار عهدة", en: "Custody acknowledgment" })})</span>
            </div>
          )}

          {/* Admin note */}
          {record.admin_note && (
            <div className={`bg-stone-800 rounded-lg p-2.5 text-xs text-stone-300 ${isAr ? "border-r-2" : "border-l-2"} border-red-600`}>
              {t({ ar: "ملاحظة الإدارة: ", en: "Admin note: " })}{record.admin_note}
            </div>
          )}

          {/* Party/admin action slot (ReturnPanel / AdminActions) */}
          {children && loaded && children({ items, reloadDetails: loadDetails })}

          {/* Audit timeline */}
          {events.length > 0 && (
            <div className="pt-1">
              {events.map((ev) => (
                <div key={ev.id} className="flex items-start gap-1.5 text-[11px] text-stone-500 border-t border-stone-800 py-1.5">
                  <I d={Ic.clock} size={11} className="mt-0.5 shrink-0" />
                  <span className="font-mono shrink-0" dir="ltr">{fmt(ev.created_at)}</span>
                  <span>{ev.body}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
