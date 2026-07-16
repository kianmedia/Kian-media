"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — مركز المحذوفات: كل الكيانات المحذوفة ناعمًا (بسبب/منفّذ/وقت)
// مع استعادة بنقرة. للمديرين/المحرّرين. مصدر البيانات: project_core_trash.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  pcTrashList, pcEntityRestore, fmtDT, pcErr, ENTITY_LABELS,
  type TrashRow, type TrashEntity,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";

export function TrashTab({ projectId, flash }: { projectId?: string; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [fEntity, setFEntity] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const r = await pcTrashList(projectId);
    setLoading(false);
    if (!r.ok) { setErr(pcErr(r.error)); return; }
    setRows(r.data.items);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter((x) =>
    (!fEntity || x.entity === fEntity) &&
    (!q || (x.title ?? "").toLowerCase().includes(q.toLowerCase()) || (x.reason ?? "").toLowerCase().includes(q.toLowerCase()))
  ), [rows, fEntity, q]);

  async function restore(x: TrashRow) {
    if (busy) return;
    if (!window.confirm(t({ ar: `استعادة «${x.title ?? "عنصر"}»؟`, en: "Restore item?" }))) return;
    setBusy(x.id);
    const r = await pcEntityRestore(x.entity, x.id);
    setBusy(null);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "استُعيد العنصر بنجاح.", en: "Restored." }));
    void load();
  }

  const entities = useMemo(() => Array.from(new Set(rows.map((x) => x.entity))), [rows]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث في المحذوفات…", en: "Search…" })} className={`${inp} flex-1 min-w-[140px] py-1`} />
        <select value={fEntity} onChange={(e) => setFEntity(e.target.value)} className={`${inp} py-1 text-[11px]`} style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "كل الأنواع", en: "All types" })}</option>
          {entities.map((k) => <option key={k} value={k}>{t(ENTITY_LABELS[k as TrashEntity] ?? { ar: k, en: k })}</option>)}
        </select>
        <button onClick={() => void load()} className={`${btnGhost} px-2.5 py-1 text-[11px]`}>{t({ ar: "تحديث", en: "Refresh" })}</button>
      </div>

      {loading && <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {err && <div className={`${card} p-3 text-xs text-red-400`}>{err} <button onClick={() => void load()} className="text-sky-400">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button></div>}
      {!loading && !err && filtered.length === 0 && (
        <p className="text-xs text-stone-500">{t({ ar: "لا عناصر محذوفة.", en: "Trash is empty." })}</p>
      )}

      {filtered.map((x) => (
        <div key={`${x.entity}:${x.id}`} className={`${card} p-3 text-xs`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 rounded bg-stone-800 border border-stone-700 text-[10px] text-stone-300">
              {t(ENTITY_LABELS[x.entity] ?? { ar: x.entity, en: x.entity })}
            </span>
            <span className="text-stone-200 flex-1 min-w-0 truncate">{x.title ?? "—"}</span>
            {!projectId && x.project_name && <span className="text-[10px] text-stone-500 truncate max-w-[140px]">{x.project_name}</span>}
            <button disabled={busy === x.id} onClick={() => void restore(x)} className={`${btnGhost} px-2.5 py-1 text-[10px] text-emerald-400 border-emerald-900/50`}>
              {busy === x.id ? "…" : t({ ar: "استعادة", en: "Restore" })}
            </button>
          </div>
          <div className="mt-1 text-[10px] text-stone-500 flex flex-wrap gap-x-3">
            {x.deleted_at && <span>{t({ ar: "حُذف", en: "Deleted" })}: <span dir="ltr">{fmtDT(x.deleted_at)}</span></span>}
            {x.deleted_by_name && <span>{t({ ar: "بواسطة", en: "By" })}: {x.deleted_by_name}</span>}
            {x.reason && <span className="text-amber-500/80">{t({ ar: "السبب", en: "Reason" })}: {x.reason}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
