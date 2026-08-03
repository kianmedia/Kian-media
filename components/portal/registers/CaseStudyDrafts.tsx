"use client";
// ════════════════════════════════════════════════════════════════════════════
// CaseStudyDrafts — طابور مسوّدات دراسات الحالة.
//
// Wave 6 · V2-6.8-A/B/D/E
//
// ★ ما ترفض هذه الشاشة أن تفعله ★
//  ١. **لا تنشر.** لا زرّ نشر هنا إطلاقًا — النشر مسار المنصّة القائم بمراجعته
//     الداخلية والقانونية وإذن العميل.
//  ٢. **لا تُصدّر.** التصدير سكربت تطوير/CI؛ هذه الشاشة **تسجّل** أنّه حدث.
//     الكتابة في ملفّ محتوى وقت التشغيل على Vercel تُفقد عند أوّل نشر.
//  ٣. **لا تعرض «معتمَدة» كأنّها «منشورة».** الحالتان مختلفتان، والخلط بينهما
//     يجعل فريقًا يظنّ أنّ دراسة على الموقع وهي ليست كذلك.
//
// ⛔ خلف علم مطفأ لا تُركَّب (الحارس في المستدعي).
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  csDraftQueue, csGenerateDraft, csMarkExported,
  CS_STATUS_AR, type CsDraftRow,
} from "@/lib/portal/caseStudies";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const btn = "px-3 py-1.5 rounded-lg text-[12px] bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700";
const field = "bg-stone-950 border border-stone-700 rounded px-2 py-1 text-[12px] text-stone-200";

export default function CaseStudyDrafts() {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<CsDraftRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRows(null); setErr(null);
    const r = await csDraftQueue(status || null);
    // ⚠️ `CsOutcome` اتّحاد مُميَّز بـ`state` — وهو نمط المنصّة القائم. الحالة
    //    "pending_migration" مستقلّة عن "denied" عمدًا، فلا تُقرأ كمشكلة صلاحية.
    if (r.state === "ok") { setRows(r.data.rows); return; }
    setErr(r.message);
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    if (title.trim().length < 3) { setMsg("العنوان الداخليّ مطلوب (٣ أحرف على الأقل)."); return; }
    setBusy(true); setMsg(null);
    // ⛔ بلا مشروع مصدر: الهيكل وحده. لا نسخ نصّ تسويقيّ من أيّ مكان.
    const r = await csGenerateDraft(null, title.trim());
    setBusy(false);
    if (r.state === "ok" && r.data.ok) {
      setTitle("");
      setMsg("أُنشئت مسوّدة. كلّ نصّ عامّ فارغ عمدًا — يحتاج كتابة ومراجعة.");
      void load();
      return;
    }
    setMsg(r.state === "ok"
      ? (r.data.reason === "slug_taken" ? "المُعرِّف مستعمَل — غيّر العنوان." : "تعذّر الإنشاء.")
      : r.message);
  }

  async function markExported(row: CsDraftRow) {
    const target = window.prompt("وجهة التصدير (مثل: content/portfolio.ts عبر PR):")?.trim() ?? "";
    if (!target) return;
    const r = await csMarkExported(row.id, target);
    if (r.state === "ok" && r.data.ok) { setMsg("سُجّل التصدير."); void load(); return; }
    setMsg(r.state === "ok" && r.data.reason === "not_approved"
      ? "لا يُصدَّر إلّا المعتمَد — هذه الدراسة ما تزال في المراجعة."
      : (r.state === "ok" ? "تعذّر التسجيل." : r.message));
  }

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-[13px] text-stone-100">مسوّدات دراسات الحالة</h3>
        <select className={field} value={status} onChange={(e) => setStatus(e.target.value)}
          aria-label="تصفية حسب الحالة">
          <option value="">كلّ الحالات</option>
          {Object.entries(CS_STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="flex items-end gap-2 flex-wrap mb-3">
        <input className={`${field} flex-1 min-w-[160px]`} value={title} placeholder="عنوان داخليّ للمسوّدة"
          onChange={(e) => setTitle(e.target.value)} aria-label="العنوان الداخليّ" />
        <button className={btn} onClick={generate} disabled={busy}>
          {busy ? "جارٍ الإنشاء…" : "إنشاء مسوّدة"}
        </button>
      </div>
      {/* 🔴 القالب ينتج هيكلًا لا محتوى — ولا يخترع نتائج ولا أسماء عملاء. */}
      <p className="text-[10.5px] text-stone-500 mb-3 leading-relaxed">
        القالب يُنشئ **هيكلًا** فقط: كلّ نصّ عامّ يبقى فارغًا ليكتبه إنسان، ولا
        يُنسخ نصّ تسويقيّ ولا رقم ولا اسم عميل من أيّ مصدر.
      </p>

      {err && (
        <p className="text-[12px] text-red-400">
          {err} <button className="underline" onClick={load}>إعادة المحاولة</button>
        </p>
      )}
      {rows === null && !err && <p className="text-[12px] text-stone-500">جارٍ التحميل…</p>}
      {rows?.length === 0 && (
        <p className="text-[12px] text-stone-500">
          لا مسوّدات في هذه الحالة. أنشئ واحدة أعلاه لتبدأ.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="border-t border-stone-800 pt-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[12.5px] text-stone-100 truncate">{r.internal_title}</span>
                <span className="shrink-0 text-[11px]">
                  {/* 🔴 «معتمَدة» ≠ «منشورة» — تُعرضان بلونين مختلفين. */}
                  <span className={
                    r.is_published ? "text-emerald-500"
                    : r.status === "approved" ? "text-sky-400"
                    : "text-amber-500"}>
                    {CS_STATUS_AR[r.status] ?? r.status}
                  </span>
                </span>
              </div>
              <div className="text-[10.5px] text-stone-500 mt-1">
                <span dir="ltr">{r.slug}</span>
                {r.generation_method === "template_v1" && <span> · بقالب</span>}
                {r.has_unapproved_changes && <span className="text-amber-500"> · تغييرات غير معتمَدة</span>}
                {r.exported_at && <span> · صُدِّرت</span>}
              </div>

              {/* provenance يُعرض كما هو — مفاتيح لا قيم. */}
              {r.source_provenance && Object.keys(r.source_provenance).length > 0 && (
                <p className="text-[10px] text-stone-600 mt-1 break-all">
                  المصدر: {Object.keys(r.source_provenance).join(" · ")}
                </p>
              )}

              {r.exportable ? (
                <button className={`${btn} mt-1 text-[11px]`} onClick={() => markExported(r)}>
                  تسجيل التصدير
                </button>
              ) : (
                <p className="text-[10.5px] text-stone-600 mt-1">
                  ⛔ لا يُصدَّر قبل الاعتماد.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {msg && <p className="text-[12px] text-stone-300 mt-2">{msg}</p>}

      {/* 🔴 القيد الصلب، مذكورًا حيث يُقرأ. */}
      <p className="text-[10.5px] text-stone-500 mt-3 border-t border-stone-800 pt-2 leading-relaxed">
        التصدير يقع في سكربت تطوير أو CI ثمّ يدخل المستودع بمراجعة بشرية —
        ⛔ لا يُكتب ملفّ محتوى وقت التشغيل: نظام الملفّات هناك للقراءة، والكتابة
        تُفقد عند أوّل نشر.
      </p>
    </section>
  );
}
