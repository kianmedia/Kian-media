"use client";
// ════════════════════════════════════════════════════════════════════════
// WhatsApp Inbox (Phase 4) — conversation list + chat-style detail + triage.
//
// Auth: reuses the portal localStorage session. RLS decides which rows load;
// this UI only gates the page (plain client/lead → access denied) and shows
// triage controls to owner/manager. Sending is DISABLED in Phase 1.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { getValidSession, getMyProfile, currentUserId } from "@/lib/portal/auth";
import { caps as deriveCaps } from "@/lib/portal/roles";
import type { Profile } from "@/lib/portal/types";
import {
  listConversations, listContactsByIds, listMessages, listNotes, listAssignments,
  listAssignableStaff, setConversation, assignConversation, addNote,
  setSalesStage, sendReply, syncZoho, setDepartment, markRead, getConversation,
  getSendStatus, type SendDiagnostic,
  listQuoteRequests, createQuoteRequest, startConversation, getMyAlert, setMyAlert,
} from "@/lib/whatsapp/inbox";
import {
  WA_STATUS_LABELS, WA_CATEGORY_LABELS, WA_PRIORITY_LABELS,
  WA_STATUS_ORDER, WA_CATEGORY_ORDER, WA_PRIORITY_ORDER,
  WA_SALES_STAGE_LABELS, WA_SALES_STAGE_ORDER,
  WA_DEPARTMENT_LABELS, WA_DEPARTMENT_ORDER, WA_QUOTE_STATUS_LABELS,
  type WaConversation, type WaContact, type WaMessage, type WaInternalNote,
  type WaAssignment, type WaStatus, type WaSalesStage, type WaDepartment,
  type WaQuoteRequest, type WaQuoteStatus,
} from "@/lib/whatsapp/types";
import type { WaCategory, WaPriority } from "@/lib/whatsapp/classify";

type Staff = Pick<Profile, "id" | "full_name" | "email" | "staff_role" | "account_type">;
type Phase = "loading" | "auth" | "denied" | "error" | "ready";

const ACCENT = "#25D366"; // WhatsApp green for in-tool accents
const RED = "#E31E24";

// Preview/dev-only diagnostics. NODE_ENV is "production" on Vercel Preview builds,
// so also honor an explicit NEXT_PUBLIC_WA_DEBUG=1 flag to surface logs there.
const WA_DEBUG =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_WA_DEBUG === "1";

const FILTER_SELECT: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8, padding: "9px 12px", color: "#fff", fontSize: 13,
};

const STATUS_COLOR: Record<WaStatus, string> = {
  new: "#E31E24", open: "#25D366", assigned: "#3b82f6",
  pending: "#f59e0b", closed: "#6b7280", spam: "#9333ea",
};
const PRIORITY_COLOR: Record<WaPriority, string> = {
  low: "#6b7280", normal: "#9ca3af", high: "#f59e0b", urgent: "#E31E24",
};

function timeAgo(iso: string | null, isAr: boolean): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return isAr ? "الآن" : "now";
  const m = Math.floor(s / 60);
  if (m < 60) return isAr ? `${m} د` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return isAr ? `${h} س` : `${h}h`;
  const day = Math.floor(h / 24);
  if (day < 7) return isAr ? `${day} ي` : `${day}d`;
  return new Date(iso).toLocaleDateString(isAr ? "ar" : "en");
}

function staffName(s: Staff): string {
  return s.full_name || s.email || s.id.slice(0, 8);
}

const ALERTS_LS = "kian_wa_alerts";

/** Short in-browser beep (WebAudio; no asset). Best-effort. */
function playBeep() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    o.start(); o.stop(ctx.currentTime + 0.3);
    o.onended = () => ctx.close();
  } catch { /* no audio context — ignore */ }
}

function desktopNotify(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch { /* ignore */ }
}

