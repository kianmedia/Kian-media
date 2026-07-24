"use client";
// ════════════════════════════════════════════════════════════════════════════
// FastCreateWizard — Batch 8C. «مشروع سريع»: خطوتان فقط (النوع ← التفاصيل).
// الحقول الإلزامية فعليًّا في قاعدة البيانات هما الاسم والعميل لا غير، فكل ما
// عداهما مؤجَّل لما بعد الإنشاء. الإنشاء يمرّ حصرًا عبر المسار الرسميّ:
// project_create_from_template (7A) عند اختيار قالب، وإلّا project_core_create_project.
// لا نظام مشاريع/قوالب موازٍ، ولا تغيير لـproject_scope.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { pcCreateProject, pcShootUpsert, pcListClients, pcListStaff, type ClientLite, type StaffLite } from "@/lib/portal/projectCore";
import { projectCreateFromTemplate, tplErr } from "@/lib/portal/projectTemplates";
import { projectTemplatesLibrary, type TemplateLibraryItem } from "@/lib/portal/projectTemplates";
import { projectSetOperatingExperience, QUICK_TYPES, fastlaneErr, type QuickProjectType } from "@/lib/portal/fastlane";

const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-base text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const lbl = "text-[11px] text-stone-500 mb-1 block";
const card = "bg-stone-900 border border-stone-800 rounded-xl";

