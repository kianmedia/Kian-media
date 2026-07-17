"use client";
// ════════════════════════════════════════════════════════════════════════
// §5 Scoped employee dashboard. Everything shown here comes from a single
// SECURITY DEFINER RPC (employee_dashboard) that scopes rows to auth.uid() and
// the caller's professions — the client never asks for anything it may not see,
// and financial data is never part of the payload.
// ════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  getEmployeeDashboard, updateTaskStatus,
  type EmployeeDashboard as Dash, type DashTask,
} from "@/lib/portal/professions";

const STATUS = { todo: { ar: "قائمة", en: "To do" }, in_progress: { ar: "قيد التنفيذ", en: "In progress" }, blocked: { ar: "معطّلة", en: "Blocked" }, in_review: { ar: "قيد المراجعة", en: "In review" }, done: { ar: "منجزة", en: "Done" }, cancelled: { ar: "ملغاة", en: "Cancelled" } } as const;

export default function EmployeeDashboard() {
  const { t } = useI18n();
  const [d, setD] = useState<Dash | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await getEmployeeDashboard();
    if (r.ok) { setD(r.data); setPhase("ready"); } else { setErr(r.error); setPhase("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (phase === "loading") return <p className="text-white/45" style={{ fontSize: "13px" }}>{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return <p style={{ fontSize: "13px", color: "#ff8a8e" }}>{t({ ar: "تعذّر التحميل: ", en: "Couldn't load: " })}{err}</p>;
  const x = d!;
  const empty = <span className="text-white/35" style={{ fontSize: "12px" }}>{t({ ar: "لا شيء.", en: "Nothing here." })}</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* urgent strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "8px" }}>
        <Stat n={x.due_today.length} label={t({ ar: "مستحقة اليوم", en: "Due today" })} c="rgba(255,210,138,0.9)" />
        <Stat n={x.overdue.length} label={t({ ar: "متأخرة", en: "Overdue" })} c="#ff8a8e" />
        <Stat n={x.my_tasks.length} label={t({ ar: "مهامي المفتوحة", en: "My open tasks" })} c="#7CFC9A" />
        <Stat n={x.comments_requiring_action.length} label={t({ ar: "تعليقات تنتظرني", en: "Comments for me" })} c="rgba(255,255,255,0.75)" />
      </div>

      <Bucket title={t({ ar: "مهامي", en: "My Tasks" })}>
        {x.my_tasks.length === 0 ? empty : x.my_tasks.map((tk) => <TaskRow key={tk.id} tk={tk} editable onChanged={load} t={t} />)}
      </Bucket>

      <Bucket title={t({ ar: "مهام مهنتي", en: "Profession Tasks" })} hint={t({ ar: "مهام متاحة لمهنتك يمكنك متابعتها", en: "Open to your profession" })}>
        {x.profession_tasks.length === 0 ? empty : x.profession_tasks.map((tk) => <TaskRow key={tk.id} tk={tk} onChanged={load} t={t} showProfession />)}
      </Bucket>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "12px" }}>
        <Bucket title={t({ ar: "مستحقة اليوم", en: "Due Today" })}>
          {x.due_today.length === 0 ? empty : x.due_today.map((tk) => <TaskRow key={tk.id} tk={tk} onChanged={load} t={t} compact />)}
        </Bucket>
        <Bucket title={t({ ar: "متأخرة", en: "Overdue" })}>
          {x.overdue.length === 0 ? empty : x.overdue.map((tk) => <TaskRow key={tk.id} tk={tk} onChanged={load} t={t} compact overdue />)}
        </Bucket>
      </div>

      <Bucket title={t({ ar: "جلسات تصوير قادمة", en: "Upcoming Shoots" })}>
        {x.upcoming_shoots.length === 0 ? empty : x.upcoming_shoots.map((s) => (
          <Link key={s.id} href={`/client-portal/project-core?p=${s.project_id}`} className="block" style={rowS}>
            <div className="flex justify-between gap-2 flex-wrap">
              <span className="text-white" style={{ fontSize: "13px", fontWeight: 600 }}>{s.title}</span>
              <span className="f-sans" style={{ fontSize: "11px", color: "rgba(255,210,138,0.9)" }} dir="ltr">{s.session_date}{s.call_time ? ` · ${new Date(s.call_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
            </div>
            <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>{s.project_name}{s.location ? ` · ${s.location}` : ""}</div>
          </Link>
        ))}
      </Bucket>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "12px" }}>
        <Bucket title={t({ ar: "ملفات أحتاجها", en: "Files I Need" })}>
          {x.files_i_need.length === 0 ? empty : x.files_i_need.map((f) => (
            <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer" className="block" style={rowS}>
              <span className="text-white" style={{ fontSize: "12.5px" }}>{f.file_name ?? t({ ar: "ملف", en: "File" })}</span>
              <div className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)", marginTop: "2px" }}>{f.task_title}</div>
            </a>
          ))}
        </Bucket>
        <Bucket title={t({ ar: "تعليقات تنتظر ردّي", en: "Comments Requiring My Action" })}>
          {x.comments_requiring_action.length === 0 ? empty : x.comments_requiring_action.map((c) => (
            <Link key={c.id} href={`/client-portal/project-core?p=${c.project_id}`} className="block" style={rowS}>
              <div className="text-white/85" style={{ fontSize: "12.5px", lineHeight: 1.5 }} dir="auto">{c.body}</div>
              <div className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)", marginTop: "3px" }}>{c.author_name ?? "—"} · {c.task_title}</div>
            </Link>
          ))}
        </Bucket>
      </div>

      <Bucket title={t({ ar: "إجراءات العهدة", en: "Custody Actions" })} hint={t({ ar: "عهد بانتظار تأكيدك أو إرجاعك", en: "Awaiting your confirmation or return" })}>
        {x.custody_actions.length === 0 ? empty : x.custody_actions.map((a) => (
          <Link key={a.id} href="/client-portal/asset-custody" className="block" style={rowS}>
            <div className="flex justify-between gap-2 flex-wrap">
              <span className="text-white" style={{ fontSize: "12.5px" }} dir="ltr">{a.assignment_number}</span>
              <span className="f-sans" style={{ fontSize: "11px", color: "rgba(255,210,138,0.9)" }}>{a.status}</span>
            </div>
            {a.expected_return_at && <div className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)", marginTop: "2px" }} dir="ltr">{new Date(a.expected_return_at).toLocaleDateString()}</div>}
          </Link>
        ))}
      </Bucket>
    </div>
  );
}

type Tf = (m: { ar: string; en: string }) => string;
const rowS: React.CSSProperties = { background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "9px 11px", textDecoration: "none", marginBottom: "6px" };

function Stat({ n, label, c }: { n: number; label: string; c: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "12px 14px" }}>
      <div style={{ fontSize: "26px", fontWeight: 700, color: c, lineHeight: 1 }}>{n}</div>
      <div className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.5)", marginTop: "5px", letterSpacing: "0.3px" }}>{label}</div>
    </div>
  );
}

function Bucket({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "5px", padding: "13px 15px" }}>
      <div className="flex items-baseline justify-between mb-2.5">
        <h3 className="text-white" style={{ fontSize: "13.5px", fontWeight: 700 }}>{title}</h3>
        {hint && <span className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TaskRow({ tk, editable, showProfession, compact, overdue, onChanged, t }: { tk: DashTask; editable?: boolean; showProfession?: boolean; compact?: boolean; overdue?: boolean; onChanged: () => void; t: Tf }) {
  const [busy, setBusy] = useState(false);
  async function set(status: string) {
    if (busy) return; setBusy(true);
    const r = await updateTaskStatus(tk.id, status);
    setBusy(false);
    if (r.ok) onChanged();
  }
  return (
    <div style={rowS}>
      <div className="flex justify-between gap-2 flex-wrap items-center">
        <Link href={`/client-portal/project-core?p=${tk.project_id}`} className="text-white" style={{ fontSize: "12.5px", fontWeight: 600, textDecoration: "none" }}>{tk.title}</Link>
        <div className="flex items-center gap-2 flex-wrap">
          {tk.due_date && <span className="f-sans" style={{ fontSize: "10.5px", color: overdue ? "#ff8a8e" : "rgba(255,255,255,0.5)" }} dir="ltr">{tk.due_date}</span>}
          {editable ? (
            <select value={tk.status} disabled={busy} onChange={(e) => set(e.target.value)} className="f-sans"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "3px", color: "#fff", fontSize: "10.5px", padding: "3px 5px", colorScheme: "dark" }}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          ) : (
            <span className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)" }}>{t(STATUS[tk.status as keyof typeof STATUS] ?? STATUS.todo)}</span>
          )}
        </div>
      </div>
      {!compact && <div className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)", marginTop: "3px" }}>{tk.project_name}{showProfession && tk.profession ? ` · ${tk.profession}` : ""}</div>}
    </div>
  );
}
