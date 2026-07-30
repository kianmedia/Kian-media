"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/portal/liveops/LiveOpsCenter.tsx — لوحة العمليات المباشرة.
//
// سطح داخليّ بالكامل. العميل لا يرى هذه الشاشة في التنقّل، وإن فُتحت برابط
// مباشر فالقاعدة ترفض كلّ نداء (liveops_can_view = موظّف فقط) فتظهر «لا تملك
// صلاحية» — لا شاشة فارغة ولا ادّعاء ترحيلة ناقصة.
//
// ★ ثلاث قواعد تحكم كلّ سطر هنا ★
//   ١. لا رقم فنّيّ بلا أساسه. كلّ قيمة إدخال بشريّ، و<TelemetryBasis/> تقول
//      ذلك في كلّ مكان تُعرَض فيه. لا يوجد لون أخضر يعني «قِيس آليًّا».
//   ٢. لا زرّ يمنح صلاحية. إخفاء زرّ هنا مجاملة؛ المنع في القاعدة، ولذلك تبقى
//      رسالة الرفض ظاهرة حين ترفض القاعدة رغم ظهور الزرّ.
//   ٣. الملخّص الذي يراه العميل يُعرَض دائمًا **من نفس باني القاعدة**
//      (liveops_client_preview) لا من تركيب محلّيّ. بانيان = انحراف صامت.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  liveOpsList, liveOpsDetail, liveOpsBoard, liveOpsClientPreview,
  liveOpsSessionUpsert, liveOpsSetStatus, liveOpsInventoryUpsert, liveOpsInventorySetState,
  liveOpsHealthRecord, liveOpsRundownUpsert, liveOpsRundownSetStatus, liveOpsCueLog,
  liveOpsIncidentOpen, liveOpsIncidentUpdate, liveOpsIncidentResolve, liveOpsReleaseRootCause,
  liveOpsBulletinUpsert, liveOpsPersonUpsert, liveOpsReportUpsert, liveOpsReportApprove,
  liveOpsLinks, liveOpsLinkCreate, liveOpsLinkIssue, liveOpsLinkRevoke, liveOpsShareUrl,
  liveOpsStatusAr, liveOpsClientStatusAr, liveOpsTechAr, liveOpsCategoryAr, liveOpsRundownAr,
  liveOpsNextStates, telemetryLabelAr, hhmmss,
  type LiveOpsState, type LiveOpsSessionRow, type LiveOpsSessionDetail, type LiveOpsBoard,
  type LiveOpsClientPayload, type LiveOpsLink, type LiveOpsStatus, type LiveOpsTechStatus,
  type LiveOpsCategory, type LiveOpsHealthSource,
} from "@/lib/portal/liveOps";
import {
  LC, Card, PendingMigration, Denied, Offline, ErrorBox, Empty, Badge,
  TelemetryBasis, Val, Btn, Field, inputStyle,
} from "./LiveOpsAtoms";

type Tab = "board" | "inventory" | "health" | "rundown" | "incidents" | "client" | "report";

const TABS: { key: Tab; ar: string }[] = [
  { key: "board", ar: "الآن" },
  { key: "inventory", ar: "الجرد الفنّيّ" },
  { key: "health", ar: "الشبكة والبثّ" },
  { key: "rundown", ar: "الرَّنداون" },
  { key: "incidents", ar: "الحوادث" },
  { key: "client", ar: "سطح العميل" },
  { key: "report", ar: "تقرير ما بعد الفعالية" },
];

const CATEGORIES: LiveOpsCategory[] = [
  "camera", "operator", "audio_source", "switcher", "encoder", "stream_destination",
  "recorder", "graphics", "playback", "intercom", "internet_primary", "internet_backup",
  "power", "ups_generator", "recording_media", "backup_recording", "monitoring",
];

const TECH_STATES: LiveOpsTechStatus[] = [
  "unknown", "ready", "active", "standby", "warning", "degraded", "offline", "failed", "recovered",
];

function techTone(s: string): "dim" | "green" | "amber" | "red" {
  if (s === "active" || s === "ready" || s === "recovered") return "green";
  if (s === "warning" || s === "degraded" || s === "standby") return "amber";
  if (s === "offline" || s === "failed") return "red";
  return "dim";
}

/** One place that turns any non-ok state into the right screen. */
function StateScreen<T>({ s, children }: { s: LiveOpsState<T>; children: (d: T) => JSX.Element }) {
  if (s.state === "needs_migration") return <PendingMigration />;
  if (s.state === "denied") return <Denied message={s.message} />;
  if (s.state === "offline") return <Offline message={s.message} />;
  if (s.state === "error") return <ErrorBox message={s.message} />;
  return children(s.data);
}