export default function FastCreateWizard({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [clientsFailed, setClientsFailed] = useState(false);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [templates, setTemplates] = useState<TemplateLibraryItem[]>([]);
  const [tplLoaded, setTplLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ projectId: string; warn: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const mounted = useRef(true);
  const errRef = useRef<HTMLParagraphElement | null>(null);
  const touchedTplRef = useRef(false);   // «البدء من الصفر» اختيار صريح لا نتجاوزه
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // العنصر يُرسم فقط حين يوجد خطأ، فالتركيز المتزامن داخل submit كان لا يفعل شيئًا
  // في أوّل خطأ (errRef.current == null). التأثير يعمل بعد الرسم دائمًا.
  useEffect(() => { if (err) errRef.current?.focus(); }, [err]);
  // Escape يُغلق — نفس سلوك معالج الإنشاء القياسيّ الذي يحلّ هذا محلّه.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busyRef.current) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [f, setF] = useState({
    quick_type: "" as "" | QuickProjectType,
    project_name: "", client_id: "", client_name: "", client_company: "",
    external: false, start_date: "", due_date: "", manager_id: "",
    template_id: "", description: "",
    create_shoot: false, open_after: true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    let on = true;
    void (async () => {
      const [c, s, tp] = await Promise.all([pcListClients(), pcListStaff(), projectTemplatesLibrary({})]);
      if (!on) return;
      if (c.ok) setClients(c.data); else setClientsFailed(true);   // لا نبتلع الفشل
      if (s.ok) setStaff(s.data);
      if (tp.ok) setTemplates(tp.data.templates);
      setTplLoaded(true);
    })();
    return () => { on = false; };
  }, []);

  // اختيار النوع يقترح القالب المطابق والجلسة — اقتراح لا إجبار.
  const pickType = useCallback((k: QuickProjectType) => {
    const meta = QUICK_TYPES.find((x) => x.k === k);
    const tpl = meta?.templateKey ? templates.find((x) => x.template_key === meta.templateKey && x.is_active) : undefined;
    setF((p) => ({ ...p, quick_type: k, template_id: tpl?.id ?? "", create_shoot: !!meta?.suggestsShoot }));
    setStep(2);
  }, [templates]);

  async function submit() {
    if (busy) return;                                   // منع الإرسال المزدوج
    if (!f.project_name.trim()) { setErr(t({ ar: "اسم المشروع إلزامي.", en: "Project name is required." })); return; }
    if (!f.external && !f.client_id) { setErr(t({ ar: "اختر العميل.", en: "Pick a client." })); return; }
    if (f.external && !f.client_name.trim()) { setErr(t({ ar: "اسم العميل إلزامي.", en: "Client name is required." })); return; }
    setBusy(true); busyRef.current = true; setErr("");

    const base: Record<string, unknown> = {
      project_name: f.project_name.trim(),
      client_id: f.external ? undefined : f.client_id,
      client_name: f.external ? f.client_name.trim() : undefined,
      client_company: f.external ? (f.client_company.trim() || undefined) : undefined,
      project_type: f.quick_type || undefined,
      start_date: f.start_date || undefined,
      due_date: f.due_date || undefined,
      manager_id: f.manager_id || undefined,
      description: f.description.trim() || undefined,
    };

    // المكتبة تصل بعد الرسم، فمن اختار نوعه قبل وصولها كان يُنشئ بلا قالب رغم
    // أنّ البطاقة تَعِد بـ«قالب جاهز». نُعيد الحسم هنا بأحدث مكتبة وصلت.
    const suggested = QUICK_TYPES.find((x) => x.k === f.quick_type)?.templateKey;
    const templateId = f.template_id
      || (touchedTplRef.current || !suggested ? "" : templates.find((x) => x.template_key === suggested && x.is_active)?.id || "");
    // المسار الرسميّ: مع قالب ⇒ 7A (إنشاء + تطبيق ذرّي)، وبلا قالب ⇒ الإنشاء المباشر.
    const created = templateId
      ? await projectCreateFromTemplate({ ...base, template_id: templateId, project_name: String(base.project_name) })
      : await pcCreateProject(base);
    if (!mounted.current) return;
    if (!created.ok) {
      setBusy(false); busyRef.current = false;
      setErr(templateId ? tplErr(created.error) : fastlaneErr(created.error));
      return;
    }
    const projectId = created.data.project_id;

    // تجربة «سريع» تفضيل عرض فقط — فشلها لا يُبطل المشروع.
    const expRes = await projectSetOperatingExperience(projectId, "simple");
    // جلسة تصوير أوّلية — باختيار صريح فقط، وعبر RPC الجلسات الرسميّ.
    let shootFailed = false;
    if (f.create_shoot) {
      const sh = await pcShootUpsert(projectId, {
        title: t({ ar: "جلسة التصوير", en: "Shoot session" }),
        session_date: f.start_date || null,
        status: "planned",
      });
      shootFailed = !sh.ok;
    }
    if (!mounted.current) return;
    setBusy(false); busyRef.current = false;

    // المشروع أُنشئ فعلًا: لا ندّعي فشله بسبب خطوة تكميلية، ولا نبتلع فشلها.
    const partial = shootFailed || !expRes.ok
      ? t({
          ar: `تعذّر${shootFailed ? " إنشاء جلسة التصوير (أنشئها من تبويب «جلسات التصوير»)" : ""}${shootFailed && !expRes.ok ? " و" : ""}${!expRes.ok ? " ضبط العرض المبسّط (بدّله من داخل المشروع)" : ""}.`,
          en: `Could not${shootFailed ? " create the shoot session" : ""}${shootFailed && !expRes.ok ? " and" : ""}${!expRes.ok ? " set the simple view" : ""}.`,
        })
      : "";
    setAnnounce(t({ ar: "تم إنشاء المشروع بنجاح.", en: "Project created successfully." }));
    // شاشة نجاح صريحة بدل نموذج معبّأ يغري بإنشاء نسخة ثانية؛ ولا مؤقّت تنقّل
    // يسابق إغلاق المستخدم للنافذة. ملاحظة: onCreated يُحدّث قائمة الأب فقط ولا
    // يُغلق هذه النافذة — لو أغلقها لاختفت الشاشة (وتحذيرُها) قبل أن تُرسم أصلًا.
    setDone({ projectId, warn: partial });
    onCreated?.();
    if (f.open_after && !partial) router.push(`/client-portal/project-core/${projectId}`);
  }

  const tplName = templates.find((x) => x.id === f.template_id)?.name;

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-start justify-center overflow-auto p-2 sm:p-4"
      role="dialog" aria-modal="true" aria-label={t({ ar: "مشروع سريع", en: "Quick project" })}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-lg bg-stone-950 border border-stone-800 rounded-2xl my-2 sm:my-4 flex flex-col" dir="rtl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between p-3 border-b border-stone-800 sticky top-0 bg-stone-950 rounded-t-2xl">
          <div>
            <h3 className="text-sm font-semibold text-white">{t({ ar: "مشروع سريع", en: "Quick project" })}</h3>
            <p className="text-[10px] text-stone-500" aria-current="step">
              {t({ ar: `الخطوة ${step} من ٢ — ${step === 1 ? "النوع" : "التفاصيل"}`, en: `Step ${step} of 2` })}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-stone-400 text-lg leading-none px-1 disabled:opacity-40"
            aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>

        <div className="p-3 space-y-3">
          {done ? (
            <div className="space-y-3 text-center py-2" role="status">
              <p className="text-2xl" aria-hidden="true">✅</p>
              <p className="text-sm text-stone-100">{t({ ar: "تم إنشاء المشروع بنجاح.", en: "Project created." })}</p>
              {done.warn && <p className="text-[11px] text-amber-300">{done.warn}</p>}
              <div className="flex gap-2 justify-center pt-1">
                <button onClick={() => router.push(`/client-portal/project-core/${done.projectId}`)}
                  className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2.5">{t({ ar: "فتح المشروع", en: "Open project" })}</button>
                <button onClick={onClose} className="rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm px-4 py-2.5">{t({ ar: "إغلاق", en: "Close" })}</button>
              </div>
            </div>
          ) : (<>
          {step === 1 && (
            <>
              <p className="text-[11px] text-stone-500">{t({ ar: "اختر نوع المشروع — سنقترح قالبًا مناسبًا ويمكنك تغييره.", en: "Pick a type — we suggest a matching template." })}</p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_TYPES.map((q) => (
                  <button key={q.k} onClick={() => pickType(q.k)}
                    className={`${card} p-3 text-right hover:border-red-700 transition min-h-[56px]`}>
                    <div className="text-sm text-stone-100">{q.ar}</div>
                    <div className="text-[10px] text-stone-500">
                      {q.templateKey ? (tplLoaded ? t({ ar: "قالب جاهز", en: "template" }) : t({ ar: "جارٍ تحميل القالب…", en: "loading template…" })) : t({ ar: "بلا قالب", en: "no template" })}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded bg-stone-800 text-stone-300">{QUICK_TYPES.find((x) => x.k === f.quick_type)?.ar}</span>
                <button onClick={() => setStep(1)} className="text-[10px] text-sky-300 underline">{t({ ar: "تغيير النوع", en: "change" })}</button>
              </div>

              <div>
                <label className={lbl} htmlFor="fq-name">{t({ ar: "اسم المشروع *", en: "Project name *" })}</label>
                <input id="fq-name" value={f.project_name} onChange={(e) => set("project_name", e.target.value)}
                  autoComplete="off" className={inp} aria-describedby={err ? "fq-err" : undefined} />
              </div>

              <label className="flex items-center gap-2 text-[11px] text-stone-400">
                <input type="checkbox" checked={f.external} onChange={(e) => set("external", e.target.checked)} />
                {t({ ar: "عميل خارجي (غير مسجّل)", en: "External client" })}
              </label>
              {f.external ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={lbl} htmlFor="fq-cname">{t({ ar: "اسم العميل *", en: "Client name *" })}</label>
                    <input id="fq-cname" value={f.client_name} onChange={(e) => set("client_name", e.target.value)} className={inp} />
                  </div>
                  <div>
                    <label className={lbl} htmlFor="fq-ccomp">{t({ ar: "الشركة", en: "Company" })}</label>
                    <input id="fq-ccomp" value={f.client_company} onChange={(e) => set("client_company", e.target.value)} className={inp} />
                  </div>
                </div>
              ) : (
                <div>
                  <label className={lbl} htmlFor="fq-client">{t({ ar: "العميل *", en: "Client *" })}</label>
                  <select id="fq-client" value={f.client_id} onChange={(e) => set("client_id", e.target.value)} className={inp}>
                    <option value="">{t({ ar: "— اختر —", en: "— pick —" })}</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.company || c.id.slice(0, 8)}</option>)}
                  </select>
                  {clientsFailed && <p className="text-[10px] text-amber-400 mt-1">{t({ ar: "تعذّر تحميل العملاء — استخدم «عميل خارجي».", en: "Couldn't load clients." })}</p>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl} htmlFor="fq-start">{t({ ar: "تاريخ التنفيذ", en: "Start date" })}</label>
                  <input id="fq-start" type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} className={inp} />
                </div>
                <div>
                  <label className={lbl} htmlFor="fq-due">{t({ ar: "الموعد النهائي", en: "Due date" })}</label>
                  <input id="fq-due" type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} className={inp} />
                </div>
              </div>

              <div>
                <label className={lbl} htmlFor="fq-mgr">{t({ ar: "مدير المشروع", en: "Manager" })}</label>
                <select id="fq-mgr" value={f.manager_id} onChange={(e) => set("manager_id", e.target.value)} className={inp}>
                  <option value="">{t({ ar: "— أنا —", en: "— me —" })}</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.id.slice(0, 8)}</option>)}
                </select>
              </div>

              <div>
                <label className={lbl} htmlFor="fq-tpl">{t({ ar: "القالب (اختياري)", en: "Template (optional)" })}</label>
                <select id="fq-tpl" value={f.template_id} onChange={(e) => { touchedTplRef.current = true; set("template_id", e.target.value); }} className={inp}>
                  <option value="">{t({ ar: "— البدء من الصفر —", en: "— start blank —" })}</option>
                  {templates.filter((x) => x.is_active).map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                </select>
                {tplName && <p className="text-[10px] text-stone-600 mt-0.5">{t({ ar: "ستُنشأ مهام ومخرجات القالب تلقائيًّا.", en: "Template tasks & deliverables will be created." })}</p>}
              </div>

              <div>
                <label className={lbl} htmlFor="fq-desc">{t({ ar: "ملاحظات (اختياري)", en: "Notes (optional)" })}</label>
                <textarea id="fq-desc" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} className={inp} />
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-[11px] text-stone-400">
                  <input type="checkbox" checked={f.create_shoot} onChange={(e) => set("create_shoot", e.target.checked)} />
                  {t({ ar: "إنشاء جلسة تصوير أوّلية", en: "Create an initial shoot session" })}
                </label>
                <label className="flex items-center gap-2 text-[11px] text-stone-400">
                  <input type="checkbox" checked={f.open_after} onChange={(e) => set("open_after", e.target.checked)} />
                  {t({ ar: "فتح المشروع بعد الإنشاء", en: "Open the project after creating" })}
                </label>
              </div>
            </>
          )}

          </>)}
          {err && !done && <p id="fq-err" ref={errRef} tabIndex={-1} role="alert" className="text-[11px] text-red-300">{err}</p>}
          <p className="sr-only" role="status" aria-live="polite">{announce}</p>
        </div>

        {step === 2 && !done && (
          <div className="flex gap-2 justify-end p-3 border-t border-stone-800 sticky bottom-0 bg-stone-950 rounded-b-2xl">
            <button onClick={() => setStep(1)} disabled={busy} className="text-xs text-stone-400 px-3 py-2.5 disabled:opacity-40">{t({ ar: "رجوع", en: "Back" })}</button>
            <button disabled={busy} onClick={() => void submit()}
              className="flex-1 sm:flex-none rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium px-5 py-2.5">
              {busy ? t({ ar: "جارٍ الإنشاء…", en: "Creating…" }) : t({ ar: "إنشاء المشروع", en: "Create project" })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
