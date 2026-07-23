"use client";
// ════════════════════════════════════════════════════════════════════════════
// TemplateLibrary — Batch 7A. «الإعداد السريع»: اختر قالبًا ⇒ يُنشأ المشروع
// ويُطبَّق القالب في نداء واحد ذرّي (project_create_from_template).
// قبل 7A كان المسار: أنشئ مشروعًا ⇒ افتحه ⇒ افتح مدير القوالب ⇒ طبّق.
// القوالب نفسها يديرها ProjectTemplates.tsx القائم — هذه المكتبة لا تستبدله.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { pcListClients, type ClientLite } from "@/lib/portal/projectCore";
import {
  projectTemplatesLibrary, projectCreateFromTemplate, projectTemplateVersionsList,
  projectTemplatePublishVersion, projectTemplateRestoreVersion,
  TEMPLATE_MODULES, tplErr,
  type TemplateLibraryItem, type TemplateLibrary as Library, type TemplateVersion,
} from "@/lib/portal/projectTemplates";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const lbl = "text-[11px] text-stone-500 mb-1 block";

export default function TemplateLibrary({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const { t } = useI18n();
  const [lib, setLib] = useState<Library | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [picked, setPicked] = useState<TemplateLibraryItem | null>(null);
  const [versionsOf, setVersionsOf] = useState<TemplateLibraryItem | null>(null);
  const seq = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        projectTemplatesLibrary({ search: applied || undefined }),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("tpl_timeout")), 20000); }),
      ]);
      if (!mounted.current || my !== seq.current) return;
      if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[template-library]", r.error); setErr(tplErr(r.error)); setPhase("error"); return; }
      setLib(r.data); setPhase("ready");
    } catch (e) {
      if (!mounted.current || my !== seq.current) return;
      setErr(e instanceof Error && e.message === "tpl_timeout" ? t({ ar: "انتهت المهلة.", en: "Timed out." }) : tplErr(String(e))); setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
  }, [applied, t]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-auto p-2 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-3xl bg-stone-950 border border-stone-800 rounded-2xl my-2" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-stone-800 sticky top-0 bg-stone-950 z-10">
          <h3 className="text-sm font-semibold text-stone-100">{t({ ar: "مكتبة القوالب — إعداد سريع", en: "Template library — rapid setup" })}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-lg" aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>

        <div className="p-3 flex gap-2 flex-wrap items-center border-b border-stone-800">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setApplied(search.trim()); }}
            aria-label={t({ ar: "بحث في القوالب", en: "Search templates" })}
            placeholder={t({ ar: "بحث في القوالب…", en: "Search templates…" })}
            className="flex-1 min-w-[160px] bg-stone-900 border border-stone-700 rounded-lg px-3 py-1.5 text-xs text-stone-200" />
          <button onClick={() => setApplied(search.trim())} className="text-[11px] text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5">{t({ ar: "بحث", en: "Search" })}</button>
        </div>

        <div className="p-3 space-y-2">
          {phase === "loading" && <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
          {phase === "error" && (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-red-300">{err}</p>
              <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة", en: "Retry" })}</button>
            </div>
          )}
          {phase === "ready" && (lib?.templates.length ?? 0) === 0 && (
            <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "لا قوالب مطابقة.", en: "No matching templates." })}</p>
          )}
          {phase === "ready" && lib?.templates.map((tp) => (
            <div key={tp.id} className={`${card} p-3`}>
              <div className="flex items-start gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-stone-100" dir="auto">{tp.name}</p>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">v{tp.version}</span>
                    {tp.is_seed && <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-950/40 text-violet-300 border border-violet-900">{t({ ar: "جاهز", en: "Seed" })}</span>}
                    {!tp.is_active && <span className="text-[9px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-500">{t({ ar: "مؤرشف", en: "Archived" })}</span>}
                  </div>
                  {tp.description && <p className="text-[11px] text-stone-500 mt-0.5" dir="auto">{tp.description}</p>}
                  <div className="flex gap-2 flex-wrap text-[10px] text-stone-500 mt-1">
                    <span>{tp.counts.tasks} {t({ ar: "مهمة", en: "tasks" })}</span>
                    <span>{tp.counts.milestones} {t({ ar: "معلَم", en: "milestones" })}</span>
                    <span>{tp.counts.deliverables} {t({ ar: "مخرَج", en: "deliverables" })}</span>
                    <span>{tp.counts.risks} {t({ ar: "مخاطرة", en: "risks" })}</span>
                    {tp.default_duration_days ? <span>· {tp.default_duration_days} {t({ ar: "يومًا", en: "days" })}</span> : null}
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  <button onClick={() => setVersionsOf(tp)} className="text-[11px] rounded-lg px-2.5 py-1 border border-stone-700 text-stone-400">{t({ ar: "الإصدارات", en: "Versions" })}</button>
                  <button onClick={() => setPicked(tp)} className="text-[11px] rounded-lg px-2.5 py-1 border border-emerald-800 text-emerald-300">{t({ ar: "إنشاء مشروع", en: "Create project" })}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {picked && <CreateFromTemplate tpl={picked} onClose={() => setPicked(null)} onCreated={onCreated} />}
      {versionsOf && <VersionsModal tpl={versionsOf} canManage={!!lib?.can_manage} onClose={() => setVersionsOf(null)} onChanged={() => void load()} />}
    </div>
  );
}

// ─── إنشاء مشروع من قالب — نداء واحد ذرّي ───
function CreateFromTemplate({ tpl, onClose, onCreated }: { tpl: TemplateLibraryItem; onClose: () => void; onCreated?: () => void }) {
  const { t } = useI18n();
  const { caps } = usePortal();
  const router = useRouter();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [external, setExternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mods, setMods] = useState<string[]>(
    TEMPLATE_MODULES.filter((m) => ((tpl.counts as unknown as Record<string, number | undefined>)[m.k] ?? 0) > 0).map((m) => m.k));
  const [f, setF] = useState({ project_name: "", client_id: "", client_name: "", client_company: "", start_date: "", description: "" });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const [clientsFailed, setClientsFailed] = useState(false);
  useEffect(() => { let on = true; void (async () => {
    const r = await pcListClients();
    if (!on) return;
    if (!r.ok) { setClientsFailed(true); return; }   // لا نبتلع الفشل: قائمة فارغة بلا سبب تُربك
    setClients(r.data);
  })(); return () => { on = false; }; }, []);

  async function submit() {
    if (busy) return;                                        // منع الإرسال المزدوج
    if (!f.project_name.trim()) { setErr(t({ ar: "اسم المشروع إلزامي.", en: "Project name required." })); return; }
    if (!external && !f.client_id) { setErr(t({ ar: "اختر عميلًا.", en: "Pick a client." })); return; }
    if (external && !f.client_name.trim()) { setErr(t({ ar: "اسم العميل إلزامي.", en: "Client name required." })); return; }
    if (mods.length === 0) { setErr(t({ ar: "اختر وحدة واحدة على الأقلّ.", en: "Pick at least one module." })); return; }
    setBusy(true); setErr("");
    const r = await projectCreateFromTemplate({
      template_id: tpl.id,
      modules: mods.length === TEMPLATE_MODULES.length ? undefined : mods,
      project_name: f.project_name.trim(),
      client_id: external ? undefined : f.client_id,
      client_name: external ? f.client_name.trim() : undefined,
      client_company: external ? (f.client_company.trim() || undefined) : undefined,
      start_date: f.start_date || undefined,
      description: f.description.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) { setErr(tplErr(r.error)); return; }
    onCreated?.();
    router.push(`/client-portal/project-core/${r.data.project_id}`);
  }

  // stopPropagation على الخلفية نفسها: بدونه يصعد النقر إلى خلفية المكتبة فتُغلق الاثنتان.
  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-start justify-center overflow-auto p-3"
      onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="w-full max-w-lg bg-stone-950 border border-stone-800 rounded-2xl my-4 p-4 space-y-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "مشروع جديد من قالب", en: "New project from template" })}</h3>
          <button onClick={onClose} className="text-stone-400 text-sm" aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>
        <p className="text-[11px] text-stone-500">{tpl.name} · v{tpl.version} · {tpl.counts.tasks} {t({ ar: "مهمة", en: "tasks" })}</p>

        <div>
          <label className={lbl} htmlFor="tpl-pname">{t({ ar: "اسم المشروع *", en: "Project name *" })}</label>
          <input id="tpl-pname" value={f.project_name} onChange={(e) => set("project_name", e.target.value)} className={inp} />
        </div>

        <label className="flex items-center gap-2 text-[11px] text-stone-400">
          <input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} />
          {t({ ar: "عميل خارجي (غير مسجّل)", en: "External client" })}
        </label>
        {external ? (
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl} htmlFor="tpl-cname">{t({ ar: "اسم العميل *", en: "Client name *" })}</label>
              <input id="tpl-cname" value={f.client_name} onChange={(e) => set("client_name", e.target.value)} className={inp} /></div>
            <div><label className={lbl} htmlFor="tpl-ccomp">{t({ ar: "الشركة", en: "Company" })}</label>
              <input id="tpl-ccomp" value={f.client_company} onChange={(e) => set("client_company", e.target.value)} className={inp} /></div>
          </div>
        ) : (
          <div>
            <label className={lbl} htmlFor="tpl-client">{t({ ar: "العميل *", en: "Client *" })}</label>
            <select id="tpl-client" value={f.client_id} onChange={(e) => set("client_id", e.target.value)} className={inp}>
              <option value="">{t({ ar: "— اختر —", en: "— pick —" })}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.company || c.id.slice(0, 8)}</option>)}
            </select>
            {clientsFailed && <p className="text-[10px] text-amber-400 mt-1">{t({ ar: "تعذّر تحميل العملاء — استخدم «عميل خارجي».", en: "Couldn't load clients — use the external-client option." })}</p>}
          </div>
        )}

        <div>
          <label className={lbl} htmlFor="tpl-start">{t({ ar: "تاريخ البداية (أساس التواريخ النسبية)", en: "Start date (relative-date anchor)" })}</label>
          <input id="tpl-start" type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} className={inp} />
          {/* المحرّك يسقط إلى start_date المشروع ثم إلى تاريخ اليوم — لا يترك العناصر بلا تواريخ */}
          <p className="text-[10px] text-stone-600 mt-0.5">{t({ ar: "بدونه يُستخدم تاريخ بداية المشروع، وإلّا تاريخ اليوم.", en: "Defaults to the project start date, otherwise today." })}</p>
        </div>

        <fieldset>
          <legend className={lbl}>{t({ ar: "الوحدات المطبَّقة", en: "Modules to apply" })}</legend>
          <div className="flex flex-wrap gap-2">
            {/* وحدة لا يحتويها القالب تُعطَّل بدل خيار بلا أثر — العدّ من المكتبة نفسها */}
            {TEMPLATE_MODULES.map((m) => {
              const n = (tpl.counts as unknown as Record<string, number | undefined>)[m.k] ?? 0;
              const off = n === 0;
              return (
                <label key={m.k} className={`flex items-center gap-1 text-[11px] ${off ? "text-stone-600" : "text-stone-400"}`}>
                  <input type="checkbox" disabled={off} checked={!off && mods.includes(m.k)}
                    onChange={(e) => setMods((p) => e.target.checked ? [...p, m.k] : p.filter((x) => x !== m.k))} />
                  {t({ ar: m.ar, en: m.en })} <span className="text-stone-600">({n})</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {caps.isAdminArea && (
          <div>
            <label className={lbl} htmlFor="tpl-desc">{t({ ar: "الوصف", en: "Description" })}</label>
            <textarea id="tpl-desc" value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} className={inp} />
          </div>
        )}

        {err && <p className="text-[11px] text-red-300">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs text-stone-400 px-3 py-2">{t({ ar: "إلغاء", en: "Cancel" })}</button>
          <button disabled={busy} onClick={() => void submit()}
            className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2">
            {busy ? t({ ar: "جارٍ الإنشاء…", en: "Creating…" }) : t({ ar: "إنشاء وتطبيق القالب", en: "Create & apply" })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── الإصدارات — نشر/استعادة (الاستعادة تُكتب كإصدار جديد، لا حذف) ───
function VersionsModal({ tpl, canManage, onClose, onChanged }:
  { tpl: TemplateLibraryItem; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<TemplateVersion[] | null>(null);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");          // منفصل عن الخطأ: نجاح أخضر وفشل أحمر
  const [curVer, setCurVer] = useState(tpl.version);  // الرقم الحيّ بعد النشر/الاستعادة (لا prop قديم)
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    const r = await projectTemplateVersionsList(tpl.id);
    if (!mounted.current) return;
    if (!r.ok) { setErr(tplErr(r.error)); setRows([]); return; }
    setErr(""); setRows(r.data.versions ?? []);
  }, [tpl.id]);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    if (busy) return;
    setBusy(true); setErr(""); setOkMsg("");
    const r = await fn(); setBusy(false);
    if (!r.ok) { setErr(tplErr(r.error ?? "")); return; }
    setOkMsg(msg);
    const v = r as { data?: { next_version?: number; new_version?: number } };
    const nv = v.data?.next_version ?? v.data?.new_version;
    if (typeof nv === "number") setCurVer(nv);      // العنوان يعكس الحالة بعد العملية
    await load(); onChanged();
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-start justify-center overflow-auto p-3"
      onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="w-full max-w-lg bg-stone-950 border border-stone-800 rounded-2xl my-4 p-4 space-y-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "إصدارات القالب", en: "Template versions" })}</h3>
          <button onClick={onClose} className="text-stone-400 text-sm" aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>
        {/* version عدّاد المسودّة القادمة لا رقم إصدار منشور — التسمية تقول ذلك */}
        <p className="text-[11px] text-stone-500">{tpl.name} — {t({ ar: "المسودّة الجارية", en: "current draft" })}: v{curVer}</p>
        {err && <p className="text-[11px] text-red-300">{err}</p>}
        {okMsg && <p className="text-[11px] text-emerald-300">{okMsg}</p>}

        {canManage && (
          <button disabled={busy} onClick={() => { const n = window.prompt(t({ ar: "ملاحظة الإصدار (اختياري — إلغاء يوقف):", en: "Version note (optional — cancel aborts):" })); if (n === null) return; void act(() => projectTemplatePublishVersion(tpl.id, n || undefined), t({ ar: "نُشر الإصدار.", en: "Version published." })); }}
            className="text-[11px] rounded-lg px-3 py-1.5 border border-emerald-800 text-emerald-300 disabled:opacity-40">
            {t({ ar: "نشر الإصدار الحالي", en: "Publish current version" })}
          </button>
        )}

        {rows === null && <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
        {rows?.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا إصدارات منشورة بعد.", en: "No published versions yet." })}</p>}
        <div className="space-y-1">
          {(rows ?? []).map((v) => (
            <div key={v.id} className="flex items-center gap-2 text-[11px] border border-stone-800 rounded-lg px-2 py-1.5">
              <span className="text-stone-200">v{v.version}</span>
              <span className="text-stone-600 truncate flex-1" dir="auto">{v.note || "—"}</span>
              <span className="text-stone-600" dir="ltr">{v.created_at.slice(0, 10)}</span>
              <span className="text-stone-500">{v.counts.tasks}/{v.counts.milestones}/{v.counts.deliverables}</span>
              {canManage && (
                <button disabled={busy} onClick={() => void act(() => projectTemplateRestoreVersion(tpl.id, v.version), t({ ar: "استُعيد الإصدار كإصدار جديد.", en: "Restored as a new version." }))}
                  className="text-[10px] rounded px-2 py-0.5 border border-violet-800 text-violet-300 disabled:opacity-40">
                  {t({ ar: "استعادة", en: "Restore" })}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
