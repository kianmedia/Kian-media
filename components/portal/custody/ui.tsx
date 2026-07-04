"use client";
// ════════════════════════════════════════════════════════════════════════
// Equipment Custody & Rental — shared UI v2.
// v2 adds: UNLIMITED multi-photo capture (min 2 per item + 2 overall, at both
// checkout and return), click-to-zoom lightbox with save/download, the
// financial-claim flow (رفض الإقفال → مطالبة → تعهد بالسداد → سند قابل
// للطباعة لصالح شركة كيان الابتكار المتميز للإنتاج الفني), and photo galleries
// backed by the custody_photos table (legacy single-path fallback kept).
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  CUSTODY_STATUS_LABELS, CLAIM_CREDITOR, MIN_PHOTOS_PER_ITEM, MIN_PHOTOS_OVERALL,
  listCustodyItems, listCustodyEvents, listCustodyPhotos, signEvidence,
  acknowledgeCustodyClaim, emitCustodyEvent,
  type CustodyRecord, type CustodyItem, type CustodyEvent, type CustodyPhoto,
  type RecordStatus, type RenterProfile,
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
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3",
  x: "M18 6 6 18|M6 6l12 12",
  zoom: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|m21 21-4.35-4.35|M11 8v6|M8 11h6",
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
export const PLEDGE_AGREE = {
  ar: "أقر بصحة المطالبة المالية الموضحة أعلاه، وأتعهد بسداد كامل مبلغ التعويض لصالح شركة كيان الابتكار المتميز للإنتاج الفني، ويُعد هذا التأشير توقيعاً إلكترونياً ملزماً وسنداً بالمديونية يجوز الاحتجاج به نظاماً.",
  en: "I acknowledge the above financial claim and pledge to pay the full compensation amount to Kian Al-Ebtikar Al-Mutamayz for Artistic Production. This checkmark constitutes a binding electronic signature and a debt instrument enforceable by law.",
};

