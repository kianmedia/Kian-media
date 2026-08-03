"use client";
// ════════════════════════════════════════════════════════════════════════════
// CommandPalette — بحث شامل بـCmd/Ctrl+K.
//
// Wave 7 · V2-7.1-A
//
// ★ ما ترفض هذه اللوحة أن تفعله ★
//  ١. **لا تُصفّي بنفسها.** الخادم يُصفّي داخل الاستعلام حسب الصلاحية. تصفية في
//     المتصفّح تعني أنّ البيانات وصلت أصلًا.
//  ٢. **لا تبحث عن حرف واحد.** الخادم يرفض ما دون حرفين، والواجهة لا تُرسل.
//  ٣. **لا تُغرق الخادم.** تأخير ٢٥٠ مِلّي ثانية، وإلغاء الطلب السابق عند كلّ
//     ضغطة — وإلّا وصلت النتائج بترتيب خاطئ فبدا البحث «يقفز».
//
// ⛔ خلف علم مطفأ لا يُركَّب مستمع لوحة المفاتيح أصلًا (الحارس في المستدعي).
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { globalSearch, type SearchHit } from "@/lib/portal/client";

const KIND_AR: Record<string, string> = {
  project: "مشروع", deliverable: "مخرَج", asset: "معدّة", client: "عميل",
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K يفتح، Escape يغلق.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const run = useCallback(async (text: string) => {
    // 🔴 عدّاد تسلسليّ: ردّ قديم يصل متأخّرًا لا يستبدل نتيجة أحدث.
    const mine = ++seq.current;
    if (text.trim().length < 2) { setHits(null); setNote(null); setErr(null); return; }
    const r = await globalSearch(text.trim());
    if (mine !== seq.current) return;
    if (r.ok && r.data) {
      setErr(null);
      setNote(r.data.reason === "no_searchable_terms" ? "لا كلمات قابلة للبحث." : null);
      setHits(r.data.rows);
      return;
    }
    setHits(null);
    setErr(r.ok ? "تعذّر البحث." : (r.error ?? "تعذّر البحث."));
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { void run(q); }, 250);
    return () => window.clearTimeout(t);
  }, [q, open, run]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="بحث شامل"
      className="fixed inset-0 z-[100] flex items-start justify-center"
      style={{ background: "rgba(0,0,0,0.6)", paddingTop: "12vh" }}
      onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg mx-4 bg-stone-900 border border-stone-700 rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث في المشاريع والمخرَجات والمعدّات…"
          aria-label="نصّ البحث"
          className="w-full bg-stone-950 px-4 py-3 text-[14px] text-stone-100 outline-none border-b border-stone-800" />

        <div className="max-h-[50vh] overflow-y-auto">
          {q.trim().length > 0 && q.trim().length < 2 && (
            <p className="px-4 py-3 text-[12px] text-stone-500">اكتب حرفين على الأقل.</p>
          )}
          {err && <p className="px-4 py-3 text-[12px] text-red-400">{err}</p>}
          {note && <p className="px-4 py-3 text-[12px] text-stone-500">{note}</p>}
          {hits?.length === 0 && !note && (
            <p className="px-4 py-3 text-[12px] text-stone-500">لا نتائج ضمن ما تملك صلاحيته.</p>
          )}
          {hits && hits.length > 0 && (
            <ul>
              {hits.map((h) => (
                <li key={`${h.kind}:${h.id}`}>
                  <a href={h.href} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-stone-800">
                    <span className="text-[13px] text-stone-100 truncate">
                      {h.title || "—"}
                      {h.code && <span className="text-stone-500 text-[11px]" dir="ltr"> · {h.code}</span>}
                    </span>
                    <span className="text-[11px] text-stone-500 shrink-0">{KIND_AR[h.kind] ?? h.kind}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="px-4 py-2 text-[10.5px] text-stone-600 border-t border-stone-800">
          النتائج مقصورة على ما تملك صلاحيته — التصفية تقع في القاعدة لا هنا.
        </p>
      </div>
    </div>
  );
}
