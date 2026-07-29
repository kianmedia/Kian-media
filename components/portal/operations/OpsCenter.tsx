"use client";
// ════════════════════════════════════════════════════════════════════════════
// OpsCenter — مركز التشغيل والإنتاج. Mobile-first: العرض الميدانيّ («مهامّي»)
// هو التبويب الافتراضيّ لغير المدير، لأنّه ما يُفتح على الموقع بيد واحدة.
//
// البوّابة الحقيقية في القاعدة (prodops_can_view = موظّف فقط). ما هنا تجميل:
// حتى لو زُوِّرت الحالة في المتصفّح فكلّ استدعاء يُرفض من الخادم.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  opsAccess, opsDashboard, opsJobsList, opsMyAssignments, opsCalendar, opsConflicts,
  opsLookups, opsJobUpsert, opsLocationUpsert, opsVehicleUpsert,
  JOB_TYPE_AR, JOB_STATUS_AR, JOB_STATUS_COLOR, CONFLICT_AR,
  opsDate, opsTime, opsDateTime, opsIsoDay, readinessColor,
  type OpsAccess, type OpsDashboard, type OpsJobRow, type OpsAssignments,
  type OpsConflictReport, type OpsLookups, type OpsRow, type OpsJobType,
} from "@/lib/portal/opsCenter";
import {
  card, btnGhost, btnPrimary, fieldCls, Chip, Counter, Empty, Flash,
  StateView, useOpsLoad, Denied,
} from "./OpsAtoms";
import OpsJobPanel from "./OpsJobPanel";

type Tab = "today" | "mine" | "jobs" | "calendar" | "conflicts" | "refs";
const S = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));

export default function OpsCenter() {
  const { st: accSt, reload: reloadAcc } = useOpsLoad<OpsAccess>(() => opsAccess(), []);
  const [tab, setTab] = useState<Tab | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);

  return (
    <StateView st={accSt} onRetry={reloadAcc}>
      {(acc) => {
        if (!acc.can_view) {
          return (
            <Denied
              message={
                acc.authenticated
                  ? (acc.message ?? "مركز التشغيل مخصّص لفريق العمل الداخليّ.")
                  : "سجّل الدخول للوصول إلى مركز التشغيل."
              }
            />
          );
        }
        const tabs: { k: Tab; ar: string }[] = acc.can_manage
          ? [
              { k: "today", ar: "لوحة اليوم" }, { k: "mine", ar: "مهامّي" },
              { k: "jobs", ar: "أوامر العمل" }, { k: "calendar", ar: "التقويم" },
              { k: "conflicts", ar: "التعارضات" }, { k: "refs", ar: "المواقع والمركبات" },
            ]
          : [{ k: "mine", ar: "مهامّي" }, { k: "today", ar: "لوحة اليوم" }, { k: "jobs", ar: "أوامر العمل" }];
        const active: Tab = tab ?? tabs[0].k;

        if (openJob) return <OpsJobPanel jobId={openJob} onBack={() => setOpenJob(null)} />;

        return (
          <div className="space-y-4">
            {/* تبويبات قابلة للتمرير أفقيًّا — لا تنكسر على شاشة 360px */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {tabs.map((t) => (
                <button
                  key={t.k}
                  onClick={() => setTab(t.k)}
                  className={`min-h-[44px] px-4 rounded-lg text-sm whitespace-nowrap border ${
                    active === t.k
                      ? "bg-red-800 border-red-700 text-white"
                      : "bg-stone-900 border-stone-800 text-stone-300"
                  }`}
                >
                  {t.ar}
                </button>
              ))}
            </div>

            {active === "today" && <TodayTab onOpen={setOpenJob} />}
            {active === "mine" && <MineTab onOpen={setOpenJob} />}
            {active === "jobs" && <JobsTab canManage={acc.can_manage} onOpen={setOpenJob} />}
            {active === "calendar" && <CalendarTab onOpen={setOpenJob} />}
            {active === "conflicts" && <ConflictsTab />}
            {active === "refs" && <RefsTab />}
          </div>
        );
      }}
    </StateView>
  );
}

