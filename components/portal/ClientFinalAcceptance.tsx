"use client";
// ════════════════════════════════════════════════════════════════════════════
// ClientFinalAcceptance — V1 CLOSURE.
//
// WHY THIS EXISTS: project_final_acceptance_decide already permits the CLIENT OWNER and
// stamps accepted_by = auth.uid(); the pfa_read policy already exposes client_final rows
// to the client. But there was no client-facing surface, so the only way to satisfy the
// "client acceptance" closure requirement was for a staff member to click Accept inside
// the staff Closure Center — writing a STAFF uid into the very record that the printed
// "Final Delivery & Acceptance Record" presents as the client's signature.
//
// This card closes that gap: the client accepts (or requests changes / rejects) with
// their own session, so the acceptance evidence is genuinely attributable to them.
//
// Safety: read-only list scoped by RLS to this client's own pending rows; every decision
// goes through the existing RPC, which re-checks authorization server-side. Nothing
// internal or financial is displayed.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { clientMyAcceptances, projectFinalAcceptanceDecide, closureErr, type Dict } from "@/lib/portal/projectClosure";

export default function ClientFinalAcceptance({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Dict[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await clientMyAcceptances(projectId);
    setRows(r.ok ? r.data : []);
    setLoaded(true);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, action: "accept" | "request_changes" | "reject") {
    if (busy) return;
    let comment: string | undefined;
    if (action !== "accept") {
      const label = action === "reject"
        ? t({ ar: "سبب الرفض (إلزامي):", en: "Reason for rejection (required):" })
        : t({ ar: "ما التعديلات المطلوبة؟ (إلزامي)", en: "What changes are needed? (required)" });
      const p = window.prompt(label);
      if (p === null) return;
      if (!p.trim()) { setMsg(t({ ar: "السبب إلزامي.", en: "A reason is required." })); return; }
      comment = p.trim();
    } else if (!window.confirm(t({
      ar: "بالتوقيع على القبول النهائي تُقرّ باستلام أعمال المشروع كما سُلِّمت. هل تؤكّد؟",
      en: "Accepting confirms you have received the project deliverables as handed over. Confirm?",
    }))) return;

    setBusy(id); setMsg(null);
    const r = await projectFinalAcceptanceDecide(id, action, comment);
    setBusy(null);
    if (!r.ok) { setMsg(closureErr(r.error)); return; }
    setMsg(action === "accept"
      ? t({ ar: "تم تسجيل قبولك النهائي باسمك. شكرًا لك.", en: "Your final acceptance was recorded under your name. Thank you." })
      : t({ ar: "أُرسل ردّك إلى الفريق.", en: "Your response was sent to the team." }));
    await load();
  }

  // Nothing pending → render nothing (no empty box on the client's page).
  if (!loaded || rows.length === 0) return msg
    ? <p className="text-[11px] text-emerald-300 mt-2">{msg}</p>
    : null;

  return (
    <section className="border border-amber-800/60 rounded-xl p-3 bg-amber-950/20 space-y-2 mt-4" dir="rtl">
      <h3 className="text-sm font-semibold text-amber-200">
        {t({ ar: "مطلوب منك: القبول النهائي للمشروع", en: "Action required: final project acceptance" })}
      </h3>
      <p className="text-[11px] text-stone-300">
        {t({
          ar: "راجع الأعمال المُسلَّمة ثم سجّل قبولك النهائي. يُسجَّل القبول باسمك أنت.",
          en: "Review the delivered work and record your final acceptance. It is recorded under your own name.",
        })}
      </p>

      {rows.map((a) => {
        const id = String(a.id ?? "");
        const note = typeof a.request_note === "string" ? a.request_note : "";
        const changes = typeof a.changes_requested === "string" ? a.changes_requested : "";
        return (
          <div key={id} className="border-t border-amber-900/40 pt-2 space-y-1.5">
            {note && <p className="text-[11px] text-stone-300" dir="auto">{note}</p>}
            {changes && (
              <p className="text-[10px] text-amber-300" dir="auto">
                {t({ ar: "تعديلات سبق أن طلبتها: ", en: "Changes you previously requested: " })}{changes}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <button disabled={busy === id} onClick={() => void decide(id, "accept")}
                className="text-[11px] rounded px-3 py-1.5 border border-emerald-700 text-emerald-300 hover:bg-emerald-950 disabled:opacity-50">
                {busy === id ? t({ ar: "جارٍ…", en: "Working…" }) : t({ ar: "أوافق وأستلم نهائيًا", en: "Accept & sign off" })}
              </button>
              <button disabled={busy === id} onClick={() => void decide(id, "request_changes")}
                className="text-[11px] rounded px-3 py-1.5 border border-amber-700 text-amber-300 hover:bg-amber-950 disabled:opacity-50">
                {t({ ar: "أطلب تعديلات", en: "Request changes" })}
              </button>
              <button disabled={busy === id} onClick={() => void decide(id, "reject")}
                className="text-[11px] rounded px-3 py-1.5 border border-red-800 text-red-300 hover:bg-red-950 disabled:opacity-50">
                {t({ ar: "أرفض", en: "Reject" })}
              </button>
            </div>
          </div>
        );
      })}

      {msg && <p className="text-[11px] text-stone-200">{msg}</p>}
    </section>
  );
}