export default function LiveOpsCenter() {
  const [list, setList] = useState<LiveOpsState<{ rows: LiveOpsSessionRow[]; can_manage: boolean }> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");

  const reload = useCallback(async () => {
    setList(await liveOpsList({}));
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  if (list === null) {
    return <Card><Empty what="جارٍ تحميل جلسات العمليات المباشرة…" /></Card>;
  }

  if (selected) {
    return (
      <SessionDetail
        sessionId={selected}
        onBack={() => { setSelected(null); void reload(); }}
      />
    );
  }

  return (
    <StateScreen s={list}>
      {(d) => (
        <>
          {notice && <Card><div style={{ fontSize: "12.5px", lineHeight: 1.9 }}>{notice}</div></Card>}

          <NewSession onDone={(msg) => { setNotice(msg); void reload(); }} />

          <Card
            title="جلسات العمليات المباشرة"
            note="كلّ جلسة تمثّل بثًّا أو فعالية أو مؤتمرًا أو عملًا ميدانيًّا متعدّد الكاميرات. الحالة الداخلية والحالة المعلنة للعميل حقلان منفصلان عمدًا."
          >
            {d.rows.length === 0 ? (
              <Empty
                what="لا توجد جلسات بعد."
                why="هذا صفر حقيقيّ: لم تُنشأ جلسة واحدة حتّى الآن، ولا علاقة له بصلاحياتك ولا بترحيلة ناقصة."
              />
            ) : (
              <div style={{ display: "grid", gap: "10px" }}>
                {d.rows.map((r) => (
                  <button
                    key={r.id} type="button" onClick={() => setSelected(r.id)}
                    style={{
                      textAlign: "start", border: `1px solid ${LC.line}`, background: "transparent",
                      color: LC.text, borderRadius: "6px", padding: "12px 14px", cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "13.5px" }}>{r.title}</span>
                      <Badge text={liveOpsStatusAr(r.status)} tone={r.status === "live" ? "green" : "dim"} />
                      <Badge text={`العميل يرى: ${liveOpsClientStatusAr(r.client_status)}`} tone="blue" />
                      {r.open_incidents > 0 && <Badge text={`حوادث مفتوحة: ${r.open_incidents}`} tone="red" />}
                      {r.active_links > 0 && <Badge text={`روابط عميل نشطة: ${r.active_links}`} tone="amber" />}
                      {!r.can_operate && <Badge text="قراءة فقط" tone="dim" />}
                    </div>
                    <div style={{ color: LC.dim, fontSize: "11px", marginTop: "5px" }}>
                      {r.session_code ?? "—"} · {r.venue ?? "بلا موقع مسجَّل"} ·{" "}
                      {r.starts_at ? new Date(r.starts_at).toLocaleString("ar-SA-u-nu-latn") : "بلا موعد"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </StateScreen>
  );
}

// ─── إنشاء جلسة ─────────────────────────────────────────────────────────────

function NewSession({ onDone }: { onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <div style={{ marginBottom: "16px" }}>
        <Btn tone="primary" onClick={() => setOpen(true)}>جلسة عمليات مباشرة جديدة</Btn>
      </div>
    );
  }

  return (
    <Card title="جلسة جديدة" note="تبدأ الجلسة دائمًا بحالة «مسوّدة»، وحالة العميل «مُجدوَل». لا شيء يُنشر لأحد بمجرّد الإنشاء.">
      <Field label="عنوان الفعالية"><input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="الموقع (داخليّ)"><input style={inputStyle} value={venue} onChange={(e) => setVenue(e.target.value)} /></Field>
      <Field label="البداية"><input style={inputStyle} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
      <Field label="النهاية المتوقَّعة"><input style={inputStyle} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field>
      {msg && <div style={{ margin: "8px 0" }}><ErrorBox message={msg} /></div>}
      <div style={{ display: "flex", gap: "8px" }}>
        <Btn
          tone="primary" disabled={busy || title.trim().length < 2}
          onClick={async () => {
            setBusy(true); setMsg("");
            const r = await liveOpsSessionUpsert({
              title: title.trim(), venue: venue.trim() || null,
              starts_at: startsAt ? new Date(startsAt).toISOString() : null,
              expected_end_at: endsAt ? new Date(endsAt).toISOString() : null,
            });
            setBusy(false);
            if (r.state !== "ok") { setMsg(r.message); return; }
            setOpen(false); setTitle(""); setVenue(""); setStartsAt(""); setEndsAt("");
            onDone("أُنشئت الجلسة. لم يُنشر شيء لأيّ عميل.");
          }}
        >
          إنشاء
        </Btn>
        <Btn onClick={() => { setOpen(false); setMsg(""); }}>إلغاء</Btn>
      </div>
    </Card>
  );
}

// ─── تفاصيل الجلسة ──────────────────────────────────────────────────────────

function SessionDetail({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("board");
  const [detail, setDetail] = useState<LiveOpsState<LiveOpsSessionDetail> | null>(null);
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    setDetail(await liveOpsDetail(sessionId));
  }, [sessionId]);

  useEffect(() => { void reload(); }, [reload]);

  if (detail === null) return <Card><Empty what="جارٍ التحميل…" /></Card>;

  return (
    <StateScreen s={detail}>
      {(d) => (
        <>
          <div style={{ marginBottom: "12px" }}>
            <Btn onClick={onBack}>‹ رجوع إلى الجلسات</Btn>
          </div>

          <Card>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <h2 style={{ fontSize: "16px", margin: 0 }}>{String(d.session.title)}</h2>
              <Badge text={liveOpsStatusAr(d.session.status)} tone={d.session.status === "live" ? "green" : "dim"} />
              <Badge text={`العميل يرى: ${liveOpsClientStatusAr(d.session.client_status)}`} tone="blue" />
            </div>
            <StatusChanger
              status={d.session.status}
              canOperate={d.permissions.can_operate}
              sessionId={sessionId}
              onDone={(m) => { setNotice(m); void reload(); }}
            />
            {notice && <div style={{ color: LC.dim, fontSize: "11.5px", marginTop: "8px" }}>{notice}</div>}
          </Card>

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
            {TABS.map((t) => (
              <button
                key={t.key} type="button" onClick={() => setTab(t.key)}
                style={{
                  border: `1px solid ${tab === t.key ? LC.accent : LC.line}`, background: "transparent",
                  color: LC.text, borderRadius: "999px", padding: "5px 13px",
                  fontSize: "12px", cursor: "pointer",
                }}
              >
                {t.ar}
              </button>
            ))}
          </div>

          {tab === "board" && <BoardTab sessionId={sessionId} />}
          {tab === "inventory" && <InventoryTab d={d} sessionId={sessionId} onDone={reload} />}
          {tab === "health" && <HealthTab d={d} sessionId={sessionId} onDone={reload} />}
          {tab === "rundown" && <RundownTab d={d} sessionId={sessionId} onDone={reload} />}
          {tab === "incidents" && <IncidentsTab d={d} sessionId={sessionId} onDone={reload} />}
          {tab === "client" && <ClientTab d={d} sessionId={sessionId} onDone={reload} />}
          {tab === "report" && <ReportTab d={d} sessionId={sessionId} onDone={reload} />}
        </>
      )}
    </StateScreen>
  );
}

function StatusChanger({
  status, canOperate, sessionId, onDone,
}: { status: LiveOpsStatus; canOperate: boolean; sessionId: string; onDone: (m: string) => void }) {
  const [msg, setMsg] = useState("");
  const next = liveOpsNextStates(status);

  if (!canOperate) {
    return (
      <div style={{ color: LC.dim, fontSize: "11.5px", marginTop: "10px", lineHeight: 1.9 }}>
        لست مشغّلًا لهذه الجلسة، فلا يمكنك تغيير الحالة. المنع في القاعدة لا في هذه الشاشة.
      </div>
    );
  }

  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ color: LC.dim, fontSize: "11px", marginBottom: "6px" }}>
        الانتقالات المسموحة من «{liveOpsStatusAr(status)}» — القاعدة تعيد فحصها ثمّ يعيد المُشغِّل فحصها مرّة ثالثة.
      </div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {next.length === 0 && <span style={{ color: LC.dim, fontSize: "12px" }}>لا انتقال بعد هذه الحالة.</span>}
        {next.map((s) => (
          <Btn
            key={s}
            onClick={async () => {
              setMsg("");
              const r = await liveOpsSetStatus(sessionId, s);
              if (r.state !== "ok") { setMsg(r.message); return; }
              onDone(`الحالة الآن «${liveOpsStatusAr(r.data.status)}» — والعميل يرى «${liveOpsClientStatusAr(r.data.client_status)}».`);
            }}
          >
            {liveOpsStatusAr(s)}
          </Btn>
        ))}
      </div>
      {msg && <div style={{ marginTop: "8px" }}><ErrorBox message={msg} /></div>}
    </div>
  );
}

// ─── «الآن» ────────────────────────────────────────────────────────────────

function BoardTab({ sessionId }: { sessionId: string }) {
  const [b, setB] = useState<LiveOpsState<LiveOpsBoard> | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => { const r = await liveOpsBoard(sessionId); if (alive) setB(r); };
    void run();
    const id = setInterval(run, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [sessionId]);

  if (b === null) return <Card><Empty what="جارٍ التحميل…" /></Card>;

  return (
    <StateScreen s={b}>
      {(d) => (
        <Card title="الآن" note="الأزمنة محسوبة من أوقات مسجَّلة يدويًّا (بداية فعلية، وقت بند فعليّ). ليست قياسًا من أيّ جهاز.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "14px" }}>
            <div>
              <div style={{ color: LC.dim, fontSize: "11px" }}>مضى</div>
              <div style={{ fontSize: "20px", fontVariantNumeric: "tabular-nums" }}>{hhmmss(d.elapsed_seconds)}</div>
            </div>
            <div>
              <div style={{ color: LC.dim, fontSize: "11px" }}>المتبقّي المتوقَّع</div>
              <div style={{ fontSize: "20px", fontVariantNumeric: "tabular-nums" }}>{hhmmss(d.remaining_seconds)}</div>
            </div>
            <div>
              <div style={{ color: LC.dim, fontSize: "11px" }}>الفارق عن الجدول</div>
              <div style={{ fontSize: "20px", color: d.schedule_delay_seconds > 0 ? LC.amber : LC.text }}>
                {d.schedule_delay_seconds > 0 ? `+${hhmmss(d.schedule_delay_seconds)}` : "على الجدول"}
              </div>
            </div>
            <div>
              <div style={{ color: LC.dim, fontSize: "11px" }}>حوادث مفتوحة</div>
              <div style={{ fontSize: "20px", color: d.open_incidents > 0 ? LC.red : LC.text }}>{d.open_incidents}</div>
            </div>
            <div>
              <div style={{ color: LC.dim, fontSize: "11px" }}>عناصر فنّية بحالة إنذار</div>
              <div style={{ fontSize: "20px", color: d.inventory_alarms > 0 ? LC.amber : LC.text }}>{d.inventory_alarms}</div>
            </div>
          </div>

          <div style={{ marginTop: "16px", display: "grid", gap: "10px" }}>
            <div>
              <div style={{ color: LC.dim, fontSize: "11px" }}>الفقرة الحالية</div>
              <div style={{ fontSize: "14px" }}>{d.current ? `#${d.current.item_no} — ${d.current.title}` : "لا يوجد بند على الهواء"}</div>
            </div>
            <div>
              <div style={{ color: LC.dim, fontSize: "11px" }}>الفقرة التالية</div>
              <div style={{ fontSize: "14px" }}>{d.next ? `#${d.next.item_no} — ${d.next.title}` : "لا يوجد بند تالٍ"}</div>
            </div>
          </div>

          <TelemetryBasis source={d.telemetry_connected ? "telemetry_verified" : "telemetry_not_connected"} />
        </Card>
      )}
    </StateScreen>
  );
}

// ─── الجرد الفنّيّ ──────────────────────────────────────────────────────────

function InventoryTab({
  d, sessionId, onDone,
}: { d: LiveOpsSessionDetail; sessionId: string; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<LiveOpsCategory>("camera");

  return (
    <>
      <Card
        title="الجرد الفنّيّ"
        note="⛔ لا اتصال بأيّ جهاز في هذه النسخة. كلّ حالة هنا يكتبها إنسان، و«آخر فحص» هو آخر مرّة ضغط فيها أحدهم زرًّا — لا آخر مرّة استجاب فيها الجهاز."
      >
        {d.inventory.length === 0 ? (
          <Empty what="لا توجد عناصر فنّية مسجَّلة." why="أضف الكاميرات والمُرمِّزات والاتصالات ومصادر الطاقة أدناه." />
        ) : (
          <div style={{ display: "grid", gap: "8px" }}>
            {d.inventory.map((it) => (
              <div key={it.id} style={{ border: `1px solid ${LC.line}`, borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "13px" }}>{it.label}</span>
                  <Badge text={liveOpsCategoryAr(it.category)} tone="dim" />
                  <Badge text={liveOpsTechAr(it.tech_status)} tone={techTone(it.tech_status)} />
                  {it.client_visible && <Badge text="مرئيّ للعميل" tone="amber" />}
                </div>
                {it.issue && <div style={{ color: LC.dim, fontSize: "11.5px", marginTop: "5px" }}>العطل: {it.issue}</div>}
                <TelemetryBasis source="manual_status" at={it.last_checked_at} />
                {d.permissions.can_operate && (
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "8px" }}>
                    {TECH_STATES.filter((s) => s !== it.tech_status).slice(0, 6).map((s) => (
                      <Btn
                        key={s}
                        onClick={async () => {
                          setMsg("");
                          const r = await liveOpsInventorySetState(it.id, s);
                          if (r.state !== "ok") { setMsg(r.message); return; }
                          onDone();
                        }}
                      >
                        {liveOpsTechAr(s)}
                      </Btn>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {msg && <div style={{ marginTop: "10px" }}><ErrorBox message={msg} /></div>}
      </Card>

      {d.permissions.can_operate && (
        <Card title="إضافة عنصر">
          <Field label="التصنيف">
            <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value as LiveOpsCategory)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{liveOpsCategoryAr(c)}</option>)}
            </select>
          </Field>
          <Field
            label="التسمية"
            hint="⚠️ لا تكتب رقمًا تسلسليًّا ولا عنوان شبكة هنا لو كان العنصر مرئيًّا للعميل — القاعدة سترفض الحفظ."
          >
            <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Btn
            tone="primary" disabled={label.trim().length < 1}
            onClick={async () => {
              setMsg("");
              const r = await liveOpsInventoryUpsert({ live_session_id: sessionId, category, label: label.trim() });
              if (r.state !== "ok") { setMsg(r.message); return; }
              setLabel(""); onDone();
            }}
          >
            إضافة
          </Btn>
        </Card>
      )}
    </>
  );
}

// ─── الشبكة والبثّ ──────────────────────────────────────────────────────────

function HealthTab({
  d, sessionId, onDone,
}: { d: LiveOpsSessionDetail; sessionId: string; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [source, setSource] = useState<LiveOpsHealthSource>("manual_status");
  const latest = d.health[0] ?? null;

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: string): number | null => {
    const raw = (form[k] ?? "").trim();
    if (!raw) return null;                        // ⚠️ فارغ = غير معروف، لا صفر
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <>
      <Card
        title="آخر حالة مسجَّلة"
        note="⚠️ هذه ليست قياسات. لا يوجد في هذه النسخة أيّ مسار يقرأ من مُرمِّز أو موجّه. الحقل الفارغ يعني «غير معروف» ولا يُعرَض أبدًا كصفر."
      >
        {!latest ? (
          <Empty
            what="لا توجد قراءة مسجَّلة."
            why="القياسات غير موصولة، ولم يسجّل أحد حالة يدوية بعد. لا يجوز عرض «سليم» في هذه الحالة."
          />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "12px" }}>
              <div><div style={{ color: LC.dim, fontSize: "11px" }}>الاتصال</div><div>{latest.connection === "primary" ? "رئيسيّ" : "احتياطيّ"}</div></div>
              <div><div style={{ color: LC.dim, fontSize: "11px" }}>سرعة الرفع (كب/ث)</div><Val v={latest.upload_kbps} /></div>
              <div><div style={{ color: LC.dim, fontSize: "11px" }}>الزمن (مللي ثانية)</div><Val v={latest.latency_ms} /></div>
              <div><div style={{ color: LC.dim, fontSize: "11px" }}>فقد الحزم ٪</div><Val v={latest.packet_loss_pct} /></div>
              <div><div style={{ color: LC.dim, fontSize: "11px" }}>المعدّل الحاليّ / المستهدَف</div>
                <div><Val v={latest.current_bitrate_kbps} /> / <Val v={latest.target_bitrate_kbps} /></div></div>
              <div><div style={{ color: LC.dim, fontSize: "11px" }}>المُرمِّز</div><Badge text={liveOpsTechAr(latest.encoder_state)} tone={techTone(latest.encoder_state)} /></div>
              <div><div style={{ color: LC.dim, fontSize: "11px" }}>الوجهة</div><Badge text={liveOpsTechAr(latest.destination_state)} tone={techTone(latest.destination_state)} /></div>
              <div><div style={{ color: LC.dim, fontSize: "11px" }}>التسجيل</div><Badge text={liveOpsTechAr(latest.recording_state)} tone={techTone(latest.recording_state)} /></div>
              <div><div style={{ color: LC.dim, fontSize: "11px" }}>تحويل احتياطيّ</div><div>{latest.failover_active ? "مفعَّل" : "غير مفعَّل"}</div></div>
            </div>
            <TelemetryBasis source={latest.source} at={latest.last_verified_at ?? latest.at} />
          </>
        )}
      </Card>

      {d.permissions.can_operate && (
        <Card
          title="تسجيل حالة يدوية"
          note="لا يوجد خيار «قراءة موثَّقة»: القاعدة ترفضه من هذا المسار، لأنّ لا مُحوِّل أجهزة في هذه النسخة."
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "10px" }}>
            <Field label="سرعة الرفع (كب/ث)"><input style={inputStyle} inputMode="numeric" value={form.upload_kbps ?? ""} onChange={(e) => set("upload_kbps", e.target.value)} /></Field>
            <Field label="الزمن (مللي ثانية)"><input style={inputStyle} inputMode="numeric" value={form.latency_ms ?? ""} onChange={(e) => set("latency_ms", e.target.value)} /></Field>
            <Field label="فقد الحزم ٪"><input style={inputStyle} inputMode="decimal" value={form.packet_loss_pct ?? ""} onChange={(e) => set("packet_loss_pct", e.target.value)} /></Field>
            <Field label="المعدّل الحاليّ"><input style={inputStyle} inputMode="numeric" value={form.current_bitrate_kbps ?? ""} onChange={(e) => set("current_bitrate_kbps", e.target.value)} /></Field>
            <Field label="المعدّل المستهدَف"><input style={inputStyle} inputMode="numeric" value={form.target_bitrate_kbps ?? ""} onChange={(e) => set("target_bitrate_kbps", e.target.value)} /></Field>
            <Field label="حالة المُرمِّز">
              <select style={inputStyle} value={form.encoder_state ?? "unknown"} onChange={(e) => set("encoder_state", e.target.value)}>
                {TECH_STATES.map((s) => <option key={s} value={s}>{liveOpsTechAr(s)}</option>)}
              </select>
            </Field>
            <Field label="حالة الوجهة">
              <select style={inputStyle} value={form.destination_state ?? "unknown"} onChange={(e) => set("destination_state", e.target.value)}>
                {TECH_STATES.map((s) => <option key={s} value={s}>{liveOpsTechAr(s)}</option>)}
              </select>
            </Field>
            <Field label="حالة التسجيل">
              <select style={inputStyle} value={form.recording_state ?? "unknown"} onChange={(e) => set("recording_state", e.target.value)}>
                {TECH_STATES.map((s) => <option key={s} value={s}>{liveOpsTechAr(s)}</option>)}
              </select>
            </Field>
            <Field label="المصدر" hint={telemetryLabelAr(source)}>
              <select style={inputStyle} value={source} onChange={(e) => setSource(e.target.value as LiveOpsHealthSource)}>
                <option value="manual_status">إدخال بشريّ</option>
                <option value="adapter_unavailable">مُحوِّل الأجهزة غير متاح</option>
                <option value="telemetry_not_connected">القياسات غير موصولة</option>
              </select>
            </Field>
          </div>
          {msg && <div style={{ margin: "8px 0" }}><ErrorBox message={msg} /></div>}
          <Btn
            tone="primary"
            onClick={async () => {
              setMsg("");
              const r = await liveOpsHealthRecord({
                live_session_id: sessionId,
                connection: form.connection ?? "primary",
                upload_kbps: num("upload_kbps"), latency_ms: num("latency_ms"),
                packet_loss_pct: num("packet_loss_pct"),
                current_bitrate_kbps: num("current_bitrate_kbps"),
                target_bitrate_kbps: num("target_bitrate_kbps"),
                encoder_state: form.encoder_state ?? "unknown",
                destination_state: form.destination_state ?? "unknown",
                recording_state: form.recording_state ?? "unknown",
                failover_active: form.failover_active === "true",
                source,
              });
              if (r.state !== "ok") { setMsg(r.message); return; }
              setForm({}); onDone();
            }}
          >
            تسجيل الحالة
          </Btn>
        </Card>
      )}
    </>
  );
}

// ─── الرَّنداون ─────────────────────────────────────────────────────────────

function RundownTab({
  d, sessionId, onDone,
}: { d: LiveOpsSessionDetail; sessionId: string; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const [title, setTitle] = useState("");
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Card title="الرَّنداون" note="البند لا يظهر للعميل إلّا إن وُسم صراحةً «مرئيّ للعميل». الافتراض إخفاء.">
        {d.rundown.length === 0 ? (
          <Empty what="لا توجد بنود." why="أضف البنود بترتيبها الزمنيّ أدناه." />
        ) : (
          <div style={{ display: "grid", gap: "8px" }}>
            {d.rundown.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${LC.line}`, borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: LC.dim, fontSize: "11px" }}>#{r.item_no}</span>
                  <span style={{ fontSize: "13px" }}>{r.title}</span>
                  <Badge text={liveOpsRundownAr(r.status)} tone={r.status === "on_air" ? "green" : r.status === "delayed" ? "amber" : "dim"} />
                  {r.client_visible ? <Badge text="مرئيّ للعميل" tone="amber" /> : <Badge text="داخليّ" tone="dim" />}
                  {r.delay_seconds > 0 && <Badge text={`تأخّر ${hhmmss(r.delay_seconds)}`} tone="amber" />}
                </div>
                {d.permissions.can_operate && (
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "8px" }}>
                    {(["ready", "on_air", "completed", "delayed", "skipped"] as const).map((s) => (
                      <Btn
                        key={s}
                        onClick={async () => {
                          setMsg("");
                          const x = await liveOpsRundownSetStatus(r.id, s);
                          if (x.state !== "ok") { setMsg(x.message); return; }
                          onDone();
                        }}
                      >
                        {liveOpsRundownAr(s)}
                      </Btn>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {msg && <div style={{ marginTop: "10px" }}><ErrorBox message={msg} /></div>}
      </Card>

      {d.permissions.can_operate && (
        <Card title="إضافة بند">
          <Field label="العنوان"><input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", marginBottom: "10px" }}>
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
            مرئيّ للعميل (يُفحَص نصّه ضدّ أنماط ممنوعة قبل الحفظ)
          </label>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Btn
              tone="primary" disabled={title.trim().length < 1}
              onClick={async () => {
                setMsg("");
                const r = await liveOpsRundownUpsert({ live_session_id: sessionId, title: title.trim(), client_visible: visible });
                if (r.state !== "ok") { setMsg(r.message); return; }
                setTitle(""); onDone();
              }}
            >
              إضافة
            </Btn>
            <Btn
              onClick={async () => {
                setMsg("");
                const r = await liveOpsCueLog(sessionId, "note", null, "إشارة يدوية من اللوحة");
                if (r.state !== "ok") { setMsg(r.message); return; }
                onDone();
              }}
            >
              تسجيل إشارة يدوية
            </Btn>
          </div>
        </Card>
      )}
    </>
  );
}

// ─── الحوادث ────────────────────────────────────────────────────────────────

function IncidentsTab({
  d, sessionId, onDone,
}: { d: LiveOpsSessionDetail; sessionId: string; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const [desc, setDesc] = useState("");
  const [severity, setSeverity] = useState("low");

  return (
    <>
      <Card
        title="الحوادث"
        note="الوصف والسبب الجذريّ **داخليّان دائمًا**. لا يرى العميل شيئًا إلّا ملخّصًا مكتوبًا له ومعتمَدًا من الإدارة، والسبب الجذريّ يحتاج إفراجًا منفصلًا بسبب مكتوب."
      >
        {d.incidents.length === 0 ? (
          <Empty what="لا توجد حوادث مسجَّلة." why="صفر حقيقيّ: لم تُفتح حادثة واحدة لهذه الجلسة." />
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {d.incidents.map((x) => (
              <div key={x.id} style={{ border: `1px solid ${LC.line}`, borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: LC.dim, fontSize: "11px" }}>#{x.incident_no ?? "—"}</span>
                  <Badge text={x.severity} tone={x.severity === "critical" || x.severity === "high" ? "red" : "amber"} />
                  <Badge text={x.resolved_at ? "عولجت" : "مفتوحة"} tone={x.resolved_at ? "green" : "red"} />
                  {x.client_summary_approved
                    ? <Badge text="ملخّص العميل معتمَد" tone="amber" />
                    : <Badge text="لا يراها العميل" tone="dim" />}
                  {x.root_cause_released && <Badge text="السبب الجذريّ مُفرَج عنه" tone="red" />}
                </div>
                <div style={{ fontSize: "12.5px", lineHeight: 1.9, marginTop: "6px" }}>{x.description}</div>
                {x.root_cause && (
                  <div style={{ color: LC.dim, fontSize: "11.5px", marginTop: "5px", lineHeight: 1.9 }}>
                    السبب الجذريّ (داخليّ): {x.root_cause}
                  </div>
                )}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                  {d.permissions.can_operate && !x.resolved_at && (
                    <Btn
                      onClick={async () => {
                        setMsg("");
                        const r = await liveOpsIncidentResolve(x.id);
                        if (r.state !== "ok") { setMsg(r.message); return; }
                        onDone();
                      }}
                    >
                      وضع علامة «عولجت»
                    </Btn>
                  )}
                  {d.permissions.can_manage && !x.client_summary_approved && x.client_summary && (
                    <Btn
                      onClick={async () => {
                        setMsg("");
                        const r = await liveOpsIncidentUpdate({ id: x.id, client_summary_approved: true });
                        if (r.state !== "ok") { setMsg(r.message); return; }
                        onDone();
                      }}
                    >
                      اعتماد ملخّص العميل
                    </Btn>
                  )}
                  {d.permissions.can_reveal_root_cause && x.client_summary_approved && !x.root_cause_released && x.root_cause && (
                    <Btn
                      tone="danger"
                      title="سيصير السبب الجذريّ مرئيًّا لحامل رابط العميل. يُمسَح ضدّ الأنماط الممنوعة أوّلًا."
                      onClick={async () => {
                        setMsg("");
                        const reason = typeof window !== "undefined" ? window.prompt("سبب الإفراج (يُحفَظ في التدقيق):") : null;
                        if (!reason || reason.trim().length < 3) return;
                        const r = await liveOpsReleaseRootCause(x.id, true, reason.trim());
                        if (r.state !== "ok") { setMsg(r.message); return; }
                        onDone();
                      }}
                    >
                      إفراج عن السبب الجذريّ للعميل
                    </Btn>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {msg && <div style={{ marginTop: "10px" }}><ErrorBox message={msg} /></div>}
      </Card>

      {d.permissions.can_operate && (
        <Card title="فتح حادثة" note="اكتب الوصف الداخليّ بصراحة كاملة — لا يخرج هذا النصّ إلى أيّ سطح عميل بأيّ حال.">
          <Field label="الخطورة">
            <select style={inputStyle} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="low">منخفضة</option>
              <option value="medium">متوسّطة</option>
              <option value="high">عالية</option>
              <option value="critical">حرجة</option>
            </select>
          </Field>
          <Field label="الوصف الداخليّ">
            <textarea style={{ ...inputStyle, minHeight: "80px" }} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Btn
            tone="primary" disabled={desc.trim().length < 3}
            onClick={async () => {
              setMsg("");
              const r = await liveOpsIncidentOpen({ live_session_id: sessionId, severity, description: desc.trim() });
              if (r.state !== "ok") { setMsg(r.message); return; }
              setDesc(""); onDone();
            }}
          >
            فتح
          </Btn>
        </Card>
      )}
    </>
  );
}

// ─── سطح العميل ─────────────────────────────────────────────────────────────

function ClientTab({
  d, sessionId, onDone,
}: { d: LiveOpsSessionDetail; sessionId: string; onDone: () => void }) {
  const [links, setLinks] = useState<LiveOpsState<LiveOpsLink[]> | null>(null);
  const [preview, setPreview] = useState<LiveOpsState<LiveOpsClientPayload> | null>(null);
  const [issued, setIssued] = useState<{ token: string; url: string } | null>(null);
  const [msg, setMsg] = useState("");

  const reloadLinks = useCallback(async () => { setLinks(await liveOpsLinks(sessionId)); }, [sessionId]);

  useEffect(() => {
    void reloadLinks();
    void (async () => { setPreview(await liveOpsClientPreview(sessionId)); })();
  }, [sessionId, reloadLinks]);

  return (
    <>
      <Card
        title="ما يراه العميل بالضبط"
        note="هذه ليست محاكاة: القاعدة تبني هذه الحمولة بنفس الدالّة التي تخدم حامل الرابط (liveops_client_payload). لو اختلف ما تراه هنا عمّا يراه هو، فذلك عطل لا فرق تصميم."
      >
        {preview === null ? <Empty what="جارٍ التحميل…" /> : (
          <StateScreen s={preview}>
            {(p) => (
              <div style={{ display: "grid", gap: "10px" }}>
                <div style={{ fontSize: "13px" }}>{p.event.title}</div>
                <div><Badge text={liveOpsClientStatusAr(p.event.status)} tone="blue" /></div>
                <div style={{ color: LC.dim, fontSize: "11.5px", lineHeight: 1.9 }}>
                  الفقرة الحالية: {p.segments.current?.title ?? "—"} · التالية: {p.segments.next?.title ?? "—"}
                  <br />
                  الكاميرات العاملة: {p.cameras.active} من {p.cameras.planned} (عدد فقط — بلا تسميات ولا أرقام تسلسلية)
                  <br />
                  البثّ: {p.technical.stream} · التسجيل: {p.technical.recording} · الاتصال: {p.technical.connection}
                </div>
                <TelemetryBasis source={p.technical.basis} at={p.technical.last_verified_at} />
                <div style={{ color: LC.dim, fontSize: "11px", lineHeight: 1.9 }}>
                  تنبيهات منشورة: {p.bulletins.length} · ملاحظات فنّية معتمَدة: {p.incidents.length} ·
                  أسماء معتمَدة: {p.people.length} · التقرير: {p.report ? "معتمَد ومنشور" : "غير معتمَد — لا يراه"}
                </div>
              </div>
            )}
          </StateScreen>
        )}
      </Card>

      <Card
        title="روابط المتابعة"
        note="⛔ النظام لا يرسل هذه الروابط. تُسلَّم يدويًّا. الرمز يظهر مرّة واحدة فقط ولا يُخزَّن — تُحفَظ بصمته وحدها."
      >
        {!d.permissions.can_issue_link ? (
          <Denied message="إصدار روابط المتابعة يحتاج مفتاح live_ops.client_link أو صلاحية إدارة." />
        ) : links === null ? <Empty what="جارٍ التحميل…" /> : (
          <StateScreen s={links}>
            {(rows) => (
              <>
                {issued && (
                  <div style={{
                    border: `1px solid ${LC.amber}`, background: "rgba(232,179,57,0.07)",
                    borderRadius: "6px", padding: "12px 14px", marginBottom: "12px",
                  }}>
                    <div style={{ fontSize: "12.5px", lineHeight: 1.9 }}>
                      انسخ هذا الرابط الآن — لن يُعرَض مرّة أخرى، ولا يمكن استرجاعه من القاعدة.
                    </div>
                    <code style={{
                      display: "block", marginTop: "8px", fontSize: "11px", wordBreak: "break-all",
                      color: LC.text, background: "rgba(0,0,0,0.3)", padding: "8px", borderRadius: "4px",
                    }}>
                      {issued.url}
                    </code>
                    <div style={{ color: LC.dim, fontSize: "11px", marginTop: "6px" }}>
                      سلّمه بنفسك. لا يرسل النظام بريدًا ولا رسالة.
                    </div>
                  </div>
                )}

                {rows.length === 0 ? (
                  <Empty what="لا توجد روابط." why="لم يُنشأ رابط متابعة لهذه الجلسة بعد." />
                ) : (
                  <div style={{ display: "grid", gap: "8px" }}>
                    {rows.map((l) => (
                      <div key={l.id} style={{ border: `1px solid ${LC.line}`, borderRadius: "6px", padding: "10px 12px" }}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "12.5px" }}>{l.label ?? l.recipient_org ?? "رابط بلا تسمية"}</span>
                          <Badge
                            text={l.status}
                            tone={l.status === "active" ? "green" : l.status === "revoked" ? "red" : "dim"}
                          />
                          {l.token_hint && <Badge text={`…${l.token_hint}`} tone="dim" />}
                        </div>
                        <div style={{ color: LC.dim, fontSize: "11px", marginTop: "5px" }}>
                          ينتهي: {new Date(l.expires_at).toLocaleString("ar-SA-u-nu-latn")} · فُتح {l.opens_used} مرّة
                          {l.max_opens ? ` من ${l.max_opens}` : " (بلا حدّ)"}
                        </div>
                        <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                          {l.status === "draft" && (
                            <Btn
                              tone="primary"
                              onClick={async () => {
                                setMsg("");
                                const r = await liveOpsLinkIssue(l.id);
                                if (r.state !== "ok") { setMsg(r.message); return; }
                                setIssued({ token: r.data.token, url: liveOpsShareUrl(r.data.token) });
                                await reloadLinks();
                              }}
                            >
                              إصدار الرمز (مرّة واحدة)
                            </Btn>
                          )}
                          {l.status === "active" && (
                            <Btn
                              tone="danger"
                              onClick={async () => {
                                setMsg("");
                                const reason = typeof window !== "undefined" ? window.prompt("سبب الإلغاء:") : null;
                                if (!reason || reason.trim().length < 3) return;
                                const r = await liveOpsLinkRevoke(l.id, reason.trim());
                                if (r.state !== "ok") { setMsg(r.message); return; }
                                await reloadLinks();
                              }}
                            >
                              إلغاء فوريّ
                            </Btn>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: "12px" }}>
                  <Btn
                    onClick={async () => {
                      setMsg("");
                      const r = await liveOpsLinkCreate({ live_session_id: sessionId, label: "متابعة العميل" });
                      if (r.state !== "ok") { setMsg(r.message); return; }
                      await reloadLinks();
                    }}
                  >
                    إنشاء رابط جديد (بلا رمز)
                  </Btn>
                </div>
              </>
            )}
          </StateScreen>
        )}
        {msg && <div style={{ marginTop: "10px" }}><ErrorBox message={msg} /></div>}
      </Card>

      {d.permissions.can_manage && (
        <ClientPublishing d={d} sessionId={sessionId} onDone={onDone} />
      )}
    </>
  );
}

function ClientPublishing({
  d, sessionId, onDone,
}: { d: LiveOpsSessionDetail; sessionId: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [msg, setMsg] = useState("");

  return (
    <Card
      title="ما يُنشر للعميل"
      note="كلّ نصّ هنا يمرّ بماسح أنماط في القاعدة: عنوان شبكة أو مفتاح بثّ أو رقم تسلسليّ أو مبلغ أو معرّف اتصال يُرفَض عند الحفظ، لا عند العرض."
    >
      <div style={{ marginBottom: "14px" }}>
        <div style={{ color: LC.dim, fontSize: "11px", marginBottom: "6px" }}>
          الأسماء المعتمَدة حاليًّا: {d.client_people.length === 0 ? "لا شيء" : d.client_people.map((p) => p.display_name).join("، ")}
        </div>
        <Field label="اسم مسؤول يظهر للعميل"><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="الصفة"><input style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)} /></Field>
        <Btn
          disabled={name.trim().length < 2 || role.trim().length < 2}
          onClick={async () => {
            setMsg("");
            const r = await liveOpsPersonUpsert({ live_session_id: sessionId, display_name: name.trim(), role_label: role.trim() });
            if (r.state !== "ok") { setMsg(r.message); return; }
            setName(""); setRole(""); onDone();
          }}
        >
          اعتماد الاسم
        </Btn>
      </div>

      <div style={{ borderTop: `1px solid ${LC.line}`, paddingTop: "14px" }}>
        <div style={{ color: LC.dim, fontSize: "11px", marginBottom: "6px" }}>
          تنبيهات منشورة: {d.bulletins.filter((b) => b.is_published).length} من {d.bulletins.length}
        </div>
        <Field label="عنوان التنبيه"><input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="نصّ التنبيه"><textarea style={{ ...inputStyle, minHeight: "70px" }} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <Btn
          tone="primary" disabled={title.trim().length < 2 || body.trim().length < 2}
          onClick={async () => {
            setMsg("");
            const r = await liveOpsBulletinUpsert({
              live_session_id: sessionId, title: title.trim(), body: body.trim(), is_published: true,
            });
            if (r.state !== "ok") { setMsg(r.message); return; }
            setTitle(""); setBody(""); onDone();
          }}
        >
          نشر التنبيه
        </Btn>
      </div>
      {msg && <div style={{ marginTop: "10px" }}><ErrorBox message={msg} /></div>}
    </Card>
  );
}

// ─── التقرير ────────────────────────────────────────────────────────────────

function ReportTab({
  d, sessionId, onDone,
}: { d: LiveOpsSessionDetail; sessionId: string; onDone: () => void }) {
  const rep = d.report;
  const [uptime, setUptime] = useState(rep?.uptime_pct != null ? String(rep.uptime_pct) : "");
  const [clientSummary, setClientSummary] = useState(rep?.client_summary ?? "");
  const [internalSummary, setInternalSummary] = useState(rep?.internal_summary ?? "");
  const [recording, setRecording] = useState(rep?.recording_confirmed ?? false);
  const [backup, setBackup] = useState(rep?.backup_confirmed ?? false);
  const [msg, setMsg] = useState("");

  return (
    <Card
      title="تقرير ما بعد الفعالية"
      note="⚠️ نسبة التشغيل تُحفَظ دائمًا كـ«تقدير بشريّ» ما دامت القياسات غير موصولة، وتُعرَض بهذه الصفة في كلّ سطح — بما فيه سطح العميل."
    >
      <div style={{ color: LC.dim, fontSize: "11.5px", lineHeight: 1.9, marginBottom: "12px" }}>
        الحالة: {rep ? (rep.status === "approved" ? "معتمَد" : rep.status === "pending_approval" ? "بانتظار الاعتماد" : "مسوّدة") : "لم يُنشأ بعد"}
        {rep?.uptime_basis && ` · أساس نسبة التشغيل: ${rep.uptime_basis === "telemetry_verified" ? "موثَّقة بالقياس" : "تقدير بشريّ"}`}
      </div>

      {!d.permissions.can_operate ? (
        <Denied message="تحرير التقرير يتطلّب صلاحية تشغيل هذه الجلسة." />
      ) : (
        <>
          <Field label="نسبة التشغيل ٪ (تقدير)" hint="اتركه فارغًا إن لم تكن تعرف. الفراغ يُعرَض «غير محدَّدة» ولا يُعرَض صفرًا.">
            <input style={inputStyle} inputMode="decimal" value={uptime} onChange={(e) => setUptime(e.target.value)} />
          </Field>
          <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", marginBottom: "8px" }}>
            <input type="checkbox" checked={recording} onChange={(e) => setRecording(e.target.checked)} />
            أؤكّد وجود التسجيل والتحقّق منه
          </label>
          <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", marginBottom: "12px" }}>
            <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
            أؤكّد وجود النسخة الاحتياطية والتحقّق منها
          </label>
          <Field label="ملخّص العميل" hint="إلزاميّ قبل الاعتماد. يمرّ بماسح الأنماط الممنوعة.">
            <textarea style={{ ...inputStyle, minHeight: "80px" }} value={clientSummary} onChange={(e) => setClientSummary(e.target.value)} />
          </Field>
          <Field label="الملخّص الداخليّ" hint="لا يخرج إلى أيّ سطح عميل.">
            <textarea style={{ ...inputStyle, minHeight: "80px" }} value={internalSummary} onChange={(e) => setInternalSummary(e.target.value)} />
          </Field>
          {msg && <div style={{ margin: "8px 0" }}><ErrorBox message={msg} /></div>}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Btn
              tone="primary"
              onClick={async () => {
                setMsg("");
                const n = uptime.trim() ? Number(uptime.trim()) : null;
                const r = await liveOpsReportUpsert({
                  live_session_id: sessionId,
                  uptime_pct: n !== null && Number.isFinite(n) ? n : null,
                  recording_confirmed: recording, backup_confirmed: backup,
                  client_summary: clientSummary.trim() || null,
                  internal_summary: internalSummary.trim() || null,
                });
                if (r.state !== "ok") { setMsg(r.message); return; }
                onDone();
              }}
            >
              حفظ
            </Btn>
            {d.permissions.can_approve_report && (
              <Btn
                onClick={async () => {
                  setMsg("");
                  const r = await liveOpsReportApprove(sessionId);
                  if (r.state !== "ok") { setMsg(r.message); return; }
                  onDone();
                }}
              >
                اعتماد التقرير (يصير مرئيًّا لحامل الرابط)
              </Btn>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
