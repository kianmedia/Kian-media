"use client";
// ════════════════════════════════════════════════════════════════════════════
// Wave6Registers — سجلّ HSE الموحَّد · الإجراءات التشغيلية · ملخّص حقوق مشروع.
//
// Wave 6 · V2-6.3-B · V2-6.4-A · V2-6.6-A/B/C
//
// ★ ما ترفض هذه اللوحة أن تفعله ★
//  ١. **لا تطبع اسم شخص.** ملخّص الحقوق يُشارَك ويُطبع، والخادم يعيد أعدادًا
//     وحالات لإقرارات الظهور لا أسماء (PDPL). واللوحة لا تطلب المزيد.
//  ٢. **لا تعرض إجراءً غير معتمَد كأنّه معتمَد.** المسوّدة تُعلَن مسوّدة،
//     والمنتهي يُعلَن منتهيًا ولو بقيت حالته `approved`.
//  ٣. **لا تُخفي فقدًا.** وسيط أرشيف حالته `missing` يظهر بلون تحذير — إخفاؤه
//     يجعل الأرشيف يبدو سليمًا وهو ناقص.
//
// ⛔ خلف علم مطفأ لا تُركَّب (الحارس في المستدعي).
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  hseRegisterList, sopList, sopItemsList, projectRightsSummary,
  archiveMediaUpsert, musicLicenseUpsert, modelReleaseUpsert,
  HSE_SOURCE_AR, MEDIA_HEALTH_AR,
  type HseRow, type SopRow, type SopItemRow, type ProjectRightsSummary,
} from "@/lib/portal/custodyInventory";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const btn = "px-3 py-1.5 rounded-lg text-[12px] bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700";

type Phase<T> = { k: "loading" } | { k: "error"; msg: string } | { k: "ok"; d: T };

