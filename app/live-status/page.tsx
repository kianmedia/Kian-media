"use client";
// ════════════════════════════════════════════════════════════════════════════
// /live-status — the ONLY external-facing surface of the live operations module.
//
// ★ The token lives in the URL FRAGMENT (after #) ★ A fragment is never sent to
// the server, never appears in an access log, and is never forwarded in the
// Referer header when the recipient clicks a link. Putting it in a query string
// would leak it into all three. The page reads it from `location.hash` and
// POSTs it in the request body.
//
// WHAT THIS PAGE CAN SHOW — and it is a closed list, decided in the database:
//   event status · current and remaining time · current and next segment ·
//   a SAFE count of active cameras · general stream / recording / connection
//   status · approved responsible names · published bulletins · the approved
//   final report.
//
// ⛔ WHAT IT CAN NEVER SHOW: IP addresses, stream keys, credentials, internal
//    incidents, sensitive failure detail, internal usernames, storage paths,
//    equipment serial numbers, costs, internal notes, backup topology.
//    This page does not "hide" them — it never receives them. The whitelist is
//    public.liveops_client_payload, and this file renders only what arrives.
//
// ⚠️ HONEST TECHNICAL STATE. Every technical badge carries its basis. There is
//    no path in this system that produces a live measurement, so the page says
//    «القياسات غير موصولة» / «إدخال بشريّ» rather than implying instrumentation.
//    A missing value renders «غير معروف», never 0 and never "OK".
//
// ⚠️ Before the SQL is applied this page says so honestly, and it never renders
//    a fake event or a misleading empty state.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";

interface Segment { title: string; scheduled_at: string | null; status: string }

interface Payload {
  ok: true;
  event: {
    title: string; status: string;
    starts_at: string | null; expected_end_at: string | null;
    elapsed_seconds: number | null; remaining_seconds: number | null;
    schedule_delay_seconds: number; notes: string | null;
  };
  segments: { current: Segment | null; next: Segment | null };
  cameras: { active: number; planned: number };
  technical: {
    stream: string; recording: string; connection: string;
    basis: string; telemetry_connected: boolean; last_verified_at: string | null;
  };
  people: { name: string; role: string }[];
  bulletins: { level: string; title: string; body: string; at: string }[];
  incidents: { at: string; summary: string; resolved: boolean; root_cause: string | null }[];
  report: {
    approved_at: string; summary: string | null; incident_summary: string | null;
    planned_start_at: string | null; planned_end_at: string | null;
    actual_start_at: string | null; actual_end_at: string | null;
    uptime_pct: number | null; uptime_basis: string;
    interruptions_count: number; interruption_minutes: number;
    recording_confirmed: boolean; backup_confirmed: boolean;
    destinations: string | null; delivered_files: string | null;
  } | null;
  expires_at?: string;
  opens_left?: number | null;
}

// ⚠️ «لم تُفعَّل بعد» ليست «رابط خاطئ». الخلط بينهما يجعل المتلقّي يظنّ أنّ من
//    أرسل له أخطأ، بينما السبب عندنا نحن.
const ERR_AR: Record<string, string> = {
  pending_migration: "هذه الخدمة لم تُفعَّل بعد على الخادم. تواصل مع من شارك الرابط معك.",
  server_not_configured: "الخدمة غير مهيّأة حاليًا. تواصل مع من شارك الرابط معك.",
  upstream_error: "تعذّر الوصول إلى الخادم الآن. حاول بعد قليل.",
  rate_limited: "محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثمّ حاول.",
  bad_request: "طلب غير مكتمل.",
  network: "تعذّر الاتصال بالشبكة.",
};

const STATUS_AR: Record<string, string> = {
  scheduled: "مُجدوَل",
  preparing: "قيد التحضير",
  on_air: "على الهواء",
  paused: "استراحة",
  on_air_with_issues: "على الهواء مع ملاحظات فنّية",
  interrupted: "متوقّف مؤقّتًا",
  completed: "انتهى",
};

const TECH_AR: Record<string, string> = {
  nominal: "سليم", degraded: "أداء منخفض", interrupted: "منقطع",
  recording: "يُسجَّل", stopped: "متوقّف", unknown: "غير معروف",
};

const BASIS_AR: Record<string, string> = {
  manual_status: "إدخال بشريّ — ليست قراءة من الجهاز",
  adapter_unavailable: "مُحوِّل الأجهزة غير متاح",
  telemetry_not_connected: "القياسات غير موصولة",
  telemetry_verified: "قراءة موثَّقة من مُحوِّل",
};

const C = {
  bg: "#0b0b0d",
  card: "rgba(255,255,255,0.04)",
  line: "rgba(255,255,255,0.12)",
  text: "#f2f2f2",
  dim: "rgba(255,255,255,0.55)",
  accent: "#e31e24",
  warn: "#e8b339",
  ok: "#4bb96a",
};