// ─── Status badge ───
const STATUS_CLS: Record<RecordStatus, string> = {
  out:             "bg-amber-950 text-amber-300 border-amber-800",
  review_handover: "bg-sky-950 text-sky-300 border-sky-800",
  rented:          "bg-amber-950 text-amber-300 border-amber-800",
  review_return:   "bg-sky-950 text-sky-300 border-sky-800",
  claim_pending:   "bg-red-950 text-red-300 border-red-700",
  closed:          "bg-emerald-950 text-emerald-300 border-emerald-800",
  rejected:        "bg-red-950 text-red-300 border-red-800",
  flagged:         "bg-red-950 text-red-300 border-red-800",
};
export function StatusBadge({ status }: { status: RecordStatus }) {
  const { t } = useI18n();
  const l = CUSTODY_STATUS_LABELS[status] ?? { ar: status, en: status };
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${STATUS_CLS[status] || "bg-stone-800 text-stone-300 border-stone-700"}`}>
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

// ─── Viewfinder corner brackets ───
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

// ─── Lightbox (تكبير + حفظ الصورة بالنقر) ───
export function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="flex gap-2 mb-3" onClick={(e) => e.stopPropagation()}>
        <a href={url} download target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-2">
          <I d={Ic.download} size={14} />{t({ ar: "حفظ / تحميل", en: "Save / Download" })}
        </a>
        <button type="button" onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg bg-stone-800 border border-stone-600 text-stone-200 text-xs px-3 py-2">
          <I d={Ic.x} size={14} />{t({ ar: "إغلاق", en: "Close" })}
        </button>
      </div>
      <img src={url} alt="" onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-[80vh] rounded-lg border border-stone-700 object-contain" />
    </div>
  );
}

// ─── Photo capture primitives (multi) ───
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

export interface ShotFile { file: File; preview: string; }

/** Per-item multi-photo strip: thumbnails + add button + min-2 counter. */
export function ItemShots({ shots, onAdd, onRemove, min = MIN_PHOTOS_PER_ITEM }: {
  shots: ShotFile[]; onAdd: (f: File) => void; onRemove: (i: number) => void; min?: number;
}) {
  const { t } = useI18n();
  const { open, input } = useFilePick(onAdd);
  const ok = shots.length >= min;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {input}
      {shots.map((s, i) => (
        <span key={i} className="relative">
          <img src={s.preview} alt="" className="w-12 h-10 rounded-md object-cover border border-red-500" />
          <button type="button" aria-label={t({ ar: "حذف الصورة", en: "Remove photo" })}
            onClick={() => onRemove(i)}
            className="absolute -top-1.5 -end-1.5 w-4 h-4 rounded-full bg-stone-900 border border-stone-600 text-stone-300 flex items-center justify-center">
            <I d={Ic.x} size={9} />
          </button>
        </span>
      ))}
      <button type="button" onClick={open}
        className={`w-12 h-10 shrink-0 rounded-md bg-stone-900 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-red-500 ${ok ? "border border-stone-700 text-stone-500" : "border border-dashed border-red-700 text-red-400"}`}>
        <I d={Ic.camera} size={15} />
      </button>
      <span className={`text-[10px] font-mono ${ok ? "text-emerald-400" : "text-red-400"}`}>
        {shots.length}/{min}+
      </span>
    </div>
  );
}

/** Overall multi-photo capture with viewfinder brackets (min 2, unlimited). */
export function MultiPhotoCapture({ label, shots, onAdd, onRemove, min = MIN_PHOTOS_OVERALL }: {
  label: string; shots: ShotFile[]; onAdd: (f: File) => void; onRemove: (i: number) => void; min?: number;
}) {
  const { t } = useI18n();
  const { open, input } = useFilePick(onAdd);
  const ok = shots.length >= min;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-mono text-stone-500">{label}</span>
        <span className={`text-[10px] font-mono ${ok ? "text-emerald-400" : "text-red-400"}`}>{shots.length}/{min}+</span>
      </div>
      {input}
      <Viewfinder active={ok}>
        <div className="w-full min-h-28 rounded-lg bg-stone-800 p-2 flex flex-wrap gap-2 items-center">
          {shots.map((s, i) => (
            <span key={i} className="relative">
              <img src={s.preview} alt="" className="w-20 h-16 rounded-md object-cover border border-red-500" />
              <button type="button" aria-label={t({ ar: "حذف الصورة", en: "Remove photo" })}
                onClick={() => onRemove(i)}
                className="absolute -top-1.5 -end-1.5 w-4 h-4 rounded-full bg-stone-900 border border-stone-600 text-stone-300 flex items-center justify-center">
                <I d={Ic.x} size={9} />
              </button>
            </span>
          ))}
          <button type="button" onClick={open}
            className="w-20 h-16 rounded-md border border-dashed border-stone-600 text-stone-400 flex flex-col items-center justify-center gap-0.5 focus:outline-none focus:ring-2 focus:ring-red-500">
            <I d={Ic.camera} size={18} />
            <span className="text-[10px]">{t({ ar: "أضف صورة", en: "Add photo" })}</span>
          </button>
        </div>
      </Viewfinder>
    </div>
  );
}

/** Read-only clickable gallery (signed URLs) with a قبل/بعد label. */
export function PhotoGallery({ label, urls, onZoom, size = "w-12 h-10" }: {
  label: string; urls: string[]; onZoom: (u: string) => void; size?: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-mono text-stone-500 mb-0.5">{label}</div>
      <div className="flex gap-1 flex-wrap">
        {urls.length === 0 && <span className="text-stone-600 text-xs">—</span>}
        {urls.map((u, i) => (
          <button key={i} type="button" onClick={() => onZoom(u)}
            className="rounded-md overflow-hidden border border-stone-700 hover:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500">
            <img src={u} alt="" className={`${size} object-cover`} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Click-to-sign block ───
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

// ─── Draft items editor (name + qty + multi photos ≥2) ───
export interface DraftItem { name: string; qty: number; shots: ShotFile[]; }

export function ItemPhotoEditor({ items, setItems }: {
  items: DraftItem[]; setItems: (fn: (p: DraftItem[]) => DraftItem[]) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const add = () => {
    const n = name.trim();
    if (!n) return;
    setItems((p) => [...p, { name: n, qty: Math.max(Number(qty) || 1, 1), shots: [] }]);
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
        <div className="text-xs text-stone-500">
          {t({ ar: `أضف المعدات، وصوّر كل قطعة (${MIN_PHOTOS_PER_ITEM} صور على الأقل لكل بند 📷).`, en: `Add items and photograph each one (min ${MIN_PHOTOS_PER_ITEM} photos per item 📷).` })}
        </div>
      )}
      {items.map((it, i) => (
        <div key={i} className="bg-stone-900 border border-stone-800 rounded-lg p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate text-sm text-stone-200">{it.name}</span>
            <span className="font-mono text-xs text-stone-500">×{it.qty}</span>
            <button type="button" aria-label={t({ ar: "حذف البند", en: "Remove item" })}
              onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
              className="text-stone-500 hover:text-red-400 p-1"><I d={Ic.trash} size={15} /></button>
          </div>
          <ItemShots shots={it.shots}
            onAdd={(f) => setItems((p) => p.map((x, j) => j === i
              ? { ...x, shots: [...x.shots, { file: f, preview: URL.createObjectURL(f) }] } : x))}
            onRemove={(si) => setItems((p) => p.map((x, j) => j === i
              ? { ...x, shots: x.shots.filter((_, k) => k !== si) } : x))} />
        </div>
      ))}
    </div>
  );
}

// ─── Return panel (≥2 after photos per item + ≥2 overall + shortage path) ───
export function ReturnPanel({ record, items, busy, onSubmit }: {
  record: CustodyRecord; items: CustodyItem[]; busy: boolean;
  onSubmit: (afters: Map<string, File[]>, overall: File[], shortage: boolean, note: string) => void;
}) {
  const { t } = useI18n();
  const [afters, setAfters] = useState<Map<string, ShotFile[]>>(new Map());
  const [overall, setOverall] = useState<ShotFile[]>([]);
  const [shortage, setShortage] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setErr(null);
    if (items.some((it) => (afters.get(it.id)?.length ?? 0) < MIN_PHOTOS_PER_ITEM)) {
      setErr(t({ ar: `صوّر كل قطعة عند الإرجاع (${MIN_PHOTOS_PER_ITEM} صور على الأقل لكل بند).`, en: `Photograph every item at return (min ${MIN_PHOTOS_PER_ITEM} each).` })); return;
    }
    if (overall.length < MIN_PHOTOS_OVERALL) {
      setErr(t({ ar: `صوّر إجمالي المعدات عند الإرجاع (${MIN_PHOTOS_OVERALL} صور على الأقل).`, en: `Capture the overall photos at return (min ${MIN_PHOTOS_OVERALL}).` })); return;
    }
    if (shortage && !note.trim()) { setErr(t({ ar: "صف النقص أو التلف قبل الإرسال.", en: "Describe the shortage/damage first." })); return; }
    const m = new Map<string, File[]>();
    afters.forEach((v, k) => m.set(k, v.map((s) => s.file)));
    onSubmit(m, overall.map((s) => s.file), shortage, note.trim());
  };

  return (
    <div className="mt-3 border-t border-stone-800 pt-3 space-y-3">
      <div className="text-sm font-medium text-stone-200">{t({ ar: "إرجاع العدة", en: "Return equipment" })}</div>
      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.id} className="bg-stone-900 border border-stone-800 rounded-lg p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate text-sm text-stone-200">{it.name}</span>
              <span className="font-mono text-xs text-stone-500">×{it.qty}</span>
            </div>
            <ItemShots shots={afters.get(it.id) ?? []}
              onAdd={(f) => setAfters((p) => {
                const m = new Map(p);
                m.set(it.id, [...(m.get(it.id) ?? []), { file: f, preview: URL.createObjectURL(f) }]);
                return m;
              })}
              onRemove={(i) => setAfters((p) => {
                const m = new Map(p);
                m.set(it.id, (m.get(it.id) ?? []).filter((_, k) => k !== i));
                return m;
              })} />
          </div>
        ))}
      </div>
      <MultiPhotoCapture label={t({ ar: "صور إجمالي المعدات عند الإرجاع", en: "Overall photos at return" })}
        shots={overall}
        onAdd={(f) => setOverall((p) => [...p, { file: f, preview: URL.createObjectURL(f) }])}
        onRemove={(i) => setOverall((p) => p.filter((_, k) => k !== i))} />
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

// ─── سند المطالبة (قابل للطباعة / حفظ PDF) ───
export function openBondWindow(record: CustodyRecord, renter?: RenterProfile | null) {
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar-SA") : "—");
  const idLine = renter ? `<div>رقم الهوية / الإقامة: <b>${renter.id_number}</b></div>` : "";
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>سند مطالبة — ${record.record_no}</title>
<style>
  body{font-family:'Tajawal','Segoe UI',sans-serif;color:#111;margin:40px auto;max-width:720px;line-height:2}
  .head{text-align:center;border-bottom:3px solid #A51419;padding-bottom:12px;margin-bottom:24px}
  .head h1{margin:0;font-size:22px;color:#A51419}
  .box{border:1px solid #999;border-radius:8px;padding:18px 22px;margin:14px 0}
  .amount{font-size:26px;font-weight:800;color:#A51419;text-align:center;border:2px solid #A51419;border-radius:8px;padding:10px;margin:16px 0}
  .meta{font-size:13px;color:#444}
  .sig{margin-top:28px;display:flex;justify-content:space-between;gap:24px;font-size:14px}
  .foot{margin-top:30px;font-size:12px;color:#666;border-top:1px solid #ccc;padding-top:10px}
  @media print{.noprint{display:none}}
</style></head><body>
<div class="head">
  <h1>سند إقرار بمديونية وتعهد بالسداد</h1>
  <div class="meta">رقم السجل: <b dir="ltr">${record.record_no}</b> — ${record.kind === "rental" ? "تأجير معدات" : "عهدة معدات"}</div>
</div>
<div class="box">
  <div>أقر أنا الموقّع إلكترونياً أدناه: <b>${record.party_name}</b></div>
  ${idLine}
  ${record.party_phone ? `<div>الجوال: <b dir="ltr">${record.party_phone}</b></div>` : ""}
  <div>بأنني مدين وأتعهد بأن أدفع لأمر: <b>${CLAIM_CREDITOR}</b></div>
  <div class="amount">${Number(record.claim_amount ?? 0).toLocaleString("ar-SA", { minimumFractionDigits: 2 })} ريال سعودي</div>
  ${record.claim_note ? `<div>سبب المطالبة: ${record.claim_note}</div>` : ""}
  ${record.shortage_note ? `<div>بلاغ النقص/التلف الموثّق: ${record.shortage_note}</div>` : ""}
  <div class="meta">وذلك تعويضاً عن النقص/التلف الموثّق بالصور والسجل الزمني في سجل ${record.kind === "rental" ? "التأجير" : "العهدة"} المشار إليه أعلاه.</div>
</div>
<div class="box meta">
  <div>التوقيع الإلكتروني: <b>${record.claim_ack_signature ?? record.party_name}</b> ${record.claim_ack_signed ? "✓ (تأشير إلكتروني مُوثَّق بمثابة توقيع ملزم)" : "— بانتظار التوقيع"}</div>
  <div>تاريخ ووقت التوقيع: <b>${fmt(record.claim_ack_at)}</b></div>
  ${record.claim_ack_ip ? `<div>عنوان IP الموثّق عند التوقيع: <b dir="ltr">${record.claim_ack_ip}</b></div>` : ""}
  <div>تاريخ إنشاء السجل: <b>${fmt(record.created_at)}</b></div>
</div>
<div class="sig">
  <div>المدين / المتعهد بالسداد:<br><b>${record.party_name}</b></div>
  <div>صاحب الحق (الدائن):<br><b>${CLAIM_CREDITOR}</b></div>
</div>
<div class="foot">
  حُرّر هذا السند إلكترونياً عبر بوابة كيان ويُعد التأشير الإلكتروني الموثق فيه (بالاسم والتاريخ وعنوان IP)
  توقيعاً ملزماً وإقراراً بالمديونية، ويحق للدائن الاحتجاج به وتقديمه للجهات القضائية والنظامية المختصة
  في حال الامتناع عن السداد.
</div>
<div class="noprint" style="text-align:center;margin-top:24px">
  <button onclick="window.print()" style="background:#A51419;color:#fff;border:0;border-radius:8px;padding:10px 26px;font-size:15px;cursor:pointer">طباعة / حفظ PDF</button>
</div>
</body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); w.focus(); }
}

// ─── كتلة المطالبة داخل البطاقة (بانر + تعهد السداد + عرض السند) ───
function ClaimBlock({ record, onChanged }: { record: CustodyRecord; onChanged?: () => void }) {
  const { t } = useI18n();
  const { profile, readOnly } = usePortal();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isParty = profile.id === record.party_user_id;
  const hasClaim = record.status === "claim_pending" || (record.claim_amount ?? 0) > 0;
  if (!hasClaim) return null;

  async function pledge() {
    setErr(null);
    if (!checked) { setErr(t({ ar: "أشّر على التعهد أولاً.", en: "Check the pledge first." })); return; }
    setBusy(true);
    const r = await acknowledgeCustodyClaim(record.id);
    setBusy(false);
    if (!r.ok) { setErr((t({ ar: "تعذّر: ", en: "Failed: " })) + r.error); return; }
    emitCustodyEvent({ event: "custody_claim_acknowledged", record_id: record.id, record_no: record.record_no, kind: record.kind, party_name: record.party_name, amount: record.claim_amount ?? 0 });
    onChanged?.();
  }

  return (
    <div className="bg-red-950/60 border border-red-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 text-red-300 text-sm font-medium">
        <I d={Ic.alert} size={15} />
        {t({ ar: "مطالبة مالية (تعويض)", en: "Financial claim (compensation)" })}
        <span className="ms-auto font-mono text-red-200" dir="ltr">
          {Number(record.claim_amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} SAR
        </span>
      </div>
      {record.claim_note && <div className="text-xs text-red-200/80">{record.claim_note}</div>}
      <div className="text-[11px] text-red-200/70">
        {t({ ar: `صاحب الحق في التعويض: ${CLAIM_CREDITOR}`, en: `Beneficiary: ${CLAIM_CREDITOR}` })}
      </div>

      {record.status === "claim_pending" && isParty && !readOnly && (
        <div className="bg-stone-900/70 border border-stone-700 rounded-lg p-2.5 space-y-2">
          <label className="flex items-start gap-2 cursor-pointer text-xs text-stone-200 leading-relaxed">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-red-600 shrink-0" />
            <span>{t(PLEDGE_AGREE)}</span>
          </label>
          {err && <div className="text-red-400 text-xs">{err}</div>}
          <button type="button" onClick={() => void pledge()} disabled={busy}
            className="w-full rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2">
            {busy ? "…" : t({ ar: "توقيع التعهد بالسداد وإقفال العهدة", en: "Sign the payment pledge & close" })}
          </button>
        </div>
      )}
      {record.status === "claim_pending" && !isParty && (
        <div className="text-[11px] text-stone-400">{t({ ar: "بانتظار توقيع الطرف على تعهد السداد.", en: "Awaiting the party's payment pledge." })}</div>
      )}

      {record.claim_ack_signed && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-mono">
            <I d={Ic.check} size={13} />
            {t({ ar: `وُقّع التعهد: ${record.claim_ack_signature}`, en: `Pledge signed: ${record.claim_ack_signature}` })}
          </span>
          <button type="button" onClick={() => openBondWindow(record)}
            className="ms-auto rounded-lg bg-stone-800 border border-red-800 text-red-300 text-xs px-3 py-1.5 flex items-center gap-1.5">
            <I d={Ic.sign} size={13} />{t({ ar: "عرض / طباعة السند", en: "View / print the bond" })}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Record card — the full one-page report (expandable) ───
export function RecordCard({ record, renterInfo, defaultOpen = false, onChanged, children }: {
  record: CustodyRecord;
  renterInfo?: RenterProfile | null;
  defaultOpen?: boolean;
  onChanged?: () => void;
  children?: (ctx: { items: CustodyItem[]; reloadDetails: () => void }) => React.ReactNode;
}) {
  const { t, isAr } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState<CustodyItem[]>([]);
  const [events, setEvents] = useState<CustodyEvent[]>([]);
  const [photos, setPhotos] = useState<CustodyPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  const loadDetails = useCallback(async () => {
    const [it, ev, ph] = await Promise.all([
      listCustodyItems(record.id), listCustodyEvents(record.id), listCustodyPhotos(record.id),
    ]);
    const its = it.ok ? it.data : [];
    const phs = ph.ok ? ph.data : [];
    setItems(its);
    setEvents(ev.ok ? ev.data : []);
    setPhotos(phs);
    const paths = [
      record.overall_before_path, record.overall_after_path,
      ...its.flatMap((x) => [x.photo_before_path, x.photo_after_path]),
      ...phs.map((p) => p.path),
    ];
    setUrls(await signEvidence(paths));
    setLoaded(true);
  }, [record.id, record.overall_before_path, record.overall_after_path]);

  useEffect(() => { if (open && !loaded) void loadDetails(); }, [open, loaded, loadDetails]);

  const u = (p: string | null) => (p ? urls[p] ?? null : null);
  const fmt = (iso: string) => new Date(iso).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" });

  // Gallery URLs per item/stage — custody_photos first, legacy single-path fallback.
  const gal = (itemId: string | null, stage: "before" | "after", legacy: string | null): string[] => {
    const list = photos.filter((p) => p.item_id === itemId && p.stage === stage)
      .map((p) => urls[p.path]).filter((x): x is string => !!x);
    if (list.length > 0) return list;
    const lu = legacy ? urls[legacy] : null;
    return lu ? [lu] : [];
  };

  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
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

          {record.shortage && record.shortage_note && (
            <div className="flex items-start gap-2 bg-red-950 border border-red-800 rounded-lg p-2.5 text-xs text-red-300">
              <I d={Ic.alert} size={14} className="mt-0.5 shrink-0" />
              <span>{t({ ar: "بلاغ نقص/تلف: ", en: "Shortage/damage: " })}{record.shortage_note}</span>
            </div>
          )}

          {/* المطالبة المالية / التعهد / السند */}
          <ClaimBlock record={record} onChanged={onChanged} />

          {/* Items with before/after galleries (click any photo to zoom/save) */}
          <div>
            <div className="text-[11px] font-mono text-stone-500 mb-1.5">
              {t({ ar: "المعدات — اضغط أي صورة للتكبير والحفظ", en: "Equipment — click any photo to zoom & save" })}
            </div>
            <div className="space-y-1.5">
              {(loaded ? items : []).map((it) => (
                <div key={it.id} className="bg-stone-950 border border-stone-800 rounded-lg p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate text-sm text-stone-200">{it.name}</span>
                    <span className="font-mono text-xs text-stone-500">×{it.qty}</span>
                  </div>
                  <div className="flex gap-4 flex-wrap">
                    <PhotoGallery label={t({ ar: "قبل", en: "Before" })} urls={gal(it.id, "before", it.photo_before_path)} onZoom={setZoom} />
                    <PhotoGallery label={t({ ar: "بعد", en: "After" })} urls={gal(it.id, "after", it.photo_after_path)} onZoom={setZoom} />
                  </div>
                </div>
              ))}
              {!loaded && <div className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</div>}
            </div>
          </div>

          {/* Overall before/after galleries */}
          <div className="flex gap-6 flex-wrap">
            <PhotoGallery label={t({ ar: "إجمالي — قبل", en: "Overall — before" })} size="w-20 h-16"
              urls={gal(null, "before", record.overall_before_path)} onZoom={setZoom} />
            <PhotoGallery label={t({ ar: "إجمالي — بعد", en: "Overall — after" })} size="w-20 h-16"
              urls={gal(null, "after", record.overall_after_path)} onZoom={setZoom} />
          </div>

          {record.ack_signed && (
            <div className="flex items-center gap-2 text-xs text-stone-400 flex-wrap">
              <span className="text-red-400"><I d={Ic.sign} size={14} /></span>
              {t({ ar: "وُقّع: ", en: "Signed: " })}{record.ack_signature}
              <span className="font-mono text-stone-600" dir="ltr">{record.ack_signed_at ? fmt(record.ack_signed_at) : ""}</span>
              <span className="text-stone-600">({record.ack_type === "rental_contract" ? t({ ar: "عقد إيجار", en: "Rental contract" }) : t({ ar: "إقرار عهدة", en: "Custody acknowledgment" })})</span>
            </div>
          )}

          {record.admin_note && (
            <div className={`bg-stone-800 rounded-lg p-2.5 text-xs text-stone-300 ${isAr ? "border-r-2" : "border-l-2"} border-red-600`}>
              {t({ ar: "ملاحظة الإدارة: ", en: "Admin note: " })}{record.admin_note}
            </div>
          )}

          {children && loaded && children({ items, reloadDetails: loadDetails })}

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

      {zoom && <Lightbox url={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