export default function WhatsAppInbox() {
  const { t, isAr } = useI18n();
  const params = useSearchParams();

  const [phase, setPhase] = useState<Phase>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState("");

  const [convs, setConvs] = useState<WaConversation[]>([]);
  const [contacts, setContacts] = useState<Record<string, WaContact>>({});
  const [staff, setStaff] = useState<Staff[]>([]);

  const [fStatus, setFStatus] = useState<WaStatus | "">("");
  const [fCategory, setFCategory] = useState<WaCategory | "">("");
  const [fDepartment, setFDepartment] = useState<WaDepartment | "">("");
  const [fSalesStage, setFSalesStage] = useState<WaSalesStage | "">("");
  const [fPriority, setFPriority] = useState<WaPriority | "">("");
  const [fAssigned, setFAssigned] = useState<string>("");   // user id | "__me__"
  const [fUnread, setFUnread] = useState(false);
  const [search, setSearch] = useState("");

  const [selId, setSelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [notes, setNotes] = useState<WaInternalNote[]>([]);
  const [assignments, setAssignments] = useState<WaAssignment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [syncingZoho, setSyncingZoho] = useState(false);
  const [sendDiag, setSendDiag] = useState<SendDiagnostic | null>(null);
  const [alertsOn, setAlertsOn] = useState(false);
  const [quotes, setQuotes] = useState<WaQuoteRequest[]>([]);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startForm, setStartForm] = useState({ phone: "", name: "", company: "", department: "sales_marketing", reason: "", template: "welcome_followup_ar", variables: "" });
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertPhone, setAlertPhone] = useState("");
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const caps = useMemo(
    () => (profile ? deriveCaps(profile) : null),
    [profile],
  );
  const canTriage = !!caps && (caps.isOwner || caps.view === "manager");
  const myId = currentUserId();

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2600); };
  const unreadBaselineRef = useRef<number | null>(null);

  // Sound/desktop alert preference (per-user, localStorage).
  useEffect(() => {
    try { setAlertsOn(localStorage.getItem(ALERTS_LS) === "1"); } catch {}
  }, []);
  function toggleAlerts() {
    const next = !alertsOn;
    setAlertsOn(next);
    try { localStorage.setItem(ALERTS_LS, next ? "1" : "0"); } catch {}
    if (next && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }

  // ── Bootstrap auth ────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const session = await getValidSession();
      if (!session) { if (alive) setPhase("auth"); return; }
      const r = await getMyProfile();
      if (!alive) return;
      if (!r.ok) { setErr(r.error); setPhase(r.status === 401 ? "auth" : "error"); return; }
      if (!r.data) { setErr("profile_missing"); setPhase("error"); return; }
      const c = deriveCaps(r.data);
      if (c.isClientSide) { setProfile(r.data); setPhase("denied"); return; }
      setProfile(r.data);
      setPhase("ready");
    })();
    return () => { alive = false; };
  }, []);

  // ── Load conversation list ────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    const r = await listConversations({
      status: fStatus, category: fCategory, department: fDepartment,
      salesStage: fSalesStage, priority: fPriority,
      assignedTo: fAssigned === "__me__" ? (myId ?? "") : fAssigned,
      unreadOnly: fUnread,
    });
    // Surface read failures instead of silently rendering "0 conversations"
    // (e.g. a missing table grant or RLS denial returns ok:false here).
    if (!r.ok) { setErr(r.error); setConvs([]); return; }
    setErr("");
    setConvs(r.data);
    const cr = await listContactsByIds(r.data.map((c) => c.contact_id));
    if (cr.ok) {
      const map: Record<string, WaContact> = {};
      for (const ct of cr.data) map[ct.id] = ct;
      setContacts(map);
    }
  }, [fStatus, fCategory, fDepartment, fSalesStage, fPriority, fAssigned, fUnread, myId]);

  useEffect(() => {
    if (phase !== "ready") return;
    void loadList();
    void getSendStatus().then(setSendDiag);
    if (canTriage) listAssignableStaff().then((r) => { if (r.ok) setStaff(r.data); });
  }, [phase, loadList, canTriage]);

  // Light polling so new inbound messages surface without a manual refresh.
  useEffect(() => {
    if (phase !== "ready") return;
    const id = window.setInterval(() => { void loadList(); }, 45000);
    return () => window.clearInterval(id);
  }, [phase, loadList]);

  // ── Deep-link: ?conversation=<id> opens that thread ───────────────────────
  useEffect(() => {
    const q = params.get("conversation");
    if (q && q !== selId) setSelId(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // ── Load detail for the selected conversation ─────────────────────────────
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    const [m, n, a, q] = await Promise.all([listMessages(id), listNotes(id), listAssignments(id), listQuoteRequests(id)]);
    if (m.ok) setMessages(m.data);
    if (n.ok) setNotes(n.data);
    if (a.ok) setAssignments(a.data);
    // Always set quotes (reset to [] on error) so a failed/empty load never leaves
    // stale cards from a previously-opened conversation.
    setQuotes(q.ok ? q.data : []);
    setQuotesError(q.ok ? null : q.error);
    if (WA_DEBUG) {
      // Preview/dev diagnostics: conversation id + returned count + any query error.
      console.log(`[WA quotes] conversation=${id} ok=${q.ok} count=${q.ok ? q.data.length : "ERR"}`,
        q.ok ? "" : `error=${q.error}`);
    }
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (!selId) { setMessages([]); setNotes([]); setAssignments([]); setQuotes([]); setQuotesError(null); return; }
    void loadDetail(selId);
    // Resolve a deep-linked conversation that isn't in the current (filtered)
    // list — so notification links ALWAYS open the thread, not a blank panel.
    if (!convs.some((c) => c.id === selId)) {
      void getConversation(selId).then((r) => {
        if (r.ok && r.data) {
          const row = r.data;
          setConvs((prev) => (prev.some((c) => c.id === row.id) ? prev : [row, ...prev]));
          listContactsByIds([row.contact_id]).then((cr) => {
            if (cr.ok && cr.data[0]) setContacts((prev) => ({ ...prev, [cr.data[0].id]: cr.data[0] }));
          });
        }
      });
    }
    // Mark the conversation read on open.
    void markRead(selId).then((r) => {
      if (r.ok) setConvs((prev) => prev.map((c) => (c.id === selId ? { ...c, unread_count: 0 } : c)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, loadDetail]);

  const selected = useMemo(() => convs.find((c) => c.id === selId) || null, [convs, selId]);
  const selectedContact = selected ? contacts[selected.contact_id] : undefined;

  // ── Filtered + searched list ──────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return convs;
    return convs.filter((c) => {
      const ct = contacts[c.contact_id];
      const hay = [
        ct?.display_name, ct?.phone, ct?.wa_id, c.last_message_preview, c.ai_summary,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [convs, contacts, search]);

  // Unread total across conversations the viewer can see (RLS-filtered), and a
  // real-time alert when it rises (a new incoming message arrived). Throttled to
  // one alert per poll cycle; silent on first load.
  const unreadTotal = useMemo(() => convs.reduce((n, c) => n + (c.unread_count || 0), 0), [convs]);
  useEffect(() => {
    if (phase !== "ready") return;
    const base = unreadBaselineRef.current;
    unreadBaselineRef.current = unreadTotal;
    if (base !== null && unreadTotal > base) {
      flash(t({ ar: "رسالة واتساب جديدة", en: "New WhatsApp message" }));
      if (alertsOn) {
        playBeep();
        desktopNotify(
          t({ ar: "رسالة واتساب جديدة", en: "New WhatsApp message" }),
          t({ ar: "لديك رسالة جديدة في صندوق واتساب", en: "New message in the WhatsApp inbox" }),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadTotal, phase]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  async function patchConv(patch: { status?: WaStatus; category?: WaCategory; priority?: WaPriority }) {
    if (!selected) return;
    setBusy(true);
    const r = await setConversation({ conversationId: selected.id, ...patch });
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر الحفظ: " : "Save failed: ") + r.error); return; }
    setConvs((prev) => prev.map((c) => (c.id === selected.id ? { ...c, ...patch } : c)));
    flash(isAr ? "تم الحفظ" : "Saved");
  }

  async function patchSalesStage(stage: WaSalesStage) {
    if (!selected) return;
    setBusy(true);
    const r = await setSalesStage(selected.id, stage);
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر الحفظ: " : "Save failed: ") + r.error); return; }
    setConvs((prev) => prev.map((c) => (c.id === selected.id ? { ...c, sales_stage: stage } : c)));
    flash(isAr ? "تم تحديث مرحلة المبيعات" : "Sales stage updated");
    // Best-effort: keep Zoho's Lead_Status in sync. No-op when Zoho is unconfigured.
    void syncZoho(selected.id).then((z) => { if (z.ok) void loadDetail(selected.id); });
  }

  async function patchDepartment(dept: WaDepartment) {
    if (!selected) return;
    setBusy(true);
    const r = await setDepartment(selected.id, dept);
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر الحفظ: " : "Save failed: ") + r.error); return; }
    setConvs((prev) => prev.map((c) => (c.id === selected.id ? { ...c, assigned_department: dept } : c)));
    flash(isAr ? "تم تحديث القسم" : "Department updated");
  }

  async function pushZoho() {
    if (!selected) return;
    setSyncingZoho(true);
    const z = await syncZoho(selected.id);
    setSyncingZoho(false);
    if (!z.ok) {
      flash(z.error === "zoho_not_configured"
        ? (isAr ? "Zoho غير مُهيّأ بعد" : "Zoho not configured yet")
        : (isAr ? "تعذّرت المزامنة: " : "Sync failed: ") + z.error);
      return;
    }
    await loadDetail(selected.id);
    setConvs((prev) => prev.map((c) => (c.id === selected.id ? { ...c, crm_lead_id: z.crmLeadId } : c)));
    flash(z.action === "insert"
      ? (isAr ? "أُنشئ عميل محتمل في Zoho" : "Lead created in Zoho")
      : (isAr ? "حُدّث العميل في Zoho" : "Lead updated in Zoho"));
  }

  function quoteLink(): string {
    if (!selected) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "https://www.kianmedia.com";
    return `${origin}/quote-request?source=whatsapp&conversation=${selected.id}`;
  }
  async function createQuote() {
    if (!selected) return;
    setBusy(true);
    const r = await createQuoteRequest({
      conversationId: selected.id,
      fullName: selectedContact?.display_name ?? undefined,
      category: selected.category,
    });
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر إنشاء الطلب: " : "Create failed: ") + r.error); return; }
    await loadDetail(selected.id);
    flash(isAr ? "أُنشئ طلب عرض سعر" : "Quote request created");
  }
  async function copyQuoteLink() {
    try { await navigator.clipboard.writeText(quoteLink()); flash(isAr ? "نُسخ الرابط" : "Link copied"); }
    catch { flash(isAr ? "تعذّر النسخ" : "Copy failed"); }
  }
  async function sendQuoteLink() {
    if (!selected) return;
    const body = (isAr ? "لإكمال عرض السعر يرجى تعبئة النموذج: " : "To complete your quote please fill the form: ") + quoteLink();
    await submitReply(body);
  }

  async function doStartConversation() {
    setStarting(true);
    const vars = startForm.variables.split("|").map((v) => v.trim()).filter(Boolean);
    const r = await startConversation({
      phone: startForm.phone, name: startForm.name, company: startForm.company,
      department: startForm.department, reason: startForm.reason, template: startForm.template, variables: vars,
      preview: `[${startForm.template}] ${startForm.name}`.trim(),
    });
    setStarting(false);
    if (!r.ok) { flash((isAr ? "تعذّر البدء: " : "Failed: ") + r.error); return; }
    setStartOpen(false);
    setStartForm({ phone: "", name: "", company: "", department: "sales_marketing", reason: "", template: "welcome_followup_ar", variables: "" });
    flash(r.status === "sent" ? (isAr ? "أُرسل القالب وبدأت المحادثة" : "Template sent, conversation started")
      : r.status === "blocked" ? (isAr ? "محظور: الرقم خارج قائمة الاختبار" : "Blocked: number not in allowlist")
      : (isAr ? "وضع تجريبي: أُنشئت المحادثة ولم يُرسل القالب" : "Dry-run: conversation created, template not sent"));
    void loadList();
    if (r.conversationId) setSelId(r.conversationId);
  }

  async function openAlertSettings() {
    const s = await getMyAlert();
    setAlertPhone(s.whatsapp_alert_phone || "");
    setAlertEnabled(!!s.whatsapp_alert_enabled);
    setAlertOpen(true);
  }
  async function saveAlert() {
    setBusy(true);
    const r = await setMyAlert(alertPhone.trim(), alertEnabled);
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر الحفظ: " : "Save failed: ") + r.error); return; }
    setAlertOpen(false);
    flash(isAr ? "حُفظت إعدادات التنبيه" : "Alert settings saved");
  }

  async function submitReply(textOverride?: string) {
    const text = (textOverride ?? replyDraft).trim();
    if (!selected || !text) return;
    setSending(true);
    const r = await sendReply(selected.id, text);
    setSending(false);
    if (!r.ok) {
      // The outgoing message is preserved server-side; keep the draft so the user can retry.
      flash((isAr ? "تعذّر الإرسال: " : "Send failed: ") + r.error);
      await loadDetail(selected.id);
      return;
    }
    if (!textOverride) setReplyDraft("");
    await loadDetail(selected.id);
    const msg: Record<string, { ar: string; en: string }> = {
      dry_run: { ar: "وضع تجريبي: تم تسجيل الرد ولم يُرسل فعليًا", en: "Dry-run: reply recorded, not actually sent" },
      sent:    { ar: "أُرسلت الرسالة", en: "Sent" },
      blocked: { ar: "محظور: الرقم غير مُدرج في قائمة الاختبار", en: "Blocked: number not in the test allowlist" },
      failed:  { ar: "فشل الإرسال — احفظ المحاولة وأعد المحاولة", en: "Send failed — recorded; you can retry" },
    };
    flash(isAr ? msg[r.status].ar : msg[r.status].en);
  }

  async function changeAssignee(assignedTo: string | null) {
    if (!selected) return;
    setBusy(true);
    const r = await assignConversation({ conversationId: selected.id, assignedTo });
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر الإسناد: " : "Assign failed: ") + r.error); return; }
    setConvs((prev) => prev.map((c) => (c.id === selected.id ? { ...c, assigned_to: assignedTo } : c)));
    if (assignedTo) await loadDetail(selected.id); // refresh assignment history
    flash(isAr ? "تم تحديث الإسناد" : "Assignment updated");
  }

  async function submitNote() {
    if (!selected || !noteDraft.trim()) return;
    setBusy(true);
    const r = await addNote(selected.id, noteDraft.trim());
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر إضافة الملاحظة: " : "Note failed: ") + r.error); return; }
    setNoteDraft("");
    await loadDetail(selected.id);
    flash(isAr ? "أُضيفت الملاحظة" : "Note added");
  }

  // ── Render gates ──────────────────────────────────────────────────────────
  if (phase === "loading") return <Centered>{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</Centered>;
  if (phase === "auth") return (
    <Centered>
      <p style={{ marginBottom: 12 }}>{t({ ar: "يلزم تسجيل الدخول للوصول إلى صندوق واتساب.", en: "Sign in to access the WhatsApp inbox." })}</p>
      <a href="/client-portal" style={btn(RED)}>{t({ ar: "تسجيل الدخول", en: "Sign in" })}</a>
    </Centered>
  );
  if (phase === "denied") return <Centered>{t({ ar: "هذه الصفحة مخصّصة لفريق كيان فقط.", en: "This area is restricted to the Kian team." })}</Centered>;
  if (phase === "error") return <Centered>{t({ ar: "حدث خطأ: ", en: "Error: " })}{err}</Centered>;

  // ── Main layout ───────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 20px 60px" }}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: ACCENT, boxShadow: `0 0 12px ${ACCENT}` }} />
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{t({ ar: "صندوق واتساب", en: "WhatsApp Inbox" })}</h1>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
          {visible.length} {t({ ar: "محادثة", en: "conversations" })}
        </span>
        {unreadTotal > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, background: ACCENT, color: "#04210f", borderRadius: 10, padding: "2px 8px" }}>
            {unreadTotal} {t({ ar: "غير مقروء", en: "unread" })}
          </span>
        )}
        <button
          onClick={() => sendDiag?.startConversationEnabled ? setStartOpen(true) : flash(t({ ar: "الميزة مقفلة — فعّل WHATSAPP_START_CONVERSATION_ENABLED", en: "Locked — enable WHATSAPP_START_CONVERSATION_ENABLED" }))}
          title={sendDiag?.startConversationEnabled ? "" : t({ ar: "مقفل", en: "Locked" })}
          style={{ ...btn(sendDiag?.startConversationEnabled ? ACCENT : "rgba(255,255,255,0.08)"), marginInlineStart: "auto", opacity: sendDiag?.startConversationEnabled ? 1 : 0.6 }}>
          {sendDiag?.startConversationEnabled ? "＋ " : "🔒 "}{t({ ar: "بدء محادثة جديدة", en: "Start conversation" })}
        </button>
        <button onClick={() => void openAlertSettings()} title={t({ ar: "إعدادات تنبيه واتساب", en: "WhatsApp alert settings" })}
          style={{ ...btn("rgba(255,255,255,0.08)"), fontSize: 14, padding: "7px 12px" }}>⚙️</button>
        <button onClick={toggleAlerts} title={t({ ar: "تنبيهات صوتية", en: "Sound alerts" })}
          style={{ ...btn(alertsOn ? "rgba(37,211,102,0.18)" : "rgba(255,255,255,0.08)"), fontSize: 14, padding: "7px 12px" }}>
          {alertsOn ? "🔔" : "🔕"}
        </button>
        <button onClick={() => void loadList()} style={btn("rgba(255,255,255,0.08)")}>
          ↻ {t({ ar: "تحديث", en: "Refresh" })}
        </button>
      </header>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t({ ar: "بحث بالاسم أو الرقم أو الرسالة…", en: "Search name, phone, message…" })}
          style={{ flex: "1 1 240px", minWidth: 200, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "9px 12px", color: "#fff", fontSize: 13 }}
        />
        <Chip active={fStatus === ""} onClick={() => setFStatus("")} label={t({ ar: "كل الحالات", en: "All status" })} />
        {WA_STATUS_ORDER.map((s) => (
          <Chip key={s} active={fStatus === s} color={STATUS_COLOR[s]} onClick={() => setFStatus(fStatus === s ? "" : s)} label={isAr ? WA_STATUS_LABELS[s].ar : WA_STATUS_LABELS[s].en} />
        ))}
        <select
          value={fCategory} onChange={(e) => setFCategory(e.target.value as WaCategory | "")}
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "9px 12px", color: "#fff", fontSize: 13 }}
        >
          <option value="">{t({ ar: "كل التصنيفات", en: "All categories" })}</option>
          {WA_CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>{isAr ? WA_CATEGORY_LABELS[c].ar : WA_CATEGORY_LABELS[c].en}</option>
          ))}
        </select>
        <select value={fDepartment} onChange={(e) => setFDepartment(e.target.value as WaDepartment | "")} style={FILTER_SELECT}>
          <option value="">{t({ ar: "كل الأقسام", en: "All departments" })}</option>
          {WA_DEPARTMENT_ORDER.map((d) => (
            <option key={d} value={d}>{isAr ? WA_DEPARTMENT_LABELS[d].ar : WA_DEPARTMENT_LABELS[d].en}</option>
          ))}
        </select>
        <select value={fSalesStage} onChange={(e) => setFSalesStage(e.target.value as WaSalesStage | "")} style={FILTER_SELECT}>
          <option value="">{t({ ar: "كل المراحل", en: "All stages" })}</option>
          {WA_SALES_STAGE_ORDER.map((s) => (
            <option key={s} value={s}>{isAr ? WA_SALES_STAGE_LABELS[s].ar : WA_SALES_STAGE_LABELS[s].en}</option>
          ))}
        </select>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value as WaPriority | "")} style={FILTER_SELECT}>
          <option value="">{t({ ar: "كل الأولويات", en: "All priorities" })}</option>
          {WA_PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>{isAr ? WA_PRIORITY_LABELS[p].ar : WA_PRIORITY_LABELS[p].en}</option>
          ))}
        </select>
        <select value={fAssigned} onChange={(e) => setFAssigned(e.target.value)} style={FILTER_SELECT}>
          <option value="">{t({ ar: "كل المسؤولين", en: "All assignees" })}</option>
          <option value="__me__">{t({ ar: "المُسندة إليّ", en: "Assigned to me" })}</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{staffName(s)}</option>)}
        </select>
        <Chip active={fUnread} color={ACCENT} onClick={() => setFUnread((v) => !v)} label={t({ ar: "غير المقروءة", en: "Unread" })} />
      </div>

      {/* Read-error banner — so a permission/RLS failure never hides behind "0 conversations" */}
      {err && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 8, background: "rgba(227,30,36,0.10)", border: "1px solid rgba(227,30,36,0.4)", color: "#ffb4b7", fontSize: 13 }}>
          ⚠️ {t({ ar: "تعذّر تحميل المحادثات: ", en: "Couldn't load conversations: " })}{err}
        </div>
      )}

      {/* Split view */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 16, alignItems: "start" }}>
        {/* List */}
        <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden", maxHeight: "72vh", overflowY: "auto" }}>
          {visible.length === 0 && (
            <div style={{ padding: 28, textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
              {t({ ar: "لا توجد محادثات.", en: "No conversations." })}
            </div>
          )}
          {visible.map((c) => {
            const ct = contacts[c.contact_id];
            const active = c.id === selId;
            return (
              <button key={c.id} onClick={() => setSelId(c.id)}
                style={{ display: "block", width: "100%", textAlign: isAr ? "right" : "left", padding: "12px 14px", border: "none", borderBottom: "1px solid rgba(255,255,255,0.06)", background: active ? "rgba(37,211,102,0.10)" : "transparent", cursor: "pointer", color: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontWeight: c.unread_count > 0 ? 700 : 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.unread_count > 0 && <span style={{ display: "inline-block", minWidth: 18, textAlign: "center", background: ACCENT, color: "#04210f", borderRadius: 9, fontSize: 10, fontWeight: 700, padding: "1px 5px", marginInlineEnd: 6 }}>{c.unread_count}</span>}
                    {ct?.display_name || ct?.phone || ct?.wa_id || "—"}
                  </span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>{timeAgo(c.last_message_at, isAr)}</span>
                </div>
                <div style={{ fontSize: 12, color: c.unread_count > 0 ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.55)", margin: "3px 0 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.last_message_preview || "—"}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Badge color={STATUS_COLOR[c.status]} text={isAr ? WA_STATUS_LABELS[c.status].ar : WA_STATUS_LABELS[c.status].en} />
                  {c.assigned_department !== "unassigned" && (
                    <Badge color="rgba(59,130,246,0.18)" dark text={isAr ? WA_DEPARTMENT_LABELS[c.assigned_department].ar : WA_DEPARTMENT_LABELS[c.assigned_department].en} />
                  )}
                  {(c.routed_departments || [])
                    .filter((d) => d !== c.assigned_department && d !== "unassigned")
                    .map((d) => (
                      <Badge key={d} color="rgba(59,130,246,0.10)" dark text={`+ ${isAr ? WA_DEPARTMENT_LABELS[d].ar : WA_DEPARTMENT_LABELS[d].en}`} />
                    ))}
                  {(c.priority === "high" || c.priority === "urgent") && (
                    <Badge color={PRIORITY_COLOR[c.priority]} text={isAr ? WA_PRIORITY_LABELS[c.priority].ar : WA_PRIORITY_LABELS[c.priority].en} />
                  )}
                  <Badge color={c.crm_lead_id ? "rgba(37,211,102,0.18)" : "rgba(255,255,255,0.08)"} dark text={c.crm_lead_id ? (isAr ? "Zoho ✓" : "Zoho ✓") : (isAr ? "بدون Zoho" : "No Zoho")} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail */}
        <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, minHeight: "60vh", display: "flex", flexDirection: "column" }}>
          {!selected && (
            <div style={{ margin: "auto", color: "rgba(255,255,255,0.4)", fontSize: 14, padding: 40 }}>
              {t({ ar: "اختر محادثة لعرض التفاصيل.", en: "Select a conversation to view details." })}
            </div>
          )}

          {selected && (
            <>
              {/* Contact header */}
              <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{selectedContact?.display_name || selectedContact?.phone || selectedContact?.wa_id || "—"}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                    {selectedContact?.phone || selectedContact?.wa_id}
                    {selected.last_message_at ? `  ·  ${t({ ar: "آخر رسالة", en: "last" })} ${timeAgo(selected.last_message_at, isAr)}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Badge color={STATUS_COLOR[selected.status]} text={isAr ? WA_STATUS_LABELS[selected.status].ar : WA_STATUS_LABELS[selected.status].en} />
                  <Badge color="rgba(255,255,255,0.12)" dark text={isAr ? WA_CATEGORY_LABELS[selected.category].ar : WA_CATEGORY_LABELS[selected.category].en} />
                  <Badge color={PRIORITY_COLOR[selected.priority]} text={isAr ? WA_PRIORITY_LABELS[selected.priority].ar : WA_PRIORITY_LABELS[selected.priority].en} />
                </div>
              </div>

              {/* CRM (Zoho) row */}
              <div style={{ padding: "8px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                <span style={{ color: "rgba(255,255,255,0.5)" }}>Zoho CRM:</span>
                {selected.crm_lead_id ? (
                  <>
                    <a href={`https://crm.zoho.sa/crm/tab/Leads/${selected.crm_lead_id}`} target="_blank" rel="noopener noreferrer"
                       style={{ color: "#3b82f6", textDecoration: "none" }}>
                      {t({ ar: "فتح العميل في Zoho", en: "Open lead in Zoho" })} ↗
                    </a>
                    {selected.crm_synced_at && <span style={{ color: "rgba(255,255,255,0.4)" }}>· {t({ ar: "آخر مزامنة", en: "synced" })} {timeAgo(selected.crm_synced_at, isAr)}</span>}
                  </>
                ) : (
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>{t({ ar: "لم يُربط بعد", en: "not linked yet" })}</span>
                )}
                <button onClick={() => void pushZoho()} disabled={syncingZoho}
                  style={{ ...btn("rgba(255,255,255,0.08)", syncingZoho), marginInlineStart: "auto", fontSize: 12, padding: "5px 10px" }}>
                  {syncingZoho ? "…" : t({ ar: "مزامنة مع Zoho", en: "Sync to Zoho" })}
                </button>
              </div>

              {/* Quote-request section (Part 2) */}
              <div style={{ padding: "10px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>{t({ ar: "طلبات عرض السعر", en: "Quote requests" })} ({quotes.length})</span>
                  <span style={{ display: "inline-flex", gap: 6, marginInlineStart: "auto", flexWrap: "wrap" }}>
                    <button onClick={() => void createQuote()} disabled={busy}
                      style={{ ...btn("rgba(255,255,255,0.08)", busy), fontSize: 12, padding: "5px 10px" }}>
                      {t({ ar: "إنشاء طلب عرض سعر", en: "Create quote request" })}
                    </button>
                    <button onClick={() => void copyQuoteLink()}
                      style={{ ...btn("rgba(255,255,255,0.08)"), fontSize: 12, padding: "5px 10px" }}>
                      {t({ ar: "نسخ رابط الطلب", en: "Copy link" })}
                    </button>
                    <button onClick={() => void sendQuoteLink()} disabled={busy}
                      style={{ ...btn(ACCENT, busy), fontSize: 12, padding: "5px 10px" }}>
                      {t({ ar: "إرسال رابط الطلب", en: "Send link" })}
                    </button>
                  </span>
                </div>
                {quotesError && (
                  <span style={{ color: "#ffb4b7" }}>
                    {t({ ar: "تعذّر تحميل طلبات عرض السعر", en: "Couldn't load quote requests" })} ({quotesError})
                  </span>
                )}
                {!quotesError && quotes.length === 0 && <span style={{ color: "rgba(255,255,255,0.4)" }}>{t({ ar: "لا توجد طلبات مرتبطة بهذه المحادثة.", en: "No quote requests linked to this conversation." })}</span>}
                {quotes.map((q) => <QuoteCard key={q.id} q={q} isAr={isAr} t={t} />)}
              </div>

              {/* Triage controls */}
              {canTriage ? (
                <div style={{ padding: "10px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Field label={t({ ar: "الحالة", en: "Status" })}>
                    <Select value={selected.status} disabled={busy} onChange={(v) => patchConv({ status: v as WaStatus })}
                      options={WA_STATUS_ORDER.map((s) => ({ value: s, label: isAr ? WA_STATUS_LABELS[s].ar : WA_STATUS_LABELS[s].en }))} />
                  </Field>
                  <Field label={t({ ar: "التصنيف", en: "Category" })}>
                    <Select value={selected.category} disabled={busy} onChange={(v) => patchConv({ category: v as WaCategory })}
                      options={WA_CATEGORY_ORDER.map((c) => ({ value: c, label: isAr ? WA_CATEGORY_LABELS[c].ar : WA_CATEGORY_LABELS[c].en }))} />
                  </Field>
                  <Field label={t({ ar: "الأولوية", en: "Priority" })}>
                    <Select value={selected.priority} disabled={busy} onChange={(v) => patchConv({ priority: v as WaPriority })}
                      options={WA_PRIORITY_ORDER.map((p) => ({ value: p, label: isAr ? WA_PRIORITY_LABELS[p].ar : WA_PRIORITY_LABELS[p].en }))} />
                  </Field>
                  <Field label={t({ ar: "مُسندة إلى", en: "Assigned to" })}>
                    <Select value={selected.assigned_to || ""} disabled={busy} onChange={(v) => changeAssignee(v || null)}
                      options={[{ value: "", label: t({ ar: "— غير مُسندة —", en: "— Unassigned —" }) }, ...staff.map((s) => ({ value: s.id, label: staffName(s) }))]} />
                  </Field>
                  <Field label={t({ ar: "مرحلة المبيعات", en: "Sales stage" })}>
                    <Select value={selected.sales_stage} disabled={busy} onChange={(v) => patchSalesStage(v as WaSalesStage)}
                      options={WA_SALES_STAGE_ORDER.map((s) => ({ value: s, label: isAr ? WA_SALES_STAGE_LABELS[s].ar : WA_SALES_STAGE_LABELS[s].en }))} />
                  </Field>
                  <Field label={t({ ar: "القسم", en: "Department" })}>
                    <Select value={selected.assigned_department} disabled={busy} onChange={(v) => patchDepartment(v as WaDepartment)}
                      options={WA_DEPARTMENT_ORDER.map((d) => ({ value: d, label: isAr ? WA_DEPARTMENT_LABELS[d].ar : WA_DEPARTMENT_LABELS[d].en }))} />
                  </Field>
                </div>
              ) : (
                selected.assigned_to && (
                  <div style={{ padding: "8px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                    {t({ ar: "مُسندة إلى", en: "Assigned to" })}: {staff.find((s) => s.id === selected.assigned_to)?.full_name || (selected.assigned_to === myId ? t({ ar: "أنت", en: "you" }) : selected.assigned_to.slice(0, 8))}
                  </div>
                )
              )}

              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 10, maxHeight: "44vh" }}>
                {detailLoading && <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</div>}
                {!detailLoading && messages.length === 0 && <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{t({ ar: "لا توجد رسائل.", en: "No messages." })}</div>}
                {messages.map((m) => {
                  const incoming = m.direction === "incoming";
                  return (
                    <div key={m.id} style={{ alignSelf: incoming ? "flex-start" : "flex-end", maxWidth: "78%" }}>
                      <div style={{ background: incoming ? "rgba(255,255,255,0.07)" : "rgba(37,211,102,0.16)", border: `1px solid ${incoming ? "rgba(255,255,255,0.08)" : "rgba(37,211,102,0.3)"}`, borderRadius: 12, padding: "8px 12px", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {m.body || `[${m.message_type}]`}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 3, textAlign: incoming ? (isAr ? "right" : "left") : (isAr ? "left" : "right") }}>
                        {timeAgo(m.sent_at || m.created_at, isAr)}
                        {!incoming && m.status === "dry_run" && <span style={{ color: "rgba(245,158,11,0.9)" }}>{isAr ? " · تجريبي" : " · dry-run"}</span>}
                        {!incoming && m.status === "failed" && <span style={{ color: "#ffb4b7" }}>{isAr ? " · فشل" : " · failed"}</span>}
                        {!incoming && m.status === "blocked" && <span style={{ color: "rgba(147,51,234,0.9)" }}>{isAr ? " · محظور" : " · blocked"}</span>}
                        {!incoming && m.status === "queued" && <span style={{ color: "rgba(255,255,255,0.5)" }}>{isAr ? " · قيد الإرسال" : " · sending"}</span>}
                        {!incoming && m.status === "sent" && <span style={{ color: ACCENT }}>{isAr ? " · أُرسلت" : " · sent"}</span>}
                        {!incoming && m.status === "failed" && m.body && (
                          <button onClick={() => void submitReply(m.body!)} disabled={sending}
                            style={{ marginInlineStart: 6, background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 10, padding: 0 }}>
                            ↻ {isAr ? "إعادة المحاولة" : "Retry"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reply box — records the message; actual WhatsApp send is gated by
                  WHATSAPP_SEND_ENABLED on the server (dry-run until enabled). */}
              <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <textarea rows={2} value={replyDraft} disabled={sending}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submitReply(); }}
                    placeholder={t({ ar: "اكتب رداً… (Ctrl/⌘+Enter للإرسال)", en: "Write a reply… (Ctrl/⌘+Enter to send)" })}
                    style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, padding: "10px 12px", color: "#fff", fontSize: 13, resize: "none" }} />
                  <button onClick={() => void submitReply()} disabled={sending || !replyDraft.trim()} style={btn(ACCENT, sending || !replyDraft.trim())}>
                    {sending ? "…" : t({ ar: "إرسال", en: "Send" })}
                  </button>
                </div>
                {sendDiag?.sendEnabled ? (
                  <div style={{ fontSize: 11, color: ACCENT, marginTop: 4 }}>
                    🟢 {t({ ar: "الإرسال المباشر مُفعّل — سيصل الرد إلى واتساب.", en: "Live sending is on — replies are delivered to WhatsApp." })}
                    {sendDiag.allowlistCount > 0 && <span style={{ color: "rgba(255,255,255,0.45)" }}>{t({ ar: " (محصور بقائمة اختبار)", en: " (restricted to test allowlist)" })}</span>}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "rgba(245,158,11,0.9)", marginTop: 4 }}>
                    🧪 {t({ ar: "وضع تجريبي: الرد يسجل في المحادثة ولا يرسل فعليًا", en: "Dry-run: the reply is recorded in the thread and not actually sent." })}
                  </div>
                )}
              </div>

              {/* Internal notes + assignment history */}
              <div style={{ padding: 18, borderTop: "1px solid rgba(255,255,255,0.08)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                <section>
                  <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>{t({ ar: "ملاحظات داخلية", en: "Internal notes" })}</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8, maxHeight: 160, overflowY: "auto" }}>
                    {notes.length === 0 && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{t({ ar: "لا ملاحظات بعد.", en: "No notes yet." })}</span>}
                    {notes.map((n) => (
                      <div key={n.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "7px 10px", fontSize: 12 }}>
                        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.note}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>{timeAgo(n.created_at, isAr)}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitNote(); }}
                      placeholder={t({ ar: "أضف ملاحظة…", en: "Add a note…" })}
                      style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 12 }} />
                    <button onClick={() => void submitNote()} disabled={busy || !noteDraft.trim()} style={btn(ACCENT, busy || !noteDraft.trim())}>
                      {t({ ar: "إضافة", en: "Add" })}
                    </button>
                  </div>
                </section>

                <section>
                  <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>{t({ ar: "سجل الإسناد", en: "Assignment history" })}</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                    {assignments.length === 0 && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{t({ ar: "لا يوجد سجل إسناد.", en: "No assignment history." })}</span>}
                    {assignments.map((a) => (
                      <div key={a.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "7px 10px", fontSize: 12 }}>
                        <div>→ {staff.find((s) => s.id === a.assigned_to)?.full_name || a.assigned_to.slice(0, 8)}</div>
                        {a.reason && <div style={{ color: "rgba(255,255,255,0.5)" }}>{a.reason}</div>}
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>{timeAgo(a.created_at, isAr)}</div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Start-conversation modal (Part 3) */}
      {startOpen && (
        <Overlay onClose={() => setStartOpen(false)}>
          <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>{t({ ar: "بدء محادثة جديدة", en: "Start new conversation" })}</h3>
          <p style={{ margin: "0 0 14px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            {t({ ar: "تُرسل قالبًا معتمدًا فقط. الأرقام الجديدة تتطلب قالبًا (لا رسائل حرة).", en: "Sends an approved template only. New numbers require a template (no free-form)." })}
          </p>
          {!sendDiag?.templateSendEnabled && (
            <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", fontSize: 12, color: "rgba(255,220,160,0.95)" }}>
              {t({ ar: "🔒 إرسال القوالب معطّل — ستُنشأ المحادثة فقط (وضع تجريبي).", en: "🔒 Template sending disabled — conversation will be created only (dry-run)." })}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label={t({ ar: "رقم الهاتف (بصيغة دولية)", en: "Phone (international)" })}>
              <Input value={startForm.phone} onChange={(v) => setStartForm({ ...startForm, phone: v })} placeholder="9665XXXXXXXX" />
            </Field>
            <Field label={t({ ar: "الاسم", en: "Name" })}>
              <Input value={startForm.name} onChange={(v) => setStartForm({ ...startForm, name: v })} />
            </Field>
            <Field label={t({ ar: "الشركة (اختياري)", en: "Company (optional)" })}>
              <Input value={startForm.company} onChange={(v) => setStartForm({ ...startForm, company: v })} />
            </Field>
            <Field label={t({ ar: "القسم", en: "Department" })}>
              <Select value={startForm.department} onChange={(v) => setStartForm({ ...startForm, department: v })}
                options={WA_DEPARTMENT_ORDER.filter((d) => d !== "unassigned").map((d) => ({ value: d, label: isAr ? WA_DEPARTMENT_LABELS[d].ar : WA_DEPARTMENT_LABELS[d].en }))} />
            </Field>
            <Field label={t({ ar: "القالب", en: "Template" })}>
              <Select value={startForm.template} onChange={(v) => setStartForm({ ...startForm, template: v })}
                options={START_TEMPLATES.map((tpl) => ({ value: tpl.name, label: isAr ? tpl.ar : tpl.en }))} />
            </Field>
            <Field label={t({ ar: "متغيّرات القالب (افصل بـ |)", en: "Template variables (split by |)" })}>
              <Input value={startForm.variables} onChange={(v) => setStartForm({ ...startForm, variables: v })} placeholder={t({ ar: "مثال: أحمد | عرض سعر", en: "e.g. Ahmed | quote" })} />
            </Field>
            <Field label={t({ ar: "السبب (داخلي)", en: "Reason (internal)" })}>
              <Input value={startForm.reason} onChange={(v) => setStartForm({ ...startForm, reason: v })} />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => setStartOpen(false)} style={btn("rgba(255,255,255,0.08)")}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
            <button onClick={() => void doStartConversation()} disabled={starting || !startForm.phone.trim()}
              style={btn(ACCENT, starting || !startForm.phone.trim())}>
              {starting ? "…" : sendDiag?.templateSendEnabled ? t({ ar: "إرسال القالب وبدء المحادثة", en: "Send template & start" }) : t({ ar: "إنشاء المحادثة (تجريبي)", en: "Create (dry-run)" })}
            </button>
          </div>
        </Overlay>
      )}

      {/* Alert-settings modal (Part 1) */}
      {alertOpen && (
        <Overlay onClose={() => setAlertOpen(false)}>
          <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>{t({ ar: "إعدادات تنبيه واتساب", en: "WhatsApp alert settings" })}</h3>
          <p style={{ margin: "0 0 14px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            {t({ ar: "رقم واتساب الذي تصلك عليه تنبيهات المحادثات المسندة إليك/إلى قسمك. لا يُرسل شيء حتى يُفعّل المسؤول الميزة.", en: "Your WhatsApp number for alerts on conversations assigned to you / your department. Nothing is sent until an admin enables the feature." })}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label={t({ ar: "رقم التنبيه (بصيغة دولية)", en: "Alert phone (international)" })}>
              <Input value={alertPhone} onChange={setAlertPhone} placeholder="9665XXXXXXXX" />
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={alertEnabled} onChange={(e) => setAlertEnabled(e.target.checked)} />
              {t({ ar: "تفعيل تنبيهاتي على واتساب", en: "Enable my WhatsApp alerts" })}
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => setAlertOpen(false)} style={btn("rgba(255,255,255,0.08)")}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
            <button onClick={() => void saveAlert()} disabled={busy} style={btn(ACCENT, busy)}>{busy ? "…" : t({ ar: "حفظ", en: "Save" })}</button>
          </div>
        </Overlay>
      )}

      {toast && (
        <div style={{ position: "fixed", insetInlineEnd: 20, bottom: 20, background: "rgba(0,0,0,0.9)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 16px", fontSize: 13, zIndex: 50 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// Start-conversation approved-template registry (mirrors docs/whatsapp_templates.md).
const START_TEMPLATES: { name: string; ar: string; en: string }[] = [
  { name: "welcome_followup_ar",        ar: "ترحيب ومتابعة",        en: "Welcome & follow-up" },
  { name: "quote_followup_ar",          ar: "متابعة عرض سعر",        en: "Quote follow-up" },
  { name: "appointment_confirmation_ar", ar: "تأكيد موعد",           en: "Appointment confirmation" },
  { name: "invoice_followup_ar",        ar: "متابعة فاتورة",         en: "Invoice follow-up" },
  { name: "hr_followup_ar",             ar: "متابعة موارد بشرية",     en: "HR follow-up" },
];

// ─── Small presentational helpers ──────────────────────────────────────────
function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40, color: "rgba(255,255,255,0.7)", fontSize: 14 }}>{children}</div>;
}
function Chip({ active, color, label, onClick }: { active: boolean; color?: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 999, cursor: "pointer", border: `1px solid ${active ? (color || "#fff") : "rgba(255,255,255,0.15)"}`, background: active ? (color ? `${color}22` : "rgba(255,255,255,0.12)") : "transparent", color: active ? "#fff" : "rgba(255,255,255,0.6)" }}>
      {label}
    </button>
  );
}
function Badge({ color, text, dark }: { color: string; text: string; dark?: boolean }) {
  return <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 6, background: dark ? color : `${color}22`, border: `1px solid ${dark ? "rgba(255,255,255,0.15)" : color}`, color: dark ? "rgba(255,255,255,0.75)" : color }}>{text}</span>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: "rgba(255,255,255,0.4)" }}>{label}</span>
      {children}
    </label>
  );
}
function Select({ value, options, onChange, disabled }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "6px 8px", color: "#fff", fontSize: 12, minWidth: 120 }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
function btn(bg: string, disabled = false): React.CSSProperties {
  return { display: "inline-block", fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: 8, border: "none", cursor: disabled ? "not-allowed" : "pointer", background: bg, color: "#fff", opacity: disabled ? 0.5 : 1, textDecoration: "none" };
}
function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "8px 10px", color: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box" }} />
  );
}
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "#15171c", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 22, width: "min(440px, 100%)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        {children}
      </div>
    </div>
  );
}

// Quote-request card — renders from the REAL whatsapp_quote_requests schema with
// safe fallbacks for every nullable column, so existing rows (with null
// category/budget/services/external_request_id) still render and never crash.
function QuoteCard({ q, isAr, t }: { q: WaQuoteRequest; isAr: boolean; t: (s: { ar: string; en: string }) => string }) {
  const NA = t({ ar: "غير محدد", en: "Unspecified" });
  const requestNo = (q.external_request_id && q.external_request_id.trim()) || `#${q.id.slice(0, 8)}`;
  const customer = q.full_name || q.phone || "—";
  const servicesText = Array.isArray(q.services) && q.services.length > 0 ? q.services.join("، ") : NA;
  const categoryText = q.category || NA;
  const budgetText = q.budget_range || NA;
  const cityText = q.city || NA;
  const statusKey = q.status as WaQuoteStatus | null;
  const statusLabel = statusKey && WA_QUOTE_STATUS_LABELS[statusKey]
    ? (isAr ? WA_QUOTE_STATUS_LABELS[statusKey].ar : WA_QUOTE_STATUS_LABELS[statusKey].en)
    : (q.status || NA);
  const dateText = q.created_at ? timeAgo(q.created_at, isAr) : "";
  const cell = (label: string, value: string) => (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "baseline" }}>
      <span style={{ color: "rgba(255,255,255,0.4)" }}>{label}:</span>
      <span style={{ color: "rgba(255,255,255,0.85)" }}>{value}</span>
    </span>
  );
  return (
    <div style={{ background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.28)", borderRadius: 10, padding: "9px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{requestNo}</span>
        <strong style={{ fontSize: 13 }}>{customer}</strong>
        <Badge color="rgba(255,255,255,0.12)" dark text={statusLabel} />
        {dateText && <span style={{ color: "rgba(255,255,255,0.4)", marginInlineStart: "auto" }}>{dateText}</span>}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {q.phone && cell(t({ ar: "الجوال", en: "Phone" }), q.phone)}
        {cell(t({ ar: "الخدمات", en: "Services" }), servicesText)}
        {cell(t({ ar: "التصنيف", en: "Category" }), categoryText)}
        {cell(t({ ar: "الميزانية", en: "Budget" }), budgetText)}
        {cell(t({ ar: "المدينة", en: "City" }), cityText)}
      </div>
      {(q.source || q.crm_lead_id) && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {q.source && <span style={{ color: "rgba(255,255,255,0.4)" }}>{t({ ar: "المصدر", en: "Source" })}: {q.source === "whatsapp" ? "WhatsApp" : q.source}</span>}
          {q.crm_lead_id && <a href={`https://crm.zoho.sa/crm/tab/Leads/${q.crm_lead_id}`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }}>Zoho ↗</a>}
        </div>
      )}
    </div>
  );
}
