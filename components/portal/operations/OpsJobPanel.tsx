"use client";
// ════════════════════════════════════════════════════════════════════════════
// OpsJobPanel — أمر العمل الواحد: كلّ ما يخصّ المهمّة في شاشة واحدة قابلة
// للاستعمال بيد واحدة على الموقع.
//
// ما تراه هنا يأتي من prodops_job_detail، وهي التي تُصفّي حسب الدور: فرد الطاقم
// لا يستقبل ملاحظات الإدارة ولا تقارير غيره أصلًا — لا يُخفيها CSS.
// ════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import {
  opsJobDetail, opsJobSetStatus, opsHseSeed, opsBackupStep, opsCallSheetPublish,
  opsConfirmAttendance, opsDailyReportUpsert, opsPostHandoffProgress, opsLookups,
  JOB_TYPE_AR, JOB_STATUS_AR, JOB_STATUS_COLOR, PRIORITY_AR, CREW_ROLE_AR, CREW_STATUS_AR,
  PERMIT_STATUS_AR, EQUIP_STATUS_AR, HSE_STATUS_AR, CONFLICT_AR,
  opsDateTime, opsDate, opsTime, opsIsoDay,
  type OpsJobDetail, type OpsChildKind, type OpsLookups, type OpsJobStatus, type OpsRow,
} from "@/lib/portal/opsCenter";
import {
  card, btnGhost, btnPrimary, fieldCls, Chip, Flash, ReadinessBar, Section,
  StateView, useOpsLoad, Empty,
} from "./OpsAtoms";
import OpsChildForm, { FIELDS } from "./OpsChildForm";

const S = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));

const NEXT_STATUS: Record<OpsJobStatus, OpsJobStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["confirmed", "draft", "on_hold", "cancelled"],
  confirmed: ["in_progress", "scheduled", "on_hold", "cancelled"],
  in_progress: ["completed", "on_hold", "cancelled"],
  on_hold: ["scheduled", "confirmed", "in_progress", "cancelled"],
  completed: ["in_progress"],
  cancelled: [],
};

