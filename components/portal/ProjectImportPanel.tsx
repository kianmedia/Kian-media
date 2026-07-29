"use client";
// ════════════════════════════════════════════════════════════════════════════
// ProjectImportPanel — شاشة الاستيراد الجماعيّ من ملف (xlsx / csv).
//
// هذه هي **واجهة المشغّل** لمحرّك الاستيراد العامّ: بلا هذه الشاشة تبقى مسارات
// الـAPI غير قابلة للنقر، والميزة التي لا يستطيع أحد استعمالها ليست ميزة.
//
// مبادئ ثابتة في هذا الملف:
//   • لا اسم عميل، ولا عدد أسطر، ولا عدد مراحل مكتوب في الشيفرة. ملفّ التعيين
//     (profile) بيانات تصل من /api/portal/import/profiles وتُختار من قائمة.
//   • ثلاث خطوات صريحة: معاينة (لا تكتب) ← تشغيل تجريبي (لا يكتب) ← تنفيذ.
//   • قبل تطبيق ملف الترحيل تظهر حالة «الترحيل معلّق» مسمّاة: المعاينة تعمل
//     (تحليل نصّيّ صرف) والتنفيذ يُرفض برسالة واضحة — لا شاشة فارغة ولا انهيار.
//   • النتيجة تُعرض سطرًا سطرًا. النجاح الجزئيّ يُقال كما هو: «نجح ٦٠ وفشل ١٩»
//     مع قائمة الفاشل — لا يُخفى فشل خلف رسالة نجاح.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { getValidSession } from "@/lib/portalAuth";
import type {
  BackendState,
  ExecuteResult,
  ImportPlan,
  ImportPlanCounts,
  ImportWarning,
  InvalidRow,
  ProfileSummary,
  RowOutcome,
} from "@/lib/portal/import";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * فوق هذا العدد يُطلب تأكيد صريح مكتوب بدل مجرّد علامة تحقّق. عتبة عامّة تخصّ
 * «كم سجلًّا سيُنشأ»، لا تعرف مشروعًا بعينه ولا ملفًّا بعينه.
 */
const LARGE_IMPORT_ROWS = 25;
/** حدّ العرض فقط — الأسطر غير الناجحة تُعرض كاملةً مهما بلغت. */
const MAX_LISTED_OK_ROWS = 40;

// ─── أشكال ردود المسارات (كما تُرسلها الطرق حرفيًّا) ───────────────────────
interface ProfilesBody {
  ok?: boolean;
  profiles?: ProfileSummary[];
  profilesNote?: string | null;
  backend?: BackendState;
  templatePath?: string;
  error?: string;
}
interface PreviewBody {
  ok?: boolean;
  plan?: ImportPlan;
  rowsTruncatedInResponse?: boolean;
  totalRows?: number;
  profile?: { id: string; label: string; version: number; levels: { key: string; label: string }[] };
  backend?: BackendState;
  canExecute?: boolean;
  lookupReason?: string | null;
  error?: string;
}
interface ExecuteBody {
  ok?: boolean;
  result?: ExecuteResult;
  counts?: ImportPlanCounts;
  projectKey?: string;
  invalidRows?: InvalidRow[];
  warnings?: ImportWarning[];
  error?: string;
}

const SESSION_AR = "الجلسة غير صالحة. سجّل الدخول ثم أعد المحاولة.";

/** نداء مُوقَّع بجلسة المستخدم نفسه — لا صلاحيات إضافية، ومحاولة تجديد واحدة عند 401. */
async function importFetch<T>(url: string, init: RequestInit): Promise<{ status: number; body: T | null; transport: string | null }> {
  let s = await getValidSession();
  if (!s) return { status: 401, body: null, transport: SESSION_AR };
  const send = (token: string) =>
    fetch(url, { ...init, cache: "no-store", headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } });
  let res: Response;
  try {
    res = await send(s.access_token);
    if (res.status === 401) {
      s = await getValidSession();
      if (s) res = await send(s.access_token);
    }
  } catch (e) {
    return { status: 0, body: null, transport: `تعذّر الاتصال بالخادم: ${String(e)}` };
  }
  let body: T | null = null;
  try {
    body = (await res.json()) as T;
  } catch {
    body = null;
  }
  if (body === null) return { status: res.status, body: null, transport: `ردّ غير مفهوم من الخادم (HTTP ${res.status}).` };
  return { status: res.status, body, transport: null };
}