// ─── لوحة اليوم ─────────────────────────────────────────────────────────────
function TodayTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { st, reload } = useOpsLoad<OpsDashboard>(() => opsDashboard(), []);
  const [focus, setFocus] = useState<string | null>(null);
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => {
        const c = d.counters ?? {};
        const lists: Record<string, { ar: string; rows: OpsRow[] }> = {
          missing_crew: { ar: "طاقم ناقص أو غير مؤكَّد", rows: d.missing_crew },
          missing_equipment: { ar: "معدّات ناقصة", rows: d.missing_equipment },
          missing_permits: { ar: "تصاريح ناقصة", rows: d.missing_permits },
          media_not_backed_up: { ar: "مادّة غير مُؤمَّنة", rows: d.media_not_backed_up },
        };
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <Counter label="اليوم" value={c.today ?? 0} />
              <Counter label="٧ أيام" value={c.next_7_days ?? 0} />
              <Counter label="تعارضات" value={c.conflicts ?? 0} tone={(c.conflicts ?? 0) > 0 ? "bad" : "good"}
                active={focus === "conflicts"} onClick={() => setFocus(focus === "conflicts" ? null : "conflicts")} />
              {(["missing_crew", "missing_equipment", "missing_permits", "media_not_backed_up"] as const).map((k) => (
                <Counter key={k} label={lists[k].ar} value={c[k] ?? 0}
                  tone={(c[k] ?? 0) > 0 ? "warn" : "good"}
                  active={focus === k} onClick={() => setFocus(focus === k ? null : k)} />
              ))}
            </div>

            {focus === "conflicts" && <ConflictList report={d.conflicts} />}
            {focus && focus !== "conflicts" && (
              <div className={`${card} p-4`}>
                <h3 className="text-sm text-stone-100 mb-2">{lists[focus].ar}</h3>
                {lists[focus].rows.length === 0 ? <Empty message="لا شيء هنا — جيّد." /> : (
                  <ul className="space-y-2">
                    {lists[focus].rows.map((r, i) => (
                      <li key={`${S(r.id ?? r.card_id)}-${i}`} className="text-sm text-stone-300">
                        <button className="text-right min-h-[44px]" onClick={() => onOpen(String(r.job_id ?? r.id))}>
                          <Chip>{S(r.job_code)}</Chip> {S(r.title)}
                          {r.card_label ? <span className="text-stone-500"> · بطاقة {S(r.card_label)}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <JobCards title="اليوم" rows={d.today} onOpen={onOpen} emptyMsg="لا مهامّ اليوم." />
            <JobCards title="الأيام السبعة القادمة" rows={d.next_7_days} onOpen={onOpen} emptyMsg="لا مهامّ قادمة." />
          </div>
        );
      }}
    </StateView>
  );
}

function JobCards({ title, rows, onOpen, emptyMsg }:
  { title: string; rows: OpsRow[]; onOpen: (id: string) => void; emptyMsg: string }) {
  return (
    <div className={`${card} p-4`}>
      <h3 className="text-sm text-stone-100 mb-3">{title}</h3>
      {rows.length === 0 ? <Empty message={emptyMsg} /> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={String(r.id)}>
              <button
                className="w-full text-right bg-stone-950 border border-stone-800 rounded-lg p-3 min-h-[60px]"
                onClick={() => onOpen(String(r.id))}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip>{S(r.job_code)}</Chip>
                  <span className="text-sm text-stone-100">{S(r.title)}</span>
                  <span className={`text-[11px] ${JOB_STATUS_COLOR[String(r.status) as keyof typeof JOB_STATUS_COLOR] ?? "text-stone-400"}`}>
                    {JOB_STATUS_AR[String(r.status) as keyof typeof JOB_STATUS_AR] ?? S(r.status)}
                  </span>
                  {typeof r.readiness === "number" && (
                    <span className={`text-[11px] ${readinessColor(r.readiness)}`}>جاهزية {r.readiness}%</span>
                  )}
                </div>
                <div className="text-xs text-stone-500 mt-1">
                  {opsDateTime(r.scheduled_start as string)} · {S(r.location_name)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── مهامّي (الميدان) ───────────────────────────────────────────────────────
function MineTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { st, reload } = useOpsLoad<OpsAssignments>(() => opsMyAssignments(14), []);
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => (
        <div className="space-y-4">
          <div className={`${card} p-4`}>
            <h3 className="text-sm text-stone-100 mb-3">إسناداتي (١٤ يومًا)</h3>
            {d.assignments.length === 0 ? <Empty message="لا إسنادات حاليًّا." /> : (
              <ul className="space-y-2">
                {d.assignments.map((a) => (
                  <li key={String(a.crew_id)}>
                    <button
                      className="w-full text-right bg-stone-950 border border-stone-800 rounded-lg p-3"
                      onClick={() => onOpen(String(a.job_id))}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip>{S(a.job_code)}</Chip>
                        <span className="text-sm text-stone-100">{S(a.title)}</span>
                        <Chip tone={a.attendance_status === "confirmed" || a.attendance_status === "attended" ? "good" : "warn"}>
                          {a.attendance_status === "confirmed" ? "أكّدت"
                            : a.attendance_status === "attended" ? "حضرت"
                            : a.attendance_status === "declined" ? "اعتذرت" : "بانتظار تأكيدك"}
                        </Chip>
                      </div>
                      <div className="text-xs text-stone-500 mt-1">
                        الحضور {opsTime(a.call_time as string)} · {opsDate(a.scheduled_start as string)} · {S(a.location_name)}
                      </div>
                      {a.contact_phone ? (
                        <div className="text-xs mt-1">
                          مسؤول الموقع: {S(a.contact_name)} — <span className="text-red-300">{S(a.contact_phone)}</span>
                        </div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={`${card} p-4`}>
            <h3 className="text-sm text-stone-100 mb-3">أعمال ما بعد الإنتاج المُسندة إليّ</h3>
            {d.post_work.length === 0 ? <Empty message="لا أعمال مونتاج مُسندة إليك." /> : (
              <ul className="space-y-2">
                {d.post_work.map((h) => (
                  <li key={String(h.handoff_id)}>
                    <button
                      className="w-full text-right bg-stone-950 border border-stone-800 rounded-lg p-3"
                      onClick={() => onOpen(String(h.job_id))}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip>{S(h.job_code)}</Chip>
                        <span className="text-sm text-stone-100">{S(h.title)}</span>
                        <Chip>{S(h.status)}</Chip>
                      </div>
                      <div className="text-xs text-stone-500 mt-1">
                        التسليم المتوقّع: {opsDate(h.expected_delivery as string)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </StateView>
  );
}

// ─── أوامر العمل ───────────────────────────────────────────────────────────
function JobsTab({ canManage, onOpen }: { canManage: boolean; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [nonce, setNonce] = useState(0);
  const [creating, setCreating] = useState(false);
  const { st, reload } = useOpsLoad<{ ok: boolean; rows: OpsJobRow[]; can_manage: boolean }>(
    () => opsJobsList({ q: q || undefined, status: status || undefined, limit: 200 }),
    [q, status, nonce],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${fieldCls} flex-1 min-w-[180px]`} placeholder="بحث بالعنوان أو الرمز"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${fieldCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كلّ الحالات</option>
          {Object.entries(JOB_STATUS_AR).map(([v, ar]) => <option key={v} value={v}>{ar}</option>)}
        </select>
        {canManage && (
          <button className={btnPrimary} onClick={() => setCreating((c) => !c)}>
            {creating ? "إغلاق" : "+ أمر عمل"}
          </button>
        )}
      </div>

      {creating && <NewJobForm onDone={() => { setCreating(false); setNonce((n) => n + 1); }} />}

      <StateView st={st} onRetry={reload}>
        {(d) => (
          d.rows.length === 0 ? <Empty message="لا أوامر عمل مطابقة." /> : (
            <ul className="space-y-2">
              {d.rows.map((r) => (
                <li key={r.id}>
                  <button
                    className={`${card} w-full text-right p-3 min-h-[60px]`}
                    onClick={() => onOpen(r.id)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip>{r.job_code}</Chip>
                      <span className="text-sm text-stone-100">{r.title}</span>
                      <span className={`text-[11px] ${JOB_STATUS_COLOR[r.status] ?? "text-stone-400"}`}>
                        {JOB_STATUS_AR[r.status] ?? r.status}
                      </span>
                      <Chip>{JOB_TYPE_AR[r.job_type] ?? r.job_type}</Chip>
                    </div>
                    <div className="text-xs text-stone-500 mt-1">
                      {opsDateTime(r.scheduled_start)} · {S(r.location_name ?? r.location_note)} ·
                      طاقم {r.crew_count} · معدّات {r.equip_count}
                      {r.project_name ? ` · مشروع: ${r.project_name}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </StateView>
    </div>
  );
}

function NewJobForm({ onDone }: { onDone: () => void }) {
  const { st: lkSt } = useOpsLoad<OpsLookups>(() => opsLookups(), []);
  const lookups = lkSt && lkSt.state === "ok" ? lkSt.data : null;
  const [f, setF] = useState<Record<string, string>>({
    title: "", job_type: "filming", scheduled_start: "", scheduled_end: "",
    location_id: "", location_note: "", client_label: "", priority: "normal",
  });
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ t: string; tone: "ok" | "bad" }>({ t: "", tone: "ok" });

  const save = async () => {
    if (f.title.trim().length < 2) { setFlash({ t: "العنوان مطلوب.", tone: "bad" }); return; }
    setBusy(true);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) payload[k] = v === "" ? null : v;
    const r = await opsJobUpsert(payload);
    setBusy(false);
    if (r.state === "ok") onDone();
    else setFlash({ t: r.message, tone: "bad" });
  };

  return (
    <div className={`${card} p-4 space-y-3`}>
      <h3 className="text-sm text-stone-100">أمر عمل جديد</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          <span className="block text-[11px] text-stone-400 mb-1">العنوان</span>
          <input className={fieldCls} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">النوع</span>
          <select className={fieldCls} value={f.job_type} onChange={(e) => setF((s) => ({ ...s, job_type: e.target.value }))}>
            {Object.entries(JOB_TYPE_AR).map(([v, ar]) => <option key={v} value={v}>{ar}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">الأولوية</span>
          <select className={fieldCls} value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value }))}>
            <option value="low">منخفضة</option><option value="normal">عادية</option>
            <option value="high">عالية</option><option value="urgent">عاجلة</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">البداية</span>
          <input className={fieldCls} type="datetime-local" value={f.scheduled_start}
            onChange={(e) => setF((s) => ({ ...s, scheduled_start: e.target.value }))} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">النهاية</span>
          <input className={fieldCls} type="datetime-local" value={f.scheduled_end}
            onChange={(e) => setF((s) => ({ ...s, scheduled_end: e.target.value }))} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">الموقع</span>
          <select className={fieldCls} value={f.location_id} onChange={(e) => setF((s) => ({ ...s, location_id: e.target.value }))}>
            <option value="">—</option>
            {(lookups?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">وصف الموقع (حرّ)</span>
          <input className={fieldCls} value={f.location_note}
            onChange={(e) => setF((s) => ({ ...s, location_note: e.target.value }))} />
        </label>
        <label className="block sm:col-span-2">
          <span className="block text-[11px] text-stone-400 mb-1">العميل (نصّ حرّ)</span>
          <input className={fieldCls} value={f.client_label}
            onChange={(e) => setF((s) => ({ ...s, client_label: e.target.value }))} />
        </label>
      </div>
      <Flash text={flash.t} tone={flash.tone} />
      <button className={btnPrimary} disabled={busy} onClick={() => void save()}>
        {busy ? "…" : "إنشاء"}
      </button>
    </div>
  );
}

// ─── التقويم ───────────────────────────────────────────────────────────────
function CalendarTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [from, setFrom] = useState(opsIsoDay());
  const [to, setTo] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30); return opsIsoDay(d);
  });
  const { st, reload } = useOpsLoad<{ ok: boolean; from: string; to: string; days: OpsRow[] }>(
    () => opsCalendar(from, to), [from, to],
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex-1 min-w-[140px]">
          <span className="block text-[11px] text-stone-400 mb-1">من</span>
          <input className={fieldCls} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex-1 min-w-[140px]">
          <span className="block text-[11px] text-stone-400 mb-1">إلى</span>
          <input className={fieldCls} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <StateView st={st} onRetry={reload}>
        {(d) => {
          const byDay = new Map<string, OpsRow[]>();
          for (const r of d.days) {
            const k = String(r.day ?? "—");
            byDay.set(k, [...(byDay.get(k) ?? []), r]);
          }
          const keys = Array.from(byDay.keys()).sort();
          if (keys.length === 0) return <Empty message="لا مهامّ في هذه الفترة." />;
          return (
            <div className="space-y-3">
              {keys.map((k) => (
                <div key={k} className={`${card} p-3`}>
                  <div className="text-xs text-stone-400 mb-2">{opsDate(`${k}T00:00:00Z`)}</div>
                  <ul className="space-y-2">
                    {(byDay.get(k) ?? []).map((r) => (
                      <li key={String(r.id)}>
                        <button className="w-full text-right bg-stone-950 border border-stone-800 rounded-lg p-2.5 min-h-[52px]"
                          onClick={() => onOpen(String(r.id))}>
                          <span className="text-sm text-stone-100">{opsTime(r.scheduled_start as string)} — {S(r.title)}</span>
                          <span className="block text-xs text-stone-500">
                            {JOB_TYPE_AR[String(r.job_type) as OpsJobType] ?? S(r.job_type)} · {S(r.location_name)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          );
        }}
      </StateView>
    </div>
  );
}

// ─── التعارضات ─────────────────────────────────────────────────────────────
function ConflictsTab() {
  const { st, reload } = useOpsLoad<OpsConflictReport>(() => opsConflicts(), []);
  return <StateView st={st} onRetry={reload}>{(d) => <ConflictList report={d} />}</StateView>;
}

function ConflictList({ report }: { report: OpsConflictReport }) {
  const all = [...(report.internal ?? []), ...(report.external?.items ?? [])];
  const sources = report.external?.sources ?? {};
  return (
    <div className={`${card} p-4 space-y-3`}>
      <h3 className="text-sm text-stone-100">التعارضات ({report.total ?? all.length})</h3>
      {/* صدق المصدر: «صفر تعارض» ≠ «لم يُقرأ المصدر». */}
      <ul className="text-[11px] text-stone-500 space-y-0.5">
        {Object.entries(sources).map(([k, v]) => (
          <li key={k}>
            {k === "custody_reservations" ? "حجوزات مخزون الأصول" : k === "planning_bookings" ? "حجوزات تخطيط المشاريع" : k}:{" "}
            {v === "ok" ? "قُرئ" : v === "unavailable" ? "غير متاح (الموديول غير مطبَّق) — لا يُقال إنّه سليم" : v === "error" ? "تعذّرت قراءته" : String(v)}
          </li>
        ))}
      </ul>
      {all.length === 0 ? <Empty message="لا تعارضات ضمن الفترة." /> : (
        <ul className="space-y-2">
          {all.map((c, i) => (
            <li key={i} className="bg-stone-950 border border-stone-800 rounded-lg p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={c.severity === "high" ? "bad" : c.severity === "medium" ? "warn" : "neutral"}>
                  {CONFLICT_AR[c.kind] ?? c.kind}
                </Chip>
                <span className="text-sm text-stone-200">{c.ar}</span>
              </div>
              <div className="text-xs text-stone-500 mt-1">
                {S(c.job_a_code)} {c.job_b_code ? `↔ ${c.job_b_code}` : c.external_source ? `↔ ${c.external_source}` : ""}
                {" · "}{opsDateTime(c.overlap_from)} → {opsDateTime(c.overlap_to)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── المواقع والمركبات ─────────────────────────────────────────────────────
function RefsTab() {
  const [nonce, setNonce] = useState(0);
  const { st, reload } = useOpsLoad<OpsLookups>(() => opsLookups(), [nonce]);
  const [mode, setMode] = useState<"none" | "loc" | "veh">("none");
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ t: string; tone: "ok" | "bad" }>({ t: "", tone: "ok" });

  const save = async () => {
    setBusy(true);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) payload[k] = v === "" ? null : v;
    const r = mode === "loc" ? await opsLocationUpsert(payload) : await opsVehicleUpsert(payload);
    setBusy(false);
    if (r.state === "ok") { setMode("none"); setF({}); setNonce((n) => n + 1); }
    else setFlash({ t: r.message, tone: "bad" });
  };

  const field = (k: string, ar: string, type = "text") => (
    <label className="block" key={k}>
      <span className="block text-[11px] text-stone-400 mb-1">{ar}</span>
      <input className={fieldCls} type={type} value={f[k] ?? ""} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} />
    </label>
  );

  return (
    <StateView st={st} onRetry={reload}>
      {(d) => (
        <div className="space-y-4">
          <div className={`${card} p-4 space-y-3`}>
            <div className="flex items-center gap-2">
              <h3 className="flex-1 text-sm text-stone-100">المواقع ({d.locations.length})</h3>
              <button className={btnGhost} onClick={() => { setMode(mode === "loc" ? "none" : "loc"); setF({}); }}>
                {mode === "loc" ? "إلغاء" : "+ موقع"}
              </button>
            </div>
            {mode === "loc" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {field("name", "الاسم")}
                <label className="block">
                  <span className="block text-[11px] text-stone-400 mb-1">النوع</span>
                  <select className={fieldCls} value={f.kind ?? "other"} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value }))}>
                    <option value="studio">استوديو</option><option value="outdoor">خارجيّ</option>
                    <option value="client_site">موقع العميل</option><option value="office">مكتب</option>
                    <option value="venue">قاعة</option><option value="other">أخرى</option>
                  </select>
                </label>
                {field("city", "المدينة")}
                {field("address", "العنوان")}
                {field("map_url", "رابط الخريطة")}
                {field("contact_name", "مسؤول التواصل")}
                {field("contact_phone", "جوّال المسؤول")}
                {field("access_notes", "ملاحظات الدخول")}
                <div className="sm:col-span-2">
                  <Flash text={flash.t} tone={flash.tone} />
                  <button className={btnPrimary} disabled={busy} onClick={() => void save()}>حفظ الموقع</button>
                </div>
              </div>
            )}
            {d.locations.length === 0 ? <Empty message="لا مواقع بعد." /> : (
              <ul className="space-y-2">
                {d.locations.map((l) => (
                  <li key={l.id} className="bg-stone-950 border border-stone-800 rounded-lg p-3">
                    <div className="text-sm text-stone-100">{l.name} <Chip>{l.kind}</Chip></div>
                    <div className="text-xs text-stone-500">
                      {S(l.city)} · {S(l.contact_name)}
                      {l.contact_phone ? <> — <a className="text-red-300" href={`tel:${l.contact_phone}`}>{l.contact_phone}</a></> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={`${card} p-4 space-y-3`}>
            <div className="flex items-center gap-2">
              <h3 className="flex-1 text-sm text-stone-100">المركبات ({d.vehicles.length})</h3>
              <button className={btnGhost} onClick={() => { setMode(mode === "veh" ? "none" : "veh"); setF({}); }}>
                {mode === "veh" ? "إلغاء" : "+ مركبة"}
              </button>
            </div>
            {mode === "veh" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {field("label", "الاسم")}
                {field("plate_no", "اللوحة")}
                <label className="block">
                  <span className="block text-[11px] text-stone-400 mb-1">النوع</span>
                  <select className={fieldCls} value={f.vehicle_type ?? "car"} onChange={(e) => setF((s) => ({ ...s, vehicle_type: e.target.value }))}>
                    <option value="car">سيارة</option><option value="van">فان</option>
                    <option value="truck">شاحنة</option><option value="bus">حافلة</option>
                    <option value="motorcycle">دراجة</option><option value="other">أخرى</option>
                  </select>
                </label>
                {field("seats", "المقاعد", "number")}
                <div className="sm:col-span-2">
                  <Flash text={flash.t} tone={flash.tone} />
                  <button className={btnPrimary} disabled={busy} onClick={() => void save()}>حفظ المركبة</button>
                </div>
              </div>
            )}
            {d.vehicles.length === 0 ? <Empty message="لا مركبات بعد." /> : (
              <ul className="space-y-2">
                {d.vehicles.map((v) => (
                  <li key={v.id} className="bg-stone-950 border border-stone-800 rounded-lg p-3 text-sm text-stone-100">
                    {v.label} <span className="text-xs text-stone-500">{S(v.plate_no)} · {v.vehicle_type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {d.assets_source === "unavailable" && (
            <p className="text-[11px] text-stone-500 leading-6">
              موديول مخزون الأصول غير مطبَّق على هذه القاعدة، فاسم المعدّة يُكتب نصًّا حرًّا.
              لا يدّعي المركز تكاملًا مع المخزون قبل وجوده.
            </p>
          )}
        </div>
      )}
    </StateView>
  );
}
