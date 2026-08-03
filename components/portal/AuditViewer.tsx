"use client";
// ════════════════════════════════════════════════════════════════════════════
// AuditViewer — عارض سجلّ التدقيق. **قراءة فقط.**
//
// Wave 7 · V2-7.3-A
//
// ★★ لماذا يقول هذا العارض ما لا يعرضه ★★
// المستودع فيه `activity_log` **وأربعة عشر سجلّ تدقيق للوحدات**. توحيدها في
// شاشة واحدة يُنتج عرضًا **يبدو كاملًا وهو ليس كذلك** — ومن يقرؤه في تحقيق
// يظنّ أنّه رأى كلّ ما جرى. فالشاشة تقرأ السجلّ العابر للوحدات، **وتُسمّي
// البقيّة صراحةً** مع بيان أنّها ليست هنا.
//
// ⛔ ولا سجلّ سادس عشر: هذه قراءة بحتة، ولا تكتب حرفًا.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  auditViewerList, auditSourcesRegistry,
  type AuditRow,
} from "@/lib/portal/client";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const field = "bg-stone-950 border border-stone-700 rounded px-2 py-1 text-[12px] text-stone-200";

export default function AuditViewer() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [sources, setSources] = useState<{ table: string; in_viewer: boolean }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [action, setAction] = useState("");

  const load = useCallback(async () => {
    setRows(null); setErr(null);
    const r = await auditViewerList(action ? { action } : {});
    if (r.ok && r.data) { setRows(r.data.rows); return; }
    setErr(r.ok ? "تعذّر التحميل." : (r.error ?? "تعذّر التحميل."));
  }, [action]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void auditSourcesRegistry().then((r) => { if (r.ok && r.data) setSources(r.data.sources); });
  }, []);

  const notShown = (sources ?? []).filter((s) => !s.in_viewer);

  return (
    <section className={card}>
      {/* 🔴 W7-1 — تحذير **دائم** لا يُطوى ولا يُغلق. سببه أنّ من يقرأ شاشة
          تدقيق في تحقيق يفترض الشمول ما لم يُقَل له العكس صراحةً. */}
      <p role="note"
         className="mb-2 px-2 py-1.5 rounded border border-amber-700/60 bg-amber-950/30 text-[11px] text-amber-300 leading-relaxed">
        <strong>PARTIAL AUDIT VIEW — NOT A COMPLETE INVESTIGATION RECORD</strong>
        <span className="block text-amber-400/90 mt-0.5">
          عرض جزئيّ من مصدر واحد. ⛔ ليس سجلّ تحقيق كاملًا، ولا يُعتمد وحده.
        </span>
      </p>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-[13px] text-stone-100">سجلّ الإجراءات</h3>
        <input className={field} value={action} onChange={(e) => setAction(e.target.value)}
          placeholder="تصفية بالإجراء" aria-label="تصفية بالإجراء" />
      </div>

      {err && (
        <p className="text-[12px] text-red-400">
          {err} <button className="underline" onClick={load}>إعادة المحاولة</button>
        </p>
      )}
      {rows === null && !err && <p className="text-[12px] text-stone-500">جارٍ التحميل…</p>}
      {rows?.length === 0 && <p className="text-[12px] text-stone-500">لا إجراءات في هذا النطاق.</p>}

      {rows && rows.length > 0 && (
        <ul className="space-y-1 max-h-[46vh] overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id} className="border-t border-stone-800 pt-1 text-[12px]">
              <div className="flex justify-between gap-3">
                <span className="text-stone-200 truncate">{r.action}</span>
                <span className="text-stone-500 shrink-0 tabular-nums" dir="ltr">
                  {new Date(r.created_at).toLocaleString("en-GB")}
                </span>
              </div>
              <div className="text-[10.5px] text-stone-600">
                {r.actor_role ?? "—"}
                {r.entity_type && <span> · {r.entity_type}</span>}
                {/* ⛔ مفاتيح لا قيم: metadata حرّ كتبه مستدعٍ سابق. */}
                {r.metadata_keys?.length > 0 && <span> · [{r.metadata_keys.join(", ")}]</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 🔴 ما لا تعرضه هذه الشاشة — يُسمّى، فلا يُظنّ أنّه غير موجود. */}
      {notShown.length > 0 && (
        <div className="mt-3 border-t border-stone-800 pt-2">
          <p className="text-[11px] text-amber-500 mb-1">
            هذه الشاشة تقرأ <span dir="ltr">activity_log</span> وحده — وليست كلّ التدقيق.
          </p>
          <p className="text-[10.5px] text-stone-500 leading-relaxed">
            {notShown.length} سجلًّا آخر للوحدات لها أشكالها وبوّاباتها ولا تُقرأ هنا:{" "}
            <span dir="ltr">{notShown.map((s) => s.table).join(" · ")}</span>
          </p>
        </div>
      )}
    </section>
  );
}