export default function OpsJobPanel({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const { st, reload } = useOpsLoad<OpsJobDetail>(() => opsJobDetail(jobId), [jobId]);
  const { st: lkSt } = useOpsLoad<OpsLookups>(() => opsLookups(), []);
  const lookups = lkSt && lkSt.state === "ok" ? lkSt.data : null;

  return (
    <div className="space-y-4">
      <button className={btnGhost} onClick={onBack}>← رجوع إلى القائمة</button>
      <StateView st={st} onRetry={reload}>
        {(d) => <JobBody d={d} lookups={lookups} reload={reload} />}
      </StateView>
    </div>
  );
}

function JobBody({ d, lookups, reload }: { d: OpsJobDetail; lookups: OpsLookups | null; reload: () => void }) {
  const job = d.job as Record<string, unknown>;
  const jobId = String(job.id ?? "");
  const status = String(job.status ?? "draft") as OpsJobStatus;
  const canManage = d.can_manage;
  const [flash, setFlash] = useState<{ t: string; tone: "ok" | "bad" }>({ t: "", tone: "ok" });
  const [editing, setEditing] = useState<{ kind: OpsChildKind; row: OpsRow | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const myCrew = useMemo(
    () => d.crew.find((c) => c.user_id && c.user_id === d.user_id) ?? null,
    [d.crew, d.user_id],
  );

  const run = async (p: Promise<{ state: string; message?: string }>, okMsg: string) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (r.state === "ok") { setFlash({ t: okMsg, tone: "ok" }); reload(); }
    else setFlash({ t: r.message ?? "تعذّر التنفيذ.", tone: "bad" });
  };

  const childSection = (kind: OpsChildKind, title: string, rows: OpsRow[], render: (r: OpsRow) => React.ReactNode) => (
    <Section
      title={title}
      count={rows.length}
      action={canManage ? (
        <button className="text-xs text-red-300 min-h-[44px] px-2" onClick={() => setEditing({ kind, row: null })}>
          + إضافة
        </button>
      ) : undefined}
    >
      {editing?.kind === kind && (
        <OpsChildForm
          kind={kind} jobId={jobId} row={editing.row} lookups={lookups}
          onDone={() => { setEditing(null); reload(); }}
          onCancel={() => setEditing(null)}
        />
      )}
      {rows.length === 0 ? <Empty message={`لا ${FIELDS[kind].ar} بعد.`} /> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={String(r.id)} className="bg-stone-950 border border-stone-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 text-sm text-stone-200 leading-6">{render(r)}</div>
                {canManage && (
                  <button
                    className="text-xs text-stone-400 min-h-[44px] px-2 shrink-0"
                    onClick={() => setEditing({ kind, row: r })}
                  >
                    تعديل
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );

  return (
    <div className="space-y-4">
      {/* ─── الرأس ─── */}
      <div className={`${card} p-4 space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{S(job.job_code)}</Chip>
          <Chip>{JOB_TYPE_AR[String(job.job_type) as keyof typeof JOB_TYPE_AR] ?? S(job.job_type)}</Chip>
          <span className={`text-xs ${JOB_STATUS_COLOR[status] ?? "text-stone-300"}`}>
            {JOB_STATUS_AR[status] ?? status}
          </span>
          <Chip tone={job.priority === "urgent" ? "bad" : job.priority === "high" ? "warn" : "neutral"}>
            {PRIORITY_AR[String(job.priority)] ?? S(job.priority)}
          </Chip>
        </div>
        <h2 className="text-lg text-stone-50 leading-7">{S(job.title)}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-stone-400">
          <div>من: {opsDateTime(job.scheduled_start as string)}</div>
          <div>إلى: {opsDateTime(job.scheduled_end as string)}</div>
          <div>الموقع: {S((d.location?.name as string) ?? job.location_note)}</div>
          <div>العميل: {S(job.client_label)}</div>
          {job.project_id ? (
            <div className="sm:col-span-2">
              المشروع المرتبط: {S(job.project_name)}
              <span className="text-[11px] text-stone-600"> (عرض فقط — لا يتأثّر بشيء هنا)</span>
            </div>
          ) : null}
        </div>
        {d.location?.contact_name ? (
          <p className="text-sm text-stone-300">
            مسؤول الموقع: {S(d.location.contact_name)}
            {d.location.contact_phone ? (
              <a className="text-red-300 ms-2" href={`tel:${String(d.location.contact_phone)}`}>
                {String(d.location.contact_phone)}
              </a>
            ) : null}
          </p>
        ) : null}
        <div className="pt-1">
          <div className="text-[11px] text-stone-500 mb-1">
            الجاهزية ({d.readiness.passed ?? 0}/{d.readiness.required ?? 0} من الفحوص الإلزامية)
          </div>
          <ReadinessBar score={d.readiness.score ?? 0} />
        </div>
      </div>

      <Flash text={flash.t} tone={flash.tone} />

      {/* ─── تأكيد الحضور — الفعل الأوّل الذي يحتاجه من على الموقع ─── */}
      {myCrew && (
        <div className={`${card} p-4 space-y-3`}>
          <h3 className="text-sm text-stone-100">حضوري</h3>
          <p className="text-sm text-stone-400">
            دوري: {CREW_ROLE_AR[String(myCrew.crew_role)] ?? S(myCrew.crew_role)} ·
            وقت الحضور: {opsTime(myCrew.call_time as string)} ·
            الحالة: {CREW_STATUS_AR[String(myCrew.status)] ?? S(myCrew.status)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={btnPrimary} disabled={busy}
              onClick={() => void run(opsConfirmAttendance(jobId, "confirmed"), "تأكيد الحضور مسجَّل.")}>
              أؤكّد الحضور
            </button>
            <button className={btnGhost} disabled={busy}
              onClick={() => void run(opsConfirmAttendance(jobId, "attended"), "سُجّل حضورك.")}>
              حضرت الآن
            </button>
            <button className={`${btnGhost} text-amber-300`} disabled={busy}
              onClick={() => void run(opsConfirmAttendance(jobId, "declined"), "سُجّل اعتذارك.")}>
              أعتذر
            </button>
          </div>
        </div>
      )}

      {/* ─── حالة المهمّة (المدير) ─── */}
      {canManage && (
        <div className={`${card} p-4 space-y-2`}>
          <h3 className="text-sm text-stone-100">حالة المهمّة</h3>
          {NEXT_STATUS[status].length === 0 ? (
            <p className="text-sm text-stone-500">لا انتقال ممكن من الحالة الحالية.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {NEXT_STATUS[status].map((s) => (
                <button key={s} className={btnGhost} disabled={busy}
                  onClick={() => void run(opsJobSetStatus(jobId, s), `الحالة الآن: ${JOB_STATUS_AR[s]}`)}>
                  {JOB_STATUS_AR[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── التعارضات ─── */}
      {d.conflicts.length > 0 && (
        <div className={`${card} p-4 space-y-2 border-amber-900`}>
          <h3 className="text-sm text-amber-300">تعارضات على هذه المهمّة ({d.conflicts.length})</h3>
          <ul className="space-y-1 text-sm text-stone-300">
            {d.conflicts.map((c, i) => (
              <li key={i}>
                <Chip tone="warn">{CONFLICT_AR[c.kind] ?? c.kind}</Chip>{" "}
                {c.ar} — {S(c.job_a_code)} ↔ {S(c.job_b_code)} ({opsDateTime(c.overlap_from)})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── الجاهزية بالتفصيل ─── */}
      <Section title="تفاصيل الجاهزية" count={d.readiness.checks?.length ?? 0}>
        <ul className="space-y-1 text-sm">
          {(d.readiness.checks ?? []).map((c) => (
            <li key={c.key} className="flex items-center gap-2">
              <span className={c.ok ? "text-emerald-400" : c.required ? "text-red-400" : "text-stone-500"}>
                {c.ok ? "✓" : "✗"}
              </span>
              <span className="text-stone-300">{c.ar}</span>
              {!c.required && <Chip>اختياريّ</Chip>}
            </li>
          ))}
        </ul>
      </Section>

      {childSection("crew", "الطاقم", d.crew, (r) => (
        <>
          <div className="text-stone-100">
            {S(r.external_name) !== "—" ? S(r.external_name) : S(r.user_id).slice(0, 8)}
            <span className="text-stone-500"> · {CREW_ROLE_AR[String(r.crew_role)] ?? S(r.crew_role)}</span>
          </div>
          <div className="text-xs text-stone-500">
            الحضور: {opsTime(r.call_time as string)} · {CREW_STATUS_AR[String(r.status)] ?? S(r.status)}
            {r.external_phone ? <> · <a className="text-red-300" href={`tel:${String(r.external_phone)}`}>{String(r.external_phone)}</a></> : null}
          </div>
        </>
      ))}

      {childSection("equipment", "المعدّات", d.equipment, (r) => (
        <>
          <div className="text-stone-100">{S(r.asset_label) !== "—" ? S(r.asset_label) : S(r.asset_id).slice(0, 8)} × {S(r.quantity)}</div>
          <div className="text-xs text-stone-500">
            {EQUIP_STATUS_AR[String(r.status)] ?? S(r.status)}
            {r.custody_assignment_id ? " · مرتبطة بتسليم عهدة" : ""}
            {r.custody_reservation_id ? " · مرتبطة بحجز مخزون" : ""}
          </div>
        </>
      ))}

      {childSection("permit", "التصاريح والموافقات", d.permits, (r) => (
        <>
          <div className="text-stone-100">{S(r.authority_name)} — {S(r.reference_no)}</div>
          <div className="text-xs text-stone-500">
            {PERMIT_STATUS_AR[String(r.status)] ?? S(r.status)} · ينتهي: {opsDate(r.expires_at as string)}
          </div>
        </>
      ))}

      {childSection("travel", "السفر", d.travel, (r) => (
        <>
          <div className="text-stone-100">{S(r.from_place)} ← {S(r.to_place)}</div>
          <div className="text-xs text-stone-500">{opsDateTime(r.depart_at as string)} · {S(r.booking_ref)}</div>
        </>
      ))}

      {childSection("accommodation", "السكن", d.accommodation, (r) => (
        <>
          <div className="text-stone-100">{S(r.hotel_name)} — {S(r.city)}</div>
          <div className="text-xs text-stone-500">{opsDate(r.check_in as string)} → {opsDate(r.check_out as string)} · {S(r.rooms)} غرفة</div>
        </>
      ))}

      {childSection("vehicle_assignment", "المركبات", d.vehicles, (r) => (
        <>
          <div className="text-stone-100">{S(r.vehicle_label) !== "—" ? S(r.vehicle_label) : S(r.vehicle_id).slice(0, 8)}</div>
          <div className="text-xs text-stone-500">السائق: {S(r.driver_name)} · {opsDateTime(r.depart_at as string)}</div>
        </>
      ))}

      <Section
        title="قائمة السلامة (HSE)"
        count={d.hse.length}
        action={canManage ? (
          <button className="text-xs text-red-300 min-h-[44px] px-2" disabled={busy}
            onClick={() => void run(opsHseSeed(jobId), "أُضيفت بنود السلامة الافتراضية.")}>
            بذر القائمة
          </button>
        ) : undefined}
      >
        {editing?.kind === "hse" && (
          <OpsChildForm kind="hse" jobId={jobId} row={editing.row} lookups={lookups}
            onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
        )}
        {d.hse.length === 0 ? <Empty message="لا بنود سلامة بعد — ابذر القائمة الافتراضية." /> : (
          <ul className="space-y-2">
            {d.hse.map((h) => (
              <li key={String(h.id)} className="flex items-center gap-2 bg-stone-950 border border-stone-800 rounded-lg p-3">
                <span className={h.status === "ok" ? "text-emerald-400" : h.status === "issue" ? "text-red-400" : "text-stone-500"}>
                  {h.status === "ok" ? "✓" : h.status === "issue" ? "!" : "•"}
                </span>
                <span className="flex-1 text-sm text-stone-200">{S(h.item_ar)}</span>
                <Chip tone={h.status === "ok" ? "good" : h.status === "issue" ? "bad" : "neutral"}>
                  {HSE_STATUS_AR[String(h.status)] ?? S(h.status)}
                </Chip>
                {canManage && (
                  <button className="text-xs text-stone-400 min-h-[44px] px-2" onClick={() => setEditing({ kind: "hse", row: h })}>
                    تعديل
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {childSection("weather", "الطقس (إدخال يدويّ)", d.weather, (r) => (
        <>
          <div className="text-stone-100">{opsDate(r.for_date as string)} — {S(r.condition)}</div>
          <div className="text-xs text-stone-500">
            {S(r.temp_c)}°م · رياح {S(r.wind_kph)} كم/س · مطر {S(r.precip_pct)}٪ · مصدر: يدويّ
          </div>
        </>
      ))}

      {/* ─── المادّة: بطاقات + نسخ احتياطي + رفع ─── */}
      {childSection("media_card", "بطاقات الذاكرة", d.media_cards, (r) => (
        <>
          <div className="text-stone-100">{S(r.card_label)} — {S(r.card_type)} {S(r.capacity_gb)}GB</div>
          <div className="text-xs text-stone-500">الحالة: {S(r.status)} · بحوزة: {S(r.holder_name)}</div>
        </>
      ))}

      <Section title="قائمة النسخ الاحتياطي" count={d.media_cards.length}>
        {d.media_cards.length === 0 ? <Empty message="أضف بطاقة ذاكرة أوّلًا." /> : (
          <ul className="space-y-2">
            {d.media_cards.map((cRow) => {
              const b = d.backups.find((x) => x.card_id === cRow.id) ?? {};
              const steps: { k: "primary" | "second" | "nas" | "verified"; ar: string; done: boolean }[] = [
                { k: "primary", ar: "نسخة أولى", done: b.primary_done === true },
                { k: "second", ar: "نسخة ثانية", done: b.second_done === true },
                { k: "nas", ar: "نسخة NAS", done: b.nas_done === true },
                { k: "verified", ar: "تحقُّق", done: b.verified === true },
              ];
              return (
                <li key={String(cRow.id)} className="bg-stone-950 border border-stone-800 rounded-lg p-3 space-y-2">
                  <div className="text-sm text-stone-100">{S(cRow.card_label)}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {steps.map((s) => (
                      <button
                        key={s.k}
                        disabled={busy}
                        className={`min-h-[44px] rounded-lg text-xs border px-2 ${
                          s.done ? "bg-emerald-950/60 text-emerald-300 border-emerald-900"
                                 : "bg-stone-900 text-stone-300 border-stone-700"}`}
                        onClick={() => void run(
                          opsBackupStep(String(cRow.id), s.k, !s.done),
                          s.done ? `أُلغيت خطوة «${s.ar}».` : `سُجّلت خطوة «${s.ar}».`,
                        )}
                      >
                        {s.done ? "✓ " : ""}{s.ar}
                      </button>
                    ))}
                  </div>
                  {!(b.primary_done === true && b.second_done === true) && (
                    <p className="text-[11px] text-amber-400">
                      التحقّق لا يُقبل قبل وجود نسختين — القاعدة ترفضه، لا الواجهة.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {childSection("ingest", "الرفع والاستيعاب", d.ingest, (r) => (
        <>
          <div className="text-stone-100">{S(r.target)} — {S(r.status)}</div>
          <div className="text-xs text-stone-500">{opsDateTime(r.started_at as string)} · {S(r.total_gb)}GB</div>
        </>
      ))}

      {/* ─── ما بعد الإنتاج ─── */}
      <Section
        title="تسليم ما بعد الإنتاج"
        count={d.post_handoff.length}
        action={canManage ? (
          <button className="text-xs text-red-300 min-h-[44px] px-2" onClick={() => setEditing({ kind: "post_handoff", row: null })}>
            + إضافة
          </button>
        ) : undefined}
      >
        {editing?.kind === "post_handoff" && (
          <OpsChildForm kind="post_handoff" jobId={jobId} row={editing.row} lookups={lookups}
            onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
        )}
        {d.post_handoff.length === 0 ? <Empty message="لا تسليم بعد." /> : (
          <ul className="space-y-2">
            {d.post_handoff.map((h) => {
              const mine = h.handed_to_user_id === d.user_id;
              return (
                <li key={String(h.id)} className="bg-stone-950 border border-stone-800 rounded-lg p-3 space-y-2">
                  <div className="text-sm text-stone-100">{S(h.handed_to_name) !== "—" ? S(h.handed_to_name) : "مونتير"}</div>
                  <div className="text-xs text-stone-500">
                    الحالة: {S(h.status)} · التسليم المتوقّع: {opsDate(h.expected_delivery as string)}
                  </div>
                  {S(h.brief) !== "—" && <p className="text-sm text-stone-300 leading-6">{S(h.brief)}</p>}
                  {(mine || canManage) && (
                    <div className="flex flex-wrap gap-2">
                      {(["accepted", "in_progress", "returned", "done"] as const).map((s) => (
                        <button key={s} className={btnGhost} disabled={busy}
                          onClick={() => void run(opsPostHandoffProgress(String(h.id), s), "حُدِّثت حالة التسليم.")}>
                          {s === "accepted" ? "استلمت" : s === "in_progress" ? "قيد العمل" : s === "returned" ? "أعدته" : "أنجزت"}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <DailyReport d={d} jobId={jobId} onSaved={reload} />

      {childSection("incident", "الحوادث", d.incidents, (r) => (
        <>
          <div className="text-stone-100">{S(r.incident_type)} — {S(r.severity)}</div>
          <div className="text-xs text-stone-500">{opsDateTime(r.occurred_at as string)} · {S(r.status)}</div>
          <p className="text-sm text-stone-300 leading-6">{S(r.description)}</p>
        </>
      ))}

      {childSection("delay", "أسباب التأخير", d.delays, (r) => (
        <>
          <div className="text-stone-100">{S(r.delay_reason)} — {S(r.minutes_lost)} دقيقة</div>
          <div className="text-xs text-stone-500">{opsDateTime(r.occurred_at as string)}</div>
        </>
      ))}

      <Section
        title="Call Sheets"
        count={d.call_sheets.length}
        action={canManage ? (
          <button className="text-xs text-red-300 min-h-[44px] px-2" onClick={() => setEditing({ kind: "call_sheet", row: null })}>
            + إضافة
          </button>
        ) : undefined}
      >
        {editing?.kind === "call_sheet" && (
          <OpsChildForm kind="call_sheet" jobId={jobId} row={editing.row} lookups={lookups}
            onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
        )}
        {d.call_sheets.length === 0 ? <Empty message="لا Call Sheet بعد." /> : (
          <ul className="space-y-2">
            {d.call_sheets.map((cs) => (
              <li key={String(cs.id)} className="bg-stone-950 border border-stone-800 rounded-lg p-3 space-y-2">
                <div className="text-sm text-stone-100">
                  {opsDate(cs.sheet_date as string)} — نسخة {S(cs.version)}{" "}
                  <Chip tone={cs.status === "published" ? "good" : "neutral"}>
                    {cs.status === "published" ? "منشورة" : "مسوّدة"}
                  </Chip>
                </div>
                <div className="text-xs text-stone-500">
                  الحضور العامّ: {opsTime(cs.general_call_time as string)} · مستشفى: {S(cs.hospital_name)}
                </div>
                {canManage && cs.status === "draft" && (
                  <div className="flex gap-2">
                    <button className={btnPrimary} disabled={busy}
                      onClick={() => void run(opsCallSheetPublish(String(cs.id)), "نُشرت الورقة.")}>
                      نشر
                    </button>
                    <button className={btnGhost} onClick={() => setEditing({ kind: "call_sheet", row: cs })}>تعديل</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** التقرير اليوميّ: كلٌّ يكتب تقريره هو. الخادم يرفض تحرير تقرير غيرك. */
function DailyReport({ d, jobId, onSaved }: { d: OpsJobDetail; jobId: string; onSaved: () => void }) {
  const mine = d.daily_reports.find((r) => r.prepared_by === d.user_id) ?? null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ t: string; tone: "ok" | "bad" }>({ t: "", tone: "ok" });
  const [f, setF] = useState<Record<string, string>>(() => ({
    report_date: String(mine?.report_date ?? opsIsoDay()),
    shots_planned: mine?.shots_planned == null ? "" : String(mine.shots_planned),
    shots_done: mine?.shots_done == null ? "" : String(mine.shots_done),
    crew_present: mine?.crew_present == null ? "" : String(mine.crew_present),
    weather_note: String(mine?.weather_note ?? ""),
    summary: String(mine?.summary ?? ""),
    issues: String(mine?.issues ?? ""),
    next_day_plan: String(mine?.next_day_plan ?? ""),
  }));
  const submitted = mine?.status === "submitted";

  const save = async (status: "draft" | "submitted") => {
    setBusy(true);
    const r = await opsDailyReportUpsert({ job_id: jobId, ...f, status, id: mine?.id ?? null });
    setBusy(false);
    if (r.state === "ok") { setFlash({ t: status === "submitted" ? "أُرسل التقرير." : "حُفظت المسوّدة.", tone: "ok" }); onSaved(); }
    else setFlash({ t: r.message, tone: "bad" });
  };

  return (
    <Section title="التقرير اليوميّ" count={d.daily_reports.length}>
      {d.daily_reports.length > 0 && (
        <ul className="space-y-2">
          {d.daily_reports.map((r) => (
            <li key={String(r.id)} className="bg-stone-950 border border-stone-800 rounded-lg p-3">
              <div className="text-sm text-stone-100">
                {opsDate(r.report_date as string)}{" "}
                <Chip tone={r.status === "submitted" ? "good" : "neutral"}>
                  {r.status === "submitted" ? "مُرسَل" : "مسوّدة"}
                </Chip>
              </div>
              <div className="text-xs text-stone-500">
                لقطات: {S(r.shots_done)}/{S(r.shots_planned)} · حضور: {S(r.crew_present)}
              </div>
              {S(r.summary) !== "—" && <p className="text-sm text-stone-300 leading-6 mt-1">{S(r.summary)}</p>}
            </li>
          ))}
        </ul>
      )}
      {submitted ? (
        <p className="text-xs text-stone-500">تقريرك مُرسَل ولا يُعدَّل. تواصل مع مدير التشغيل لفتحه.</p>
      ) : (
        <>
          <button className={btnGhost} onClick={() => setOpen((o) => !o)}>
            {open ? "إخفاء النموذج" : mine ? "متابعة تقريري" : "كتابة تقريري"}
          </button>
          {open && (
            <div className="space-y-3 bg-stone-950 border border-stone-700 rounded-xl p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  ["report_date", "التاريخ", "date"],
                  ["shots_planned", "لقطات مخطّطة", "number"],
                  ["shots_done", "لقطات منجزة", "number"],
                  ["crew_present", "عدد الحاضرين", "number"],
                  ["weather_note", "ملاحظة الطقس", "text"],
                ] as const).map(([k, ar, type]) => (
                  <label key={k} className="block">
                    <span className="block text-[11px] text-stone-400 mb-1">{ar}</span>
                    <input className={fieldCls} type={type} value={f[k] ?? ""}
                      onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} />
                  </label>
                ))}
              </div>
              {([["summary", "ملخّص اليوم"], ["issues", "المشكلات"], ["next_day_plan", "خطة الغد"]] as const).map(([k, ar]) => (
                <label key={k} className="block">
                  <span className="block text-[11px] text-stone-400 mb-1">{ar}</span>
                  <textarea className={`${fieldCls} min-h-[76px]`} rows={3} value={f[k] ?? ""}
                    onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} />
                </label>
              ))}
              <Flash text={flash.t} tone={flash.tone} />
              <div className="flex flex-wrap gap-2">
                <button className={btnGhost} disabled={busy} onClick={() => void save("draft")}>حفظ كمسوّدة</button>
                <button className={btnPrimary} disabled={busy} onClick={() => void save("submitted")}>إرسال</button>
              </div>
              <p className="text-[11px] text-stone-500">بعد الإرسال لا يمكن التعديل.</p>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
