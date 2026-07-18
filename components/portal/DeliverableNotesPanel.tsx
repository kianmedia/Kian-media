"use client";
// ════════════════════════════════════════════════════════════════════════
// Shared client-notes panel for EVERY staff tier (owner / super-admin / manager /
// editor). Fetches all client_comments for a deliverable (RLS-scoped) plus the
// version summary, and groups formal revision requests + timecode/page/pin
// annotations UNDER the version they belong to (V1 / V2 / … / Final). Staff can
// reply, set in-progress, and resolve — authority is re-checked in the
// admin_resolve_note RPC (is_admin OR staff_reads_all OR project member), so this
// is not UI-only enforcement. The client sees the Kian response in the viewer.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { listCommentsForDeliverables, listReviewsForDeliverables, listVersionSummary, resolveNote, secondsToTimecode, type VersionSummary } from "@/lib/portal/deliverables";
import type { DeliverableReview, ClientComment, NoteStatus } from "@/lib/portal/types";

type Tf = (m: { ar: string; en: string }) => string;

export default function DeliverableNotesPanel({ deliverable, reviews: reviewsProp, canResolve, t }: {
  deliverable: { id: string }; reviews?: DeliverableReview[]; canResolve: boolean; t: Tf;
}) {
  const [comments, setComments] = useState<ClientComment[]>([]);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [fetchedReviews, setFetchedReviews] = useState<DeliverableReview[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "in_progress" | "resolved">("all");
  const matchF = (s?: string) => filter === "all"
    || (filter === "resolved" ? s === "resolved"
      : filter === "in_progress" ? s === "in_progress"
      : s !== "resolved" && s !== "in_progress"); // "open" (default/open)

  // Self-contained: fetches comments + versions, and reviews too when a parent
  // didn't pass them (so it can drop into any surface — incl. the المخرجات tab).
  const load = useCallback(async () => {
    const [c, v, rv] = await Promise.all([
      listCommentsForDeliverables([deliverable.id]),
      listVersionSummary(deliverable.id),
      reviewsProp ? Promise.resolve(null) : listReviewsForDeliverables([deliverable.id]),
    ]);
    if (c.ok) setComments(c.data);
    if (v.ok) setVersions(v.data);
    if (rv && rv.ok) setFetchedReviews(rv.data);
    setLoaded(true);
  }, [deliverable.id, reviewsProp]);
  useEffect(() => { void load(); }, [load]);

  const reviews = reviewsProp ?? fetchedReviews;
  const revisionReviews = reviews.filter((r) => r.deliverable_id === deliverable.id && r.decision === "revision_requested");
  const total = comments.length + revisionReviews.length;
  const openCount = comments.filter((c) => c.status !== "resolved").length + revisionReviews.filter((r) => r.status !== "resolved").length;
  const resolvedCount = total - openCount;

  // Group notes under the version they reference (fallback bucket for null/unknown).
  const vById = new Map(versions.map((v) => [v.id, v]));
  const order = [...versions].sort((a, b) => a.version_no - b.version_no);
  const groupKey = (vid: string | null | undefined) => (vid && vById.has(vid) ? vid : "__general__");
  const groups: { key: string; label: string; isFinal: boolean; comments: ClientComment[]; reviews: DeliverableReview[] }[] = [];
  const pushGroup = (key: string, label: string, isFinal: boolean) => {
    const cs = comments.filter((c) => groupKey(c.version_id) === key);
    const rs = revisionReviews.filter((r) => groupKey(r.version_id) === key);
    if (cs.length || rs.length) groups.push({ key, label, isFinal, comments: cs, reviews: rs });
  };
  for (const v of order) pushGroup(v.id, v.label, v.is_final);
  pushGroup("__general__", t({ ar: "عام", en: "General" }), false);

  async function resolve(kind: "comment" | "review", id: string, status: NoteStatus, el?: HTMLTextAreaElement | null) {
    setBusy(id);
    const r = await resolveNote(kind, id, status, el?.value.trim() || undefined);
    setBusy(null);
    if (r.ok) { if (el) el.value = ""; await load(); }
  }

  if (loaded && total === 0) return null;

  const stColor = (s?: string) => s === "resolved" ? "#7CFC9A" : s === "in_progress" ? "rgba(255,210,138,0.95)" : "#ff8a8e";
  const stLabel = (s?: string) => s === "resolved" ? t({ ar: "محلول", en: "Resolved" }) : s === "in_progress" ? t({ ar: "قيد المعالجة", en: "In progress" }) : t({ ar: "مفتوح", en: "Open" });

  const Row = ({ id, kind, badge, badgeColor, body, meta, status, resolution }: {
    id: string; kind: "comment" | "review"; badge: string; badgeColor: string; body: string; meta: string; status?: string; resolution?: string | null;
  }) => {
    const ref = { el: null as HTMLTextAreaElement | null };
    return (
      <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "10px 12px" }}>
        <div className="flex items-center justify-between gap-2 flex-wrap" style={{ marginBottom: "5px" }}>
          <span className="f-sans" style={{ fontSize: "9px", letterSpacing: "0.5px", textTransform: "uppercase", color: badgeColor }}>{badge}</span>
          <span className="f-sans" style={{ fontSize: "10px", color: stColor(status) }}>● {stLabel(status)}</span>
        </div>
        <p className="text-white/85" style={{ fontSize: "13px", lineHeight: 1.6, whiteSpace: "pre-wrap" }} dir="auto">{body || t({ ar: "(بدون نص)", en: "(no text)" })}</p>
        <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>{meta}</div>
        {resolution?.trim() && (
          <div style={{ marginTop: "6px", borderInlineStart: "2px solid rgba(124,252,154,0.4)", paddingInlineStart: "8px", fontSize: "12px", color: "rgba(255,255,255,0.8)" }}>
            <span style={{ fontSize: "9px", textTransform: "uppercase", color: "#7CFC9A" }}>{t({ ar: "ردّ كيان", en: "Kian response" })}</span>
            <div dir="auto">{resolution}</div>
          </div>
        )}
        {canResolve && status !== "resolved" && (
          <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <textarea ref={(e) => { ref.el = e; }} rows={2} placeholder={t({ ar: "ردّ/حلّ كيان (اختياري)…", en: "Kian response/resolution (optional)…" })} className="f-sans"
              style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "8px 10px", color: "#fff", fontSize: "12.5px", outline: "none", resize: "vertical", colorScheme: "dark" }} />
            <div className="flex gap-2 flex-wrap">
              {status !== "in_progress" && <button disabled={busy === id} onClick={() => resolve(kind, id, "in_progress", ref.el)} className="f-sans" style={{ fontSize: "11px", color: "rgba(255,210,138,0.95)", background: "none", border: "1px solid rgba(255,210,138,0.35)", borderRadius: "3px", padding: "7px 12px", cursor: "pointer" }}>{t({ ar: "قيد المعالجة", en: "In progress" })}</button>}
              <button disabled={busy === id} onClick={() => resolve(kind, id, "resolved", ref.el)} className="f-sans" style={{ fontSize: "11px", color: "#7CFC9A", background: "none", border: "1px solid rgba(124,252,154,0.35)", borderRadius: "3px", padding: "7px 12px", cursor: "pointer" }}>{busy === id ? "…" : t({ ar: "وضع كمحلول + إرسال الرد", en: "Resolve + send response" })}</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const commentBadge = (c: ClientComment) =>
    c.timecode_seconds != null ? `${t({ ar: "تعليق", en: "Comment" })} · ${secondsToTimecode(c.timecode_seconds)}`
      : c.page_number != null ? `${t({ ar: "تعليق · صفحة", en: "Comment · p." })} ${c.page_number}`
      : c.pos_x != null && c.pos_y != null ? `${t({ ar: "تعليق · موضع", en: "Comment · pin" })} ${Math.round(c.pos_x * 100)}%,${Math.round(c.pos_y * 100)}%`
      : t({ ar: "تعليق", en: "Comment" });

  return (
    <div style={{ marginTop: "12px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap" style={{ marginBottom: "8px" }}>
        <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
          {t({ ar: "ملاحظات العميل وحلّها", en: "Client notes & resolution" })} —
          <span style={{ color: "#ff8a8e" }}> {openCount} {t({ ar: "مفتوح", en: "open" })}</span> ·
          <span style={{ color: "#7CFC9A" }}> {resolvedCount} {t({ ar: "محلول", en: "resolved" })}</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {([["all", { ar: "الكل", en: "All" }], ["open", { ar: "مفتوح", en: "Open" }], ["in_progress", { ar: "قيد المعالجة", en: "In progress" }], ["resolved", { ar: "محلول", en: "Resolved" }]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setFilter(k)} className="f-sans" style={{ fontSize: "10px", padding: "3px 8px", borderRadius: "3px", cursor: "pointer", border: `1px solid ${filter === k ? "rgba(227,30,36,0.5)" : "rgba(255,255,255,0.14)"}`, background: filter === k ? "rgba(227,30,36,0.14)" : "transparent", color: filter === k ? "#fff" : "rgba(255,255,255,0.55)" }}>{t(lbl)}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {groups.map((g) => {
          const rs = g.reviews.filter((r) => matchF(r.status));
          const cs = g.comments.filter((c) => matchF(c.status));
          if (rs.length === 0 && cs.length === 0) return null;   // hidden by filter
          const gOpen = g.comments.filter((c) => c.status !== "resolved").length + g.reviews.filter((r) => r.status !== "resolved").length;
          const gResolved = (g.comments.length + g.reviews.length) - gOpen;
          return (
            <div key={g.key}>
              <div className="flex items-baseline gap-2 flex-wrap" style={{ marginBottom: "6px" }}>
                <span className="f-sans" style={{ fontSize: "10.5px", fontWeight: 700, color: g.isFinal ? "#7CFC9A" : "rgba(255,255,255,0.7)", letterSpacing: "0.3px" }}>
                  {g.label}{g.isFinal ? ` · ${t({ ar: "نهائية", en: "Final" })}` : ""}
                </span>
                <span className="f-sans" style={{ fontSize: "9px", color: "rgba(255,255,255,0.4)" }}>
                  <span style={{ color: "#ff8a8e" }}>{gOpen} {t({ ar: "مفتوح", en: "open" })}</span> · <span style={{ color: "#7CFC9A" }}>{gResolved} {t({ ar: "محلول", en: "resolved" })}</span>
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {rs.map((r) => (
                  <Row key={r.id} id={r.id} kind="review" badge={t({ ar: "طلب تعديل", en: "Revision request" })} badgeColor="#ff8a8e"
                    body={r.comments ?? ""} status={r.status}
                    meta={`${t({ ar: "قرار العميل", en: "client decision" })} · ${new Date(r.created_at).toLocaleString("en-GB")}`} resolution={r.resolution_note} />
                ))}
                {cs.map((c) => (
                  <Row key={c.id} id={c.id} kind="comment" badge={commentBadge(c)} badgeColor="rgba(255,255,255,0.6)"
                    body={c.body} status={c.status}
                    meta={`${c.author_role === "admin" ? t({ ar: "كيان", en: "Kian" }) : t({ ar: "العميل", en: "Client" })} · ${new Date(c.created_at).toLocaleString("en-GB")}`}
                    resolution={c.resolution_note} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