function clock(total: number | null | undefined): string {
  if (total === null || total === undefined) return "—";
  const s = Math.max(0, Math.floor(total));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function fmtTime(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
  } catch { return d; }
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("ar-SA-u-nu-latn", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch { return d; }
}

function techColor(v: string): string {
  if (v === "nominal" || v === "recording") return C.ok;
  if (v === "degraded") return C.warn;
  if (v === "interrupted" || v === "stopped") return C.accent;
  return C.dim;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.line}`, borderRadius: 14,
      padding: "16px 18px", marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9.5, letterSpacing: "1.6px", textTransform: "uppercase",
      color: "rgba(255,255,255,0.4)", marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

export default function LiveStatusPage() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "denied" | "error">("idle");
  const [data, setData] = useState<Payload | null>(null);
  const [message, setMessage] = useState<string>("");
  const [refreshedAt, setRefreshedAt] = useState<string>("");

  // The fragment is read on the client only; it is never part of any request URL.
  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    setToken(raw ? decodeURIComponent(raw) : "");
  }, []);

  const load = useCallback(async (tk: string, silent: boolean) => {
    if (!silent) setState("loading");
    let j: Record<string, unknown> | null = null;
    try {
      const res = await fetch("/api/public/live-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tk }),
        cache: "no-store",
      });
      j = (await res.json()) as Record<string, unknown>;
    } catch {
      j = null;
    }
    if (!j) {
      if (!silent) { setState("error"); setMessage(ERR_AR.network); }
      return;
    }
    if (j.ok === true) {
      setData(j as unknown as Payload);
      setState("ready");
      setRefreshedAt(new Date().toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      return;
    }
    if (typeof j.error === "string") {
      if (!silent) { setState("error"); setMessage(ERR_AR[j.error] ?? "تعذّر فتح الرابط."); }
      return;
    }
    // ⛔ ONE message for every denial. The server already refuses to tell us
    //    whether the token is unknown, expired, revoked or exhausted, and this
    //    page must not invent a distinction the server deliberately removed.
    if (!silent) {
      setState("denied");
      setMessage("هذا الرابط غير صالح أو انتهت صلاحيته.");
    }
  }, []);

  useEffect(() => {
    if (token === null) return;
    if (!token) {
      setState("denied");
      setMessage("لا يوجد رمز في هذا الرابط. تأكّد من نسخ الرابط كاملًا.");
      return;
    }
    void load(token, false);
  }, [token, load]);

  // A gentle poll while the event is running. Every refresh spends one "open"
  // only if the link is counted — the database decides; the page never assumes.
  useEffect(() => {
    if (state !== "ready" || !token || !data) return;
    const live = data.event.status === "on_air" || data.event.status === "on_air_with_issues"
      || data.event.status === "paused" || data.event.status === "interrupted";
    if (!live) return;
    const id = setInterval(() => { void load(token, true); }, 60_000);
    return () => clearInterval(id);
  }, [state, token, data, load]);

  return (
    <main dir="rtl" style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      padding: "28px 16px 56px", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        {state === "loading" && (
          <Card><div style={{ color: C.dim, fontSize: 13 }}>جارٍ فتح حالة الفعالية…</div></Card>
        )}

        {(state === "denied" || state === "error") && (
          <Card>
            <Eyebrow>حالة الفعالية</Eyebrow>
            <div style={{ fontSize: 14, lineHeight: 2 }}>{message}</div>
          </Card>
        )}

        {state === "ready" && data && (
          <>
            {/* ─── الحدث ─────────────────────────────────────────────── */}
            <Card>
              <Eyebrow>حالة الفعالية</Eyebrow>
              <h1 style={{ fontSize: "clamp(20px,4vw,28px)", margin: "0 0 10px", lineHeight: 1.35 }}>
                {data.event.title}
              </h1>
              <div style={{
                display: "inline-block", padding: "5px 12px", borderRadius: 999,
                border: `1px solid ${C.line}`, fontSize: 12.5,
              }}>
                {STATUS_AR[data.event.status] ?? data.event.status}
              </div>

              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                gap: 12, marginTop: 16,
              }}>
                <div>
                  <div style={{ color: C.dim, fontSize: 11 }}>مضى من الفعالية</div>
                  <div style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>
                    {clock(data.event.elapsed_seconds)}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.dim, fontSize: 11 }}>المتبقّي المتوقَّع</div>
                  <div style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>
                    {clock(data.event.remaining_seconds)}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.dim, fontSize: 11 }}>الفارق عن الجدول</div>
                  <div style={{
                    fontSize: 20, fontVariantNumeric: "tabular-nums",
                    color: data.event.schedule_delay_seconds > 0 ? C.warn : C.text,
                  }}>
                    {data.event.schedule_delay_seconds > 0
                      ? `+${clock(data.event.schedule_delay_seconds)}`
                      : "على الجدول"}
                  </div>
                </div>
              </div>

              {data.event.notes && (
                <p style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.95, marginTop: 14, marginBottom: 0 }}>
                  {data.event.notes}
                </p>
              )}
            </Card>

            {/* ─── الفقرات ───────────────────────────────────────────── */}
            <Card>
              <Eyebrow>الفقرة الحالية والتالية</Eyebrow>
              {!data.segments.current && !data.segments.next ? (
                <div style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.95 }}>
                  لا توجد فقرات معلنة لهذه الفعالية.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <div style={{ color: C.dim, fontSize: 11 }}>الآن</div>
                    <div style={{ fontSize: 15 }}>
                      {data.segments.current ? data.segments.current.title : "—"}
                    </div>
                    {data.segments.current?.scheduled_at && (
                      <div style={{ color: C.dim, fontSize: 11.5 }}>
                        الوقت المجدوَل: {fmtTime(data.segments.current.scheduled_at)}
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ color: C.dim, fontSize: 11 }}>التالي</div>
                    <div style={{ fontSize: 15 }}>
                      {data.segments.next ? data.segments.next.title : "—"}
                    </div>
                    {data.segments.next?.scheduled_at && (
                      <div style={{ color: C.dim, fontSize: 11.5 }}>
                        الوقت المجدوَل: {fmtTime(data.segments.next.scheduled_at)}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>

            {/* ─── الحالة الفنّية العامّة ─────────────────────────────── */}
            <Card>
              <Eyebrow>الحالة الفنّية العامّة</Eyebrow>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12,
              }}>
                <div>
                  <div style={{ color: C.dim, fontSize: 11 }}>البثّ</div>
                  <div style={{ fontSize: 15, color: techColor(data.technical.stream) }}>
                    {TECH_AR[data.technical.stream] ?? data.technical.stream}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.dim, fontSize: 11 }}>التسجيل</div>
                  <div style={{ fontSize: 15, color: techColor(data.technical.recording) }}>
                    {TECH_AR[data.technical.recording] ?? data.technical.recording}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.dim, fontSize: 11 }}>الاتصال</div>
                  <div style={{ fontSize: 15, color: techColor(data.technical.connection) }}>
                    {TECH_AR[data.technical.connection] ?? data.technical.connection}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.dim, fontSize: 11 }}>الكاميرات العاملة</div>
                  <div style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>
                    {data.cameras.active} / {data.cameras.planned}
                  </div>
                </div>
              </div>

              {/* ★★ لا رقم ولا حالة فنّية بلا أساسها. هذا السطر ليس تجميلًا. */}
              <div style={{
                marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}`,
                color: C.dim, fontSize: 11.5, lineHeight: 1.9,
              }}>
                مصدر هذه الحالات: {BASIS_AR[data.technical.basis] ?? BASIS_AR.telemetry_not_connected}
                {data.technical.last_verified_at
                  ? ` — آخر تحديث بشريّ: ${fmtDate(data.technical.last_verified_at)}`
                  : " — لا يوجد تحديث مسجَّل بعد"}
                .
                <br />
                لا يوجد اتصال مباشر بأجهزة البثّ في هذه النسخة، فلا تُقرأ هذه الحالات كقياسات آلية.
              </div>
            </Card>

            {/* ─── التنبيهات المنشورة ────────────────────────────────── */}
            {data.bulletins.length > 0 && (
              <Card>
                <Eyebrow>تنبيهات منشورة</Eyebrow>
                <div style={{ display: "grid", gap: 12 }}>
                  {data.bulletins.map((b, i) => (
                    <div key={i} style={{
                      borderRight: `3px solid ${b.level === "warning" ? C.warn : C.line}`,
                      paddingRight: 12,
                    }}>
                      <div style={{ fontSize: 14 }}>{b.title}</div>
                      <div style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.9 }}>{b.body}</div>
                      <div style={{ color: C.dim, fontSize: 11 }}>{fmtDate(b.at)}</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* ─── ملاحظات فنّية معتمَدة ─────────────────────────────── */}
            {data.incidents.length > 0 && (
              <Card>
                <Eyebrow>ملاحظات فنّية معتمَدة</Eyebrow>
                <div style={{ display: "grid", gap: 12 }}>
                  {data.incidents.map((x, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 13.5, lineHeight: 1.9 }}>{x.summary}</div>
                      {/* يظهر السبب فقط حين يُفرَج عنه صراحةً بقرار إداريّ. */}
                      {x.root_cause && (
                        <div style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.9 }}>
                          السبب: {x.root_cause}
                        </div>
                      )}
                      <div style={{ color: C.dim, fontSize: 11 }}>
                        {fmtDate(x.at)} — {x.resolved ? "عولجت" : "قيد المعالجة"}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* ─── المسؤولون المعتمَدون ──────────────────────────────── */}
            {data.people.length > 0 && (
              <Card>
                <Eyebrow>المسؤولون</Eyebrow>
                <div style={{ display: "grid", gap: 8 }}>
                  {data.people.map((p, i) => (
                    <div key={i} style={{ fontSize: 13.5 }}>
                      {p.name} — <span style={{ color: C.dim }}>{p.role}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* ─── التقرير النهائيّ المعتمَد ─────────────────────────── */}
            {data.report && (
              <Card>
                <Eyebrow>التقرير النهائيّ</Eyebrow>
                {data.report.summary && (
                  <p style={{ fontSize: 13.5, lineHeight: 2, marginTop: 0 }}>{data.report.summary}</p>
                )}
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12,
                  marginTop: 8,
                }}>
                  <div>
                    <div style={{ color: C.dim, fontSize: 11 }}>البداية (مخطَّطة / فعلية)</div>
                    <div style={{ fontSize: 13 }}>
                      {fmtTime(data.report.planned_start_at)} / {fmtTime(data.report.actual_start_at)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: C.dim, fontSize: 11 }}>النهاية (مخطَّطة / فعلية)</div>
                    <div style={{ fontSize: 13 }}>
                      {fmtTime(data.report.planned_end_at)} / {fmtTime(data.report.actual_end_at)}
                    </div>
                  </div>
                  <div>
                    {/* ⚠️ نسبة التشغيل لا تُعرَض عارية أبدًا. */}
                    <div style={{ color: C.dim, fontSize: 11 }}>نسبة التشغيل</div>
                    <div style={{ fontSize: 13 }}>
                      {data.report.uptime_pct === null || data.report.uptime_pct === undefined
                        ? "غير محدَّدة"
                        : `${data.report.uptime_pct}٪ — ${
                            data.report.uptime_basis === "telemetry_verified"
                              ? "موثَّقة بالقياس" : "تقدير بشريّ لا قياس آليّ"}`}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: C.dim, fontSize: 11 }}>الانقطاعات</div>
                    <div style={{ fontSize: 13 }}>
                      {data.report.interruptions_count} — {data.report.interruption_minutes} دقيقة
                    </div>
                  </div>
                  <div>
                    <div style={{ color: C.dim, fontSize: 11 }}>تأكيد التسجيل</div>
                    <div style={{ fontSize: 13, color: data.report.recording_confirmed ? C.ok : C.dim }}>
                      {data.report.recording_confirmed ? "مؤكَّد" : "غير مؤكَّد"}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: C.dim, fontSize: 11 }}>تأكيد النسخة الاحتياطية</div>
                    <div style={{ fontSize: 13, color: data.report.backup_confirmed ? C.ok : C.dim }}>
                      {data.report.backup_confirmed ? "مؤكَّدة" : "غير مؤكَّدة"}
                    </div>
                  </div>
                </div>
                {data.report.destinations && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: C.dim, fontSize: 11 }}>وجهات البثّ</div>
                    <div style={{ fontSize: 13, lineHeight: 1.9 }}>{data.report.destinations}</div>
                  </div>
                )}
                {data.report.delivered_files && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: C.dim, fontSize: 11 }}>الملفّات المسلَّمة</div>
                    <div style={{ fontSize: 13, lineHeight: 1.9 }}>{data.report.delivered_files}</div>
                  </div>
                )}
                {data.report.incident_summary && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: C.dim, fontSize: 11 }}>ملخّص الملاحظات الفنّية</div>
                    <div style={{ fontSize: 13, lineHeight: 1.9 }}>{data.report.incident_summary}</div>
                  </div>
                )}
                <div style={{ color: C.dim, fontSize: 11, marginTop: 12 }}>
                  اعتُمد في {fmtDate(data.report.approved_at)}
                </div>
              </Card>
            )}

            <div style={{ color: C.dim, fontSize: 11, lineHeight: 1.9, textAlign: "center", marginTop: 18 }}>
              {refreshedAt && <>آخر تحديث للصفحة: {refreshedAt}<br /></>}
              {data.expires_at && <>تنتهي صلاحية هذا الرابط في {fmtDate(data.expires_at)}.<br /></>}
              هذه الصفحة للمتابعة فقط ولا تُغيّر شيئًا في الفعالية.
            </div>
          </>
        )}
      </div>
    </main>
  );
}