export default function ProjectImportPanel({
  projectId,
  canManage,
  flash,
}: {
  projectId: string;
  canManage: boolean;
  flash?: (m: string) => void;
}) {
  const { t } = useI18n();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ── الإقلاع: ملفّات التعيين + حالة قاعدة البيانات ──
  const [boot, setBoot] = useState<"loading" | "ready" | "error">("loading");
  const [bootErr, setBootErr] = useState("");
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profilesNote, setProfilesNote] = useState<string | null>(null);
  const [backend, setBackend] = useState<BackendState | null>(null);
  const [templatePath, setTemplatePath] = useState<string | null>(null);
  const [profileId, setProfileId] = useState("");

  const loadProfiles = useCallback(async () => {
    setBoot("loading");
    setBootErr("");
    const r = await importFetch<ProfilesBody>("/api/portal/import/profiles", { method: "GET" });
    if (!alive.current) return;
    if (r.transport || !r.body || r.body.ok === false) {
      setBootErr(r.transport ?? r.body?.error ?? `تعذّر تحميل إعدادات الاستيراد (HTTP ${r.status}).`);
      setBoot("error");
      return;
    }
    const list = r.body.profiles ?? [];
    setProfiles(list);
    setProfilesNote(r.body.profilesNote ?? null);
    setBackend(r.body.backend ?? null);
    setTemplatePath(r.body.templatePath ?? null);
    setProfileId((cur) => (cur && list.some((p) => p.id === cur) ? cur : (list[0]?.id ?? "")));
    setBoot("ready");
  }, []);
  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  // ── مدخلات المشغّل ──
  const [file, setFile] = useState<File | null>(null);
  const [batchLabel, setBatchLabel] = useState("");
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [ack, setAck] = useState(false);
  const [confirmCount, setConfirmCount] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ── نتائج الخطوات ──
  const [busy, setBusy] = useState<null | "preview" | "dry_run" | "commit">(null);
  const [preview, setPreview] = useState<PreviewBody | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const [exec, setExec] = useState<ExecuteBody | null>(null);
  const [execErr, setExecErr] = useState("");
  const [execMode, setExecMode] = useState<"dry_run" | "commit" | null>(null);
  const [showOkRows, setShowOkRows] = useState(false);

  /** أي تغيير في المدخلات يُبطل المعاينة والتأكيد: لا تنفيذ على خطّة قديمة. */
  const resetDownstream = useCallback(() => {
    setPreview(null);
    setPreviewErr("");
    setExec(null);
    setExecErr("");
    setExecMode(null);
    setAck(false);
    setConfirmCount("");
    setSkipInvalid(false);
    setShowOkRows(false);
  }, []);

  function pickFile(f: File | null) {
    setFile(f);
    resetDownstream();
  }

  const plan = preview?.plan ?? null;
  const counts = plan?.counts ?? null;
  const levels = preview?.profile?.levels ?? profiles.find((p) => p.id === profileId)?.levels ?? [];
  const migrationPending = backend != null && backend.available === false;
  const canExecuteHere = preview?.canExecute === true && backend?.available === true;

  const toCreate = counts ? counts.deliverablesToCreate : 0;
  const totalCreates = counts
    ? counts.parentProjectsToCreate + counts.stagesToCreate + counts.subgroupsToCreate + counts.deliverablesToCreate
    : 0;
  const isLarge = totalCreates >= LARGE_IMPORT_ROWS;
  const invalidCount = plan?.invalidRows.length ?? 0;
  const needsSkipAck = invalidCount > 0;
  // «سبق استيراد هذا الملف».
  // كان الشرط `duplicate > 0` فقط، وهذا لا يتحقّق أبدًا عند إعادة رفع الملف
  // نفسه: `duplicate` تعني «تكرار داخل الملف»، أمّا إعادة الاستيراد فتُنتج أسطرًا
  // «دون تغيير» (unchanged) لأنّها طابقت سجلات موجودة. النتيجة أنّ الرسالة
  // المخصّصة لإعادة الاستيراد كانت شيفرة ميّتة في الحالة التي كُتبت من أجلها
  // بالضبط. الشرط الآن: لا إنشاء ولا تحديث، مع وجود ما طابَق فعلًا.
  const alreadyImported =
    !!counts &&
    counts.deliverablesToCreate === 0 &&
    counts.deliverablesToUpdate === 0 &&
    (counts.deliverablesUnchanged > 0 || counts.duplicate > 0);
  const nothingNew = !!counts && counts.deliverablesToCreate === 0 && counts.deliverablesToUpdate === 0;

  const confirmSatisfied = isLarge ? confirmCount.trim() === String(toCreate) : ack;
  const commitBlocked =
    !plan ||
    plan.ok === false ||
    !canExecuteHere ||
    !confirmSatisfied ||
    (needsSkipAck && !skipInvalid) ||
    busy !== null ||
    !canManage;

  // ── الاستدعاءات ──
  function formOf(mode: "dry_run" | "commit" | null): FormData | null {
    if (!file) return null;
    const fd = new FormData();
    fd.append("file", file);
    if (profileId) fd.append("profileId", profileId);
    // المفتاح الخارجيّ يُشتقّ من projectId فقط — لا من اسم المشروع: إعادة تسمية
    // المشروع يجب ألّا تغيّر المفاتيح وإلّا تكرّر استيرادٌ سابق نفسه.
    fd.append("projectId", projectId);
    if (batchLabel.trim()) fd.append("batchLabel", batchLabel.trim());
    if (mode) fd.append("mode", mode);
    if (skipInvalid) fd.append("skipInvalidRows", "true");
    return fd;
  }

  async function runPreview() {
    const fd = formOf(null);
    if (!fd || busy) return;
    setBusy("preview");
    setPreviewErr("");
    setExec(null);
    setExecErr("");
    setExecMode(null);
    const r = await importFetch<PreviewBody>("/api/portal/import/preview", { method: "POST", body: fd });
    if (!alive.current) return;
    setBusy(null);
    if (r.transport) {
      setPreviewErr(r.transport);
      return;
    }
    // ok=false مع خطّة موجودة يعني «ملف غير صالح» لا «لا نتيجة»: تُعرض الخطّة
    // كاملةً حتى يستطيع المالك تصحيح الجدول من هذه الشاشة.
    if (r.body?.plan) {
      setPreview(r.body);
      if (r.body.backend) setBackend(r.body.backend);
      return;
    }
    setPreviewErr(r.body?.error ?? `تعذّرت المعاينة (HTTP ${r.status}).`);
  }

  async function runExecute(mode: "dry_run" | "commit") {
    if (busy) return;
    if (!plan) {
      setExecErr("شغّل المعاينة أوّلًا — لا تنفيذ بلا خطّة معروضة.");
      return;
    }
    if (!canManage) {
      setExecErr("لا تملك صلاحية تنفيذ الاستيراد.");
      return;
    }
    // حارس صريح: حتى لو وصل النقر بطريقة ما، الرفض مذكور بسببه لا صامتًا.
    if (!backend?.available) {
      setExecErr(backend?.reason ?? "قاعدة البيانات لم تُحدَّث بعد لدعم الاستيراد — التنفيذ معطّل حتى تشغيل ملف الترحيل.");
      return;
    }
    if (mode === "commit" && !confirmSatisfied) {
      setExecErr("التنفيذ يحتاج تأكيدًا صريحًا بعدد السجلات التي ستُنشأ.");
      return;
    }
    const fd = formOf(mode);
    if (!fd) return;
    setBusy(mode);
    setExecErr("");
    setExec(null);
    setShowOkRows(false);
    const r = await importFetch<ExecuteBody>("/api/portal/import/execute", { method: "POST", body: fd });
    if (!alive.current) return;
    setBusy(null);
    setExecMode(mode);
    if (r.transport) {
      setExecErr(r.transport);
      return;
    }
    if (r.body?.result) {
      setExec(r.body);
      if (mode === "commit") {
        flash?.(r.body.result.message);
        // بعد كتابة فعلية تصير المعاينة قديمة: يُعاد التأكيد من الصفر.
        setAck(false);
        setConfirmCount("");
      }
      return;
    }
    setExecErr(r.body?.error ?? `تعذّر التنفيذ (HTTP ${r.status}).`);
  }

  // ── العرض ──
  if (boot === "loading") {
    return (
      <div className={`${card} p-8 text-center text-xs text-stone-500`} dir="rtl">
        {t({ ar: "جارٍ التحميل…", en: "Loading…" })}
      </div>
    );
  }
  if (boot === "error") {
    return (
      <div className={`${card} p-8 text-center space-y-2`} dir="rtl">
        <p className="text-sm text-red-300">{bootErr}</p>
        <button type="button" onClick={() => void loadProfiles()} className={`${btnGhost} px-4 py-2 text-xs`}>
          {t({ ar: "إعادة المحاولة", en: "Retry" })}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3" dir="rtl">
      {/* حالة قاعدة البيانات — «الترحيل معلّق» مسمّاة، لا خطأ أحمر مبهم */}
      {migrationPending && (
        <div className={`${card} p-3 space-y-1 border-amber-900/70`}>
          <p className="text-xs font-semibold text-amber-200">
            <span className="inline-block rounded px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/30">
              {t({ ar: "الترحيل معلّق", en: "Migration pending" })}
            </span>
          </p>
          <p className="text-[11px] leading-relaxed text-stone-400">{backend?.reason}</p>
          <p className="text-[11px] leading-relaxed text-stone-500">
            {t({
              ar: "المعاينة تعمل كاملةً الآن (تحليل الملف يحدث دون قاعدة البيانات)، أمّا «تشغيل تجريبي» و«تنفيذ الاستيراد» فمعطّلان حتى تشغيل ملف الترحيل.",
              en: "Preview works now (pure parsing); dry run and import stay disabled until the migration is applied.",
            })}
          </p>
        </div>
      )}
      {backend?.available && (
        <p className="text-[10px] text-emerald-400/80">
          {t({ ar: "قاعدة البيانات جاهزة للاستيراد.", en: "Import backend is ready." })}
          {backend.protocol ? ` (${backend.protocol})` : ""}
        </p>
      )}

      {/* ① الإعداد */}
      <section className={`${card} p-3 sm:p-4 space-y-3`}>
        <h3 className="text-sm font-semibold text-white">{t({ ar: "استيراد من ملف", en: "Import from a file" })}</h3>
        <p className="text-[11px] text-stone-500 leading-relaxed">
          {t({
            ar: "ارفع ملف Excel (‎.xlsx) أو CSV، اختر ملفّ التعيين المناسب، ثم عايِن قبل أي كتابة. المعاينة والتشغيل التجريبي لا يكتبان شيئًا إطلاقًا.",
            en: "Upload .xlsx or .csv, pick a mapping profile, then preview. Preview and dry run never write.",
          })}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1 min-w-0">
            <span className="text-[11px] text-stone-500 block">{t({ ar: "الملف", en: "File" })}</span>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              className="block w-full text-[11px] text-stone-300 file:ml-2 file:rounded-lg file:border-0 file:bg-stone-700 file:px-3 file:py-1.5 file:text-xs file:text-stone-100"
            />
          </label>
          <label className="space-y-1 min-w-0">
            <span className="text-[11px] text-stone-500 block">{t({ ar: "ملفّ التعيين", en: "Mapping profile" })}</span>
            <select
              value={profileId}
              onChange={(e) => {
                setProfileId(e.target.value);
                resetDownstream();
              }}
              className={`${inp} w-full`}
              style={{ colorScheme: "dark" }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} {p.builtIn ? "•" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 min-w-0 sm:col-span-2">
            <span className="text-[11px] text-stone-500 block">{t({ ar: "وسم الدفعة (اختياري)", en: "Batch label (optional)" })}</span>
            <input
              value={batchLabel}
              onChange={(e) => setBatchLabel(e.target.value)}
              placeholder={file?.name ?? t({ ar: "اسم الملف", en: "File name" })}
              className={`${inp} w-full`}
            />
          </label>
        </div>

        {levels.length > 0 && (
          <p className="text-[10px] text-stone-600">
            {t({ ar: "مستويات هذا التعيين:", en: "Levels:" })} {levels.map((l) => l.label).join(" ← ")}
          </p>
        )}
        {profilesNote && <p className="text-[10px] text-amber-400/80">{profilesNote}</p>}
        {templatePath && (
          <p className="text-[10px] text-stone-600">
            {t({ ar: "قالب أعمدة جاهز داخل المستودع:", en: "Column template in the repo:" })} <span dir="ltr">{templatePath.replace(/^\//, "")}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" disabled={!file || busy !== null} onClick={() => void runPreview()} className={`${btnRed} px-4 py-2`}>
            {busy === "preview" ? t({ ar: "جارٍ التحليل…", en: "Analysing…" }) : `١ · ${t({ ar: "معاينة (لا تكتب شيئًا)", en: "Preview (no writes)" })}`}
          </button>
          {(preview || previewErr || exec || execErr) && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                pickFile(null);
                setBatchLabel("");
                if (fileRef.current) fileRef.current.value = "";
              }}
              className={`${btnGhost} px-3 py-2 text-xs`}
            >
              {t({ ar: "بدء من جديد", en: "Start over" })}
            </button>
          )}
        </div>
        {previewErr && <p className="text-[11px] text-red-300 leading-relaxed">{previewErr}</p>}
      </section>

      {/* ② نتيجة المعاينة */}
      {plan && counts && (
        <section className={`${card} p-3 sm:p-4 space-y-3`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white">{t({ ar: "نتيجة المعاينة", en: "Preview result" })}</h3>
            <span className="text-[10px] text-stone-600" dir="ltr">
              {plan.fileName} · {plan.sheetName} · {preview?.profile?.id ?? plan.profileId}
            </span>
          </div>

          {plan.ok === false && (
            <p className="text-[11px] leading-relaxed rounded-lg border border-red-900 bg-red-950/40 text-red-200 px-3 py-2">
              {plan.fatalMessage ?? t({ ar: "الملف غير صالح للاستيراد كما هو.", en: "The file cannot be imported as-is." })}
            </p>
          )}

          {alreadyImported && (
            <p className="text-[11px] leading-relaxed rounded-lg border border-sky-900 bg-sky-950/30 text-sky-200 px-3 py-2">
              {t({
                ar: "سبق استيراد هذا الملف: كل الأسطر موجودة بالفعل ولن يُنشأ أي سجل جديد. التنفيذ الآن لن يضيف شيئًا ولن يكرّر ما استُورد.",
                en: "This file was already imported: nothing new will be created.",
              })}
            </p>
          )}
          {!alreadyImported && nothingNew && (
            <p className="text-[11px] leading-relaxed rounded-lg border border-sky-900 bg-sky-950/30 text-sky-200 px-3 py-2">
              {t({ ar: "لا جديد في هذا الملف: لا إنشاء ولا تحديث.", en: "Nothing new: no creates, no updates." })}
            </p>
          )}
          {plan.existingLookupAvailable === false && (
            <p className="text-[11px] leading-relaxed rounded-lg border border-amber-900 bg-amber-950/30 text-amber-200 px-3 py-2">
              {preview?.lookupReason ??
                t({
                  ar: "تعذّرت مطابقة السجلات السابقة، فكل الأسطر تظهر «جديدة». لا تعتمد على أرقام الإنشاء قبل توفّر المطابقة.",
                  en: "Existing-record matching is unavailable, so every row reads as new.",
                })}
            </p>
          )}

          {/* الأرقام — أسماء المستويات من ملفّ التعيين لا من الشيفرة */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi label={t({ ar: "مشاريع أب ستُنشأ", en: "Parent projects" })} value={counts.parentProjectsToCreate} />
            <Kpi label={`${levels[0]?.label ?? t({ ar: "المستوى الأول", en: "Level 1" })} ${t({ ar: "ستُنشأ", en: "to create" })}`} value={counts.stagesToCreate} />
            <Kpi label={`${levels[1]?.label ?? t({ ar: "المستوى الثاني", en: "Level 2" })} ${t({ ar: "ستُنشأ", en: "to create" })}`} value={counts.subgroupsToCreate} />
            <Kpi label={t({ ar: "مخرجات ستُنشأ", en: "Deliverables to create" })} value={counts.deliverablesToCreate} tone="ok" />
            <Kpi label={t({ ar: "مقبولة", en: "Accepted" })} value={counts.accepted} />
            <Kpi label={t({ ar: "متجاهَلة", en: "Skipped" })} value={counts.skipped} tone={counts.skipped ? "warn" : "neutral"} />
            <Kpi label={t({ ar: "مكرّرة", en: "Duplicate" })} value={counts.duplicate} tone={counts.duplicate ? "warn" : "neutral"} />
            <Kpi label={t({ ar: "غير صالحة", en: "Invalid" })} value={counts.invalid} tone={counts.invalid ? "danger" : "neutral"} />
          </div>
          <p className="text-[10px] text-stone-600">
            {t({ ar: "تحديث", en: "Updates" })}: {counts.deliverablesToUpdate} · {t({ ar: "دون تغيير", en: "Unchanged" })}: {counts.deliverablesUnchanged}
            {preview?.rowsTruncatedInResponse ? ` · ${t({ ar: "عُرض جزء من الأسطر فقط؛ التنفيذ يعالج", en: "Rows shown are partial; execution covers" })} ${preview.totalRows}` : ""}
          </p>

          {/* الأسطر غير الصالحة — برقم السطر والسبب، حتى يُصحَّح الجدول من هنا */}
          {invalidCount > 0 && (
            <RowList
              title={`${t({ ar: "أسطر غير صالحة", en: "Invalid rows" })} (${invalidCount})`}
              tone="danger"
              hint={t({ ar: "صحّح هذه الأسطر في الملف ثم أعد الرفع، أو أكّد تجاهلها صراحةً قبل التنفيذ.", en: "Fix these rows, or explicitly acknowledge skipping them." })}
              items={plan.invalidRows.map((r) => ({
                key: `${r.rowNumber}-${r.code}-${r.field ?? ""}`,
                row: r.rowNumber,
                text: `${r.message}${r.field ? ` — ${t({ ar: "الحقل", en: "field" })}: ${r.field}` : ""}${r.value ? ` — «${r.value}»` : ""}`,
              }))}
            />
          )}
          {plan.duplicateRows.length > 0 && (
            <RowList
              title={`${t({ ar: "أسطر مكرّرة داخل الملف", en: "Duplicate rows in the file" })} (${plan.duplicateRows.length})`}
              tone="warn"
              items={plan.duplicateRows.map((r) => ({ key: `${r.rowNumber}-${r.external_key}`, row: r.rowNumber, text: r.reason }))}
            />
          )}
          {plan.skippedRows.length > 0 && (
            <RowList
              title={`${t({ ar: "أسطر متجاهَلة", en: "Skipped rows" })} (${plan.skippedRows.length})`}
              tone="warn"
              items={plan.skippedRows.map((r) => ({ key: `${r.rowNumber}-s`, row: r.rowNumber, text: r.reason }))}
            />
          )}
          {plan.warnings.length > 0 && (
            <RowList
              title={`${t({ ar: "تنبيهات", en: "Warnings" })} (${plan.warnings.length})`}
              tone="warn"
              items={plan.warnings.map((w, i) => ({
                key: `w-${i}`,
                row: w.rowNumber ?? null,
                text: `${w.message}${w.column ? ` — ${w.column}` : ""}${w.value ? ` — «${w.value}»` : ""}`,
              }))}
            />
          )}
          {plan.unmappedColumns.length > 0 && (
            <p className="text-[10px] text-stone-600" dir="auto">
              {t({ ar: "أعمدة لم يطالبها أي حقل:", en: "Unmapped columns:" })} {plan.unmappedColumns.join(" ، ")}
            </p>
          )}
        </section>
      )}

      {/* ③ التشغيل التجريبي والتنفيذ */}
      {plan && counts && (
        <section className={`${card} p-3 sm:p-4 space-y-3`}>
          <h3 className="text-sm font-semibold text-white">{t({ ar: "التنفيذ", en: "Execution" })}</h3>

          {!canManage && (
            <p className="text-[11px] text-amber-300">{t({ ar: "لا تملك صلاحية تنفيذ الاستيراد — المعاينة فقط.", en: "You may preview only." })}</p>
          )}

          {needsSkipAck && (
            <label className="flex items-start gap-2 text-[11px] text-stone-300">
              <input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} className="mt-0.5" />
              <span>
                {t({ ar: "أؤكّد تجاهل", en: "Skip" })} {invalidCount} {t({ ar: "سطرًا غير صالح ومتابعة الباقي (لن تُستورَد هذه الأسطر).", en: "invalid rows and continue (they will not be imported)." })}
              </span>
            </label>
          )}

          {/* خطوة ٢ — تشغيل تجريبي: تحقّق كامل بلا كتابة */}
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              disabled={busy !== null || !canExecuteHere || !canManage || plan.ok === false || (needsSkipAck && !skipInvalid)}
              onClick={() => void runExecute("dry_run")}
              className={`${btnGhost} px-4 py-2 text-sky-300 border-sky-900`}
            >
              {busy === "dry_run" ? t({ ar: "جارٍ الفحص…", en: "Checking…" }) : `٢ · ${t({ ar: "تشغيل تجريبي (تحقّق كامل، صفر كتابة)", en: "Dry run (full validation, zero writes)" })}`}
            </button>
            <span className="text-[10px] text-stone-600">{t({ ar: "التشغيل التجريبي يمرّ بقاعدة البيانات لكنه لا يكتب أي سجل.", en: "The dry run reaches the database but writes nothing." })}</span>
          </div>

          {/* خطوة ٣ — التنفيذ: معطّل حتى تُشغَّل معاينة، وبتأكيد صريح بالعدد */}
          <div className="border-t border-stone-800 pt-3 space-y-2">
            {isLarge ? (
              <label className="block space-y-1">
                <span className="text-[11px] text-amber-200 leading-relaxed block">
                  {t({ ar: "استيراد كبير: سيُنشأ", en: "Large import: this will create" })} <b dir="ltr">{toCreate}</b> {t({ ar: "مخرَجًا", en: "deliverables" })}
                  {totalCreates !== toCreate ? ` ${t({ ar: "إضافةً إلى", en: "plus" })} ${totalCreates - toCreate} ${t({ ar: "سجلًّا هيكليًّا", en: "structural records" })}` : ""}.{" "}
                  {t({ ar: "اكتب العدد", en: "Type the number" })} <b dir="ltr">{toCreate}</b> {t({ ar: "للتأكيد.", en: "to confirm." })}
                </span>
                <input
                  value={confirmCount}
                  onChange={(e) => setConfirmCount(e.target.value)}
                  inputMode="numeric"
                  placeholder={String(toCreate)}
                  className={`${inp} w-32`}
                  dir="ltr"
                />
              </label>
            ) : (
              <label className="flex items-start gap-2 text-[11px] text-stone-300">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
                <span>
                  {t({ ar: "أؤكّد إنشاء", en: "I confirm creating" })} <b dir="ltr">{toCreate}</b> {t({ ar: "مخرَجًا", en: "deliverables" })}
                  {counts.deliverablesToUpdate ? ` ${t({ ar: "وتحديث", en: "and updating" })} ${counts.deliverablesToUpdate}` : ""} {t({ ar: "في هذا المشروع.", en: "in this project." })}
                </span>
              </label>
            )}
            <button type="button" disabled={commitBlocked} onClick={() => void runExecute("commit")} className={`${btnRed} px-4 py-2`}>
              {busy === "commit" ? t({ ar: "جارٍ التنفيذ…", en: "Importing…" }) : `٣ · ${t({ ar: "تنفيذ الاستيراد", en: "Confirm import" })}`}
            </button>
            {!canExecuteHere && (
              <p className="text-[11px] text-amber-300 leading-relaxed">
                {backend?.reason ??
                  t({ ar: "التنفيذ غير متاح على هذه الخطّة — راجع الرسائل أعلاه.", en: "Execution is not available for this plan — see the messages above." })}
              </p>
            )}
          </div>

          {execErr && <p className="text-[11px] text-red-300 leading-relaxed">{execErr}</p>}
        </section>
      )}

      {/* ④ النتيجة سطرًا سطرًا */}
      {exec?.result && (
        <ExecReport result={exec.result} mode={execMode} showOkRows={showOkRows} onToggleOk={() => setShowOkRows((v) => !v)} />
      )}
    </div>
  );
}

// ─── ذرّات عرض محلّية ───────────────────────────────────────────────────────

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const color = tone === "danger" ? "text-red-300" : tone === "warn" ? "text-amber-300" : tone === "ok" ? "text-emerald-300" : "text-stone-100";
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950 p-2 text-center min-w-0">
      <div className={`text-base sm:text-lg font-semibold ${color}`} dir="ltr">
        {value}
      </div>
      <div className="text-[10px] text-stone-400 leading-tight">{label}</div>
    </div>
  );
}

function RowList({
  title,
  items,
  tone,
  hint,
}: {
  title: string;
  items: { key: string; row: number | null; text: string }[];
  tone: "danger" | "warn";
  hint?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const cls = tone === "danger" ? "border-red-900 bg-red-950/30 text-red-200" : "border-amber-900 bg-amber-950/25 text-amber-200";
  return (
    <div className={`rounded-lg border ${cls}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full text-right px-3 py-2 text-[11px] font-semibold">
        {title} {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1 max-h-64 overflow-y-auto">
          {hint && <p className="text-[10px] opacity-80 leading-relaxed">{hint}</p>}
          {items.map((it) => (
            <div key={it.key} className="text-[11px] leading-relaxed flex gap-2" dir="auto">
              <span className="shrink-0 opacity-70" dir="ltr">
                {it.row == null ? "—" : `${t({ ar: "السطر", en: "Row" })} ${it.row}`}
              </span>
              <span className="min-w-0">{it.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const OUTCOME_AR: Record<RowOutcome["action"], { ar: string; en: string }> = {
  created: { ar: "أُنشئ", en: "created" },
  updated: { ar: "حُدِّث", en: "updated" },
  unchanged: { ar: "دون تغيير", en: "unchanged" },
  failed: { ar: "فشل", en: "failed" },
  not_attempted: { ar: "بلا نتيجة من قاعدة البيانات", en: "no result returned" },
};

function ExecReport({
  result,
  mode,
  showOkRows,
  onToggleOk,
}: {
  result: ExecuteResult;
  mode: "dry_run" | "commit" | null;
  showOkRows: boolean;
  onToggleOk: () => void;
}) {
  const { t } = useI18n();
  const bad = useMemo(() => result.rows.filter((r) => r.action === "failed" || r.action === "not_attempted"), [result.rows]);
  const good = useMemo(() => result.rows.filter((r) => r.action !== "failed" && r.action !== "not_attempted"), [result.rows]);
  const succeeded = result.created + result.updated + result.unchanged;
  const isDry = (mode ?? result.mode) === "dry_run";
  const tone = result.ok ? (isDry ? "border-sky-900 bg-sky-950/30 text-sky-200" : "border-emerald-900 bg-emerald-950/30 text-emerald-200") : "border-red-900 bg-red-950/40 text-red-200";

  return (
    <section className={`${card} p-3 sm:p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-white">
          {isDry ? t({ ar: "نتيجة التشغيل التجريبي (لم يُكتب شيء)", en: "Dry-run result (nothing written)" }) : t({ ar: "نتيجة التنفيذ", en: "Import result" })}
        </h3>
        <span className="text-[10px] text-stone-600" dir="ltr">
          {result.code}
          {result.batchId ? ` · ${result.batchId}` : ""}
        </span>
      </div>

      <p className={`text-[11px] leading-relaxed rounded-lg border px-3 py-2 ${tone}`}>{result.message}</p>

      {/* الحقيقة الصريحة: كم نجح من كم — بلا تدوير ولا إخفاء */}
      <p className="text-[11px] text-stone-300 leading-relaxed">
        {t({ ar: "نجح", en: "Succeeded" })} <b dir="ltr">{succeeded}</b> {t({ ar: "من", en: "of" })} <b dir="ltr">{result.rows.length}</b>
        {result.failed > 0 ? ` · ${t({ ar: "فشل", en: "failed" })} ${result.failed}` : ""}
        {result.notAttempted > 0 ? ` · ${t({ ar: "بلا نتيجة", en: "no result" })} ${result.notAttempted}` : ""}
        {result.rolledBack ? ` · ${t({ ar: "تراجعت الدفعة بالكامل ولم يُكتب أي سطر", en: "the whole batch was rolled back" })}` : ""}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Kpi label={t({ ar: "أُنشئ", en: "Created" })} value={result.created} tone="ok" />
        <Kpi label={t({ ar: "حُدِّث", en: "Updated" })} value={result.updated} />
        <Kpi label={t({ ar: "دون تغيير", en: "Unchanged" })} value={result.unchanged} />
        <Kpi label={t({ ar: "فشل", en: "Failed" })} value={result.failed} tone={result.failed ? "danger" : "neutral"} />
        <Kpi label={t({ ar: "بلا نتيجة", en: "No result" })} value={result.notAttempted} tone={result.notAttempted ? "danger" : "neutral"} />
      </div>

      {/* كل سطر لم ينجح يُعرض كاملًا — لا اقتطاع هنا مهما بلغ العدد */}
      {bad.length > 0 && (
        <div className="rounded-lg border border-red-900 bg-red-950/30">
          <p className="px-3 py-2 text-[11px] font-semibold text-red-200">
            {t({ ar: "أسطر لم تنجح", en: "Rows that did not succeed" })} ({bad.length})
          </p>
          <div className="px-3 pb-2 space-y-1 max-h-72 overflow-y-auto">
            {bad.map((r) => (
              <div key={r.external_key} className="text-[11px] text-red-100 leading-relaxed flex gap-2" dir="auto">
                <span className="shrink-0 opacity-70" dir="ltr">
                  {t({ ar: "السطر", en: "Row" })} {r.source_row_number}
                </span>
                <span className="min-w-0">
                  {r.title} — {t(OUTCOME_AR[r.action])}
                  {r.error ? `: ${r.error}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {good.length > 0 && (
        <div className="rounded-lg border border-stone-800">
          <button type="button" onClick={onToggleOk} aria-expanded={showOkRows} className="w-full text-right px-3 py-2 text-[11px] text-stone-300">
            {t({ ar: "الأسطر الناجحة", en: "Successful rows" })} ({good.length}) {showOkRows ? "▴" : "▾"}
          </button>
          {showOkRows && (
            <div className="px-3 pb-2 space-y-1 max-h-72 overflow-y-auto">
              {good.slice(0, MAX_LISTED_OK_ROWS).map((r) => (
                <div key={r.external_key} className="text-[11px] text-stone-400 leading-relaxed flex gap-2" dir="auto">
                  <span className="shrink-0 opacity-70" dir="ltr">
                    {t({ ar: "السطر", en: "Row" })} {r.source_row_number}
                  </span>
                  <span className="min-w-0">
                    {r.title} — {t(OUTCOME_AR[r.action])}
                  </span>
                </div>
              ))}
              {good.length > MAX_LISTED_OK_ROWS && (
                <p className="text-[10px] text-stone-600">
                  {t({ ar: "وعُرض", en: "Showing" })} {MAX_LISTED_OK_ROWS} {t({ ar: "من الأسطر الناجحة فقط اختصارًا؛ الأسطر غير الناجحة معروضة كاملةً أعلاه.", en: "successful rows; every unsuccessful row is listed in full above." })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