function useLoad<T>(fn: () => Promise<{ ok: boolean; data?: T; error?: string }>, deps: unknown[]) {
  const [p, setP] = useState<Phase<T>>({ k: "loading" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(() => {
    let alive = true;
    setP({ k: "loading" });
    void run().then((r) => {
      if (!alive) return;
      if (r.ok && r.data !== undefined) setP({ k: "ok", d: r.data });
      else setP({ k: "error", msg: r.error ?? "تعذّر التحميل." });
    });
    return () => { alive = false; };
  }, [run]);
  useEffect(() => reload(), [reload]);
  return { p, reload };
}

function Shell<T>({ p, reload, children }: { p: Phase<T>; reload: () => void; children: (d: T) => React.ReactNode }) {
  if (p.k === "loading") return <p className="text-[12px] text-stone-500">جارٍ التحميل…</p>;
  if (p.k === "error") return (
    <p className="text-[12px] text-red-400">
      {p.msg} <button className="underline" onClick={reload}>إعادة المحاولة</button>
    </p>
  );
  return <>{children(p.d)}</>;
}

// ─── سجلّ HSE الموحَّد ───────────────────────────────────────────────────────

function HseRegister() {
  const [source, setSource] = useState("");
  const { p, reload } = useLoad<{ ok: boolean; rows: HseRow[] }>(
    () => hseRegisterList(source ? { source } : {}), [source]);

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-[13px] text-stone-100">سجلّ السلامة والحوادث</h3>
        <select className="bg-stone-950 border border-stone-700 rounded px-2 py-1 text-[12px] text-stone-200"
          value={source} onChange={(e) => setSource(e.target.value)} aria-label="تصفية حسب المصدر">
          <option value="">كلّ المصادر</option>
          {Object.entries(HSE_SOURCE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {/* 🔴 موحَّد من ثلاثة سجلّات قائمة — لا سجلّ حوادث رابع. */}
      <p className="text-[10.5px] text-stone-500 mb-2">
        موحَّد من فحوص أوامر العمل وحوادث التشغيل وحوادث العهدة — بلا سجلّ رابع.
      </p>
      <Shell p={p} reload={reload}>
        {(d) =>
          d.rows.length === 0
            ? <p className="text-[12px] text-stone-500">لا سجلّات في هذا النطاق.</p>
            : (
              <ul className="space-y-1">
                {d.rows.slice(0, 60).map((r) => (
                  <li key={`${r.source}:${r.source_id}`}
                      className="flex justify-between gap-3 text-[12.5px] border-t border-stone-800 pt-1">
                    <span className="text-stone-200 truncate">
                      {r.title || "—"}
                      <span className="text-stone-500 text-[11px]"> · {HSE_SOURCE_AR[r.source] ?? r.source}</span>
                    </span>
                    <span className={`shrink-0 ${r.state === "issue" ? "text-red-400" : "text-stone-400"}`}>
                      {r.state ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )
        }
      </Shell>
    </section>
  );
}

// ─── الإجراءات التشغيلية ────────────────────────────────────────────────────

function SopItems({ sourceId }: { sourceId: string }) {
  const { p, reload } = useLoad<{ ok: boolean; rows: SopItemRow[] }>(
    () => sopItemsList(sourceId), [sourceId]);
  return (
    <Shell p={p} reload={reload}>
      {(d) =>
        d.rows.length === 0
          ? <p className="text-[11.5px] text-stone-500">لا خطوات بعد.</p>
          : (
            <ol className="mt-1 space-y-1">
              {d.rows.map((i) => (
                <li key={i.id} className="text-[12px] text-stone-300 flex gap-2">
                  <span className="text-stone-600 tabular-nums shrink-0">{i.sort_order}.</span>
                  <span>
                    {i.label_ar}
                    {!i.is_required && <span className="text-stone-600 text-[10.5px]"> (اختيارية)</span>}
                  </span>
                </li>
              ))}
            </ol>
          )
      }
    </Shell>
  );
}

function Sops() {
  // ⛔ لا تُطلب المعتمَدة وحدها: المسوّدة يجب أن تُرى لتُراجَع وتُعتمد.
  const { p, reload } = useLoad<{ ok: boolean; rows: SopRow[] }>(() => sopList(null), []);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className={card}>
      <h3 className="text-[13px] text-stone-100 mb-2">الإجراءات التشغيلية</h3>
      <Shell p={p} reload={reload}>
        {(d) =>
          d.rows.length === 0 ? (
            <p className="text-[12px] text-stone-500">
              لا إجراءات بعد. تُحرَّر في قاعدة المعرفة القائمة بنوع «إجراء تشغيليّ».
            </p>
          ) : (
            <ul className="space-y-2">
              {d.rows.map((s) => (
                <li key={s.id} className="border-t border-stone-800 pt-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12.5px] text-stone-100">{s.title_ar}</span>
                    <span className="shrink-0 text-[11px]">
                      {/* 🔴 مسوّدة تُعلَن مسوّدة — لا تُرفَق بمهمّة. */}
                      {s.status !== "approved" && <span className="text-amber-500">{s.status}</span>}
                      {s.status === "approved" && s.expired && <span className="text-red-400">منتهٍ</span>}
                      {s.status === "approved" && !s.expired && <span className="text-emerald-500">معتمَد</span>}
                    </span>
                  </div>
                  <button className="text-[11.5px] text-stone-400 underline mt-1"
                    onClick={() => setOpen(open === s.id ? null : s.id)}>
                    {open === s.id ? "إخفاء الخطوات" : `الخطوات (${s.item_count})`}
                  </button>
                  {open === s.id && <SopItems sourceId={s.id} />}
                  {s.status !== "approved" && (
                    <p className="text-[10.5px] text-stone-500 mt-1">
                      ⛔ لا يُرفَق بمهمّة حتى يُعتمَد — الخادم يرفض غير المعتمَد.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </Shell>
    </section>
  );
}

// ─── ملخّص حقوق مشروع ───────────────────────────────────────────────────────

export function ProjectRights({ projectId }: { projectId: string }) {
  const { p, reload } = useLoad<ProjectRightsSummary>(() => projectRightsSummary(projectId), [projectId]);
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-[13px] text-stone-100">ملخّص الحقوق</h3>
        <button className={`${btn} ops-noprint`} onClick={() => window.print()}>طباعة</button>
      </div>
      <Shell p={p} reload={reload}>
        {(d) => (
          <div className="space-y-3">
            <div>
              <h4 className="text-[12px] text-stone-300 mb-1">الموسيقى</h4>
              {d.music.length === 0 ? (
                <p className="text-[11.5px] text-stone-500">لا تراخيص مرتبطة بهذا المشروع.</p>
              ) : (
                <ul className="space-y-1">
                  {d.music.map((m, i) => (
                    <li key={`${m.track_title}-${i}`} className="text-[12px] flex justify-between gap-2">
                      <span className="text-stone-200 truncate">{m.track_title}</span>
                      <span className="shrink-0">
                        <span className="text-stone-500">{m.license_type}</span>
                        {/* 🔴 منتهٍ يُعلن منتهيًا ولو بقي مربوطًا بالمشروع. */}
                        {m.expired && <span className="text-red-400"> · منتهٍ</span>}
                        {!m.has_proof && <span className="text-amber-500"> · بلا إثبات</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-stone-800 pt-2">
              <h4 className="text-[12px] text-stone-300 mb-1">إقرارات الظهور</h4>
              {/* ⛔ أعداد وحالات فقط — لا اسم شخص في ورقة تُطبع وتُشارَك. */}
              <p className="text-[12px] text-stone-400">
                الإجمالي {d.model_releases.total} ·{" "}
                <span className={d.model_releases.withdrawn > 0 ? "text-amber-500" : ""}>
                  مسحوب {d.model_releases.withdrawn}
                </span>{" "}·{" "}
                <span className={d.model_releases.expired > 0 ? "text-amber-500" : ""}>
                  منتهٍ {d.model_releases.expired}
                </span>{" "}·{" "}
                <span className={d.model_releases.missing_document > 0 ? "text-red-400" : ""}>
                  بلا مستند {d.model_releases.missing_document}
                </span>
              </p>
              <p className="text-[10.5px] text-stone-600 mt-1">
                أعداد وحالات فقط — لا أسماء في ملخّص قابل للطباعة.
              </p>
            </div>

            <div className="border-t border-stone-800 pt-2">
              <h4 className="text-[12px] text-stone-300 mb-1">الأرشيف الفيزيائيّ</h4>
              {d.archive.length === 0 ? (
                <p className="text-[11.5px] text-stone-500">لا وسائط مرتبطة.</p>
              ) : (
                <ul className="space-y-1">
                  {d.archive.map((a, i) => (
                    <li key={`${a.media_label}-${i}`} className="text-[12px] flex justify-between gap-2">
                      <span className="text-stone-200 truncate">
                        {a.media_label}
                        {a.physical_location && <span className="text-stone-500"> · {a.physical_location}</span>}
                      </span>
                      <span className="shrink-0">
                        {/* 🔴 الفقد لا يُخفى. */}
                        <span className={a.link_status === "missing" ? "text-red-400" : "text-stone-500"}>
                          {a.link_status === "missing" ? "مفقود" : a.link_status}
                        </span>
                        <span className={["failing", "failed"].includes(a.health_status) ? "text-red-400" : "text-stone-600"}>
                          {" "}· {MEDIA_HEALTH_AR[a.health_status] ?? a.health_status}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Shell>
    </section>
  );
}

/**
 * إدخال سريع للسجلّات الثلاثة.
 *
 * ★ لماذا نموذج واحد لا ثلاثة ★
 * الحقول المشتركة قليلة والفروق قليلة، وثلاث شاشات متطابقة تقريبًا تتباعد مع
 * أوّل تعديل. النوع يُختار، والحقول تتبعه.
 *
 * 🔴 ولا يُطلب هنا رقم هويّة ولا عنوان لإقرار الظهور — الخادم لا يقرأهما أصلًا،
 *    والواجهة لا تُغري بإدخالهما.
 */
function QuickEntry() {
  const [kind, setKind] = useState<"archive" | "license" | "release">("archive");
  const [f, setF] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));

  const FIELDS: Record<string, { k: string; ar: string; type?: string }[]> = {
    archive: [
      { k: "label", ar: "اسم الوسيط" },
      { k: "serial_number", ar: "الرقم التسلسليّ" },
      { k: "capacity_gb", ar: "السعة (GB)", type: "number" },
      { k: "physical_location", ar: "الموقع الفيزيائيّ" },
      { k: "retention_until", ar: "الاحتفاظ حتى (اختياريّ)", type: "date" },
    ],
    license: [
      { k: "track_title", ar: "اسم المقطوعة" },
      { k: "artist", ar: "الفنّان" },
      { k: "license_id", ar: "رقم الترخيص" },
      { k: "expires_at", ar: "ينتهي في", type: "date" },
    ],
    release: [
      { k: "person_name", ar: "اسم الشخص" },
      { k: "contact_ref", ar: "وسيلة تواصل واحدة (اختياريّة)" },
      { k: "signed_at", ar: "تاريخ التوقيع", type: "date" },
      { k: "expires_at", ar: "ينتهي في", type: "date" },
    ],
  };

  async function save() {
    setBusy(true); setMsg(null);
    const payload: Record<string, unknown> = {};
    for (const { k } of FIELDS[kind]) if (f[k]) payload[k] = f[k];
    const r = kind === "archive" ? await archiveMediaUpsert(payload)
            : kind === "license" ? await musicLicenseUpsert(payload)
            : await modelReleaseUpsert(payload);
    setBusy(false);
    if (r.ok) { setF({}); setMsg({ t: "حُفظ.", bad: false }); return; }
    setMsg({ t: r.error ?? "تعذّر الحفظ.", bad: true });
  }

  return (
    <section className={card}>
      <h3 className="text-[13px] text-stone-100 mb-2">إدخال سريع</h3>
      <select className="bg-stone-950 border border-stone-700 rounded px-2 py-1 text-[12px] text-stone-200 mb-2"
        value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setF({}); }}
        aria-label="نوع السجلّ">
        <option value="archive">وسيط أرشيف</option>
        <option value="license">ترخيص موسيقى</option>
        <option value="release">إقرار ظهور</option>
      </select>
      <div className="grid grid-cols-2 gap-2">
        {FIELDS[kind].map((x) => (
          <label key={x.k} className="text-[11px] text-stone-400">
            {x.ar}
            <input type={x.type ?? "text"} value={f[x.k] ?? ""} onChange={(e) => set(x.k, e.target.value)}
              className="block w-full bg-stone-950 border border-stone-700 rounded px-2 py-1 text-[12px] text-stone-200" />
          </label>
        ))}
      </div>
      {kind === "archive" && (
        <p className="text-[10.5px] text-stone-500 mt-1 leading-relaxed">
          مدّة الاحتفاظ **اختيارية** ولا تُفترض، وانقضاؤها **لا يحذف شيئًا** —
          لم تُعتمَد سياسة إتلاف بعد.
        </p>
      )}
      {kind === "release" && (
        <p className="text-[10.5px] text-stone-500 mt-1 leading-relaxed">
          ⛔ لا يُطلب رقم هويّة ولا عنوان ولا تاريخ ميلاد — الحدّ الأدنى وحده (PDPL).
        </p>
      )}
      <button className={`${btn} mt-2`} onClick={save} disabled={busy}>
        {busy ? "جارٍ الحفظ…" : "حفظ"}
      </button>
      {msg && <p className={`text-[12px] mt-1 ${msg.bad ? "text-red-400" : "text-emerald-500"}`}>{msg.t}</p>}
    </section>
  );
}

export default function Wave6Registers() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <HseRegister />
      <Sops />
      <QuickEntry />
    </div>
  );
}
