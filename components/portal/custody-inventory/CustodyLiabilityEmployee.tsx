"use client";
// ════════════════════════════════════════════════════════════════════════
// P0-2 — Employee view of their OWN custody liabilities. Data comes from the
// redacted SECURITY DEFINER RPC custody_liability_my(): when show_to_employee is
// false the server returns amount = NULL (not merely hidden here) and never the
// internal note, so a case under review shows "under review" with no figure. The
// employee can dispute / comment on a visible case.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { civLiabilityMine, civLiabilityEmployeeRespond, type CivLiability } from "@/lib/portal/custodyInventory";

export default function CustodyLiabilityEmployee() {
  const { t } = useI18n();
  const [list, setList] = useState<CivLiability[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const say = (m: string) => { setFlash(m); window.setTimeout(() => setFlash(null), 4000); };

  const load = useCallback(async () => { const r = await civLiabilityMine(); if (r.ok) setList(r.data); }, []);
  useEffect(() => { void load(); }, [load]);

  async function respond(l: CivLiability, action: "dispute" | "accept") {
    let comment: string | undefined;
    if (action === "dispute") { const c = window.prompt(t({ ar: "سبب الاعتراض:", en: "Reason for dispute:" })); if (c == null) return; comment = c; }
    setBusy(true); const r = await civLiabilityEmployeeRespond(l.id, action, comment); setBusy(false);
    if (!r.ok) return say(t({ ar: "تعذّر: ", en: "Failed: " }) + r.error);
    say(t({ ar: "تم إرسال ردّك.", en: "Your response was sent." })); void load();
  }

  if (list.length === 0) return null;
  return (
    <div className="border-t border-stone-800 pt-6">
      <h2 className="text-sm font-medium text-stone-400 mb-3">{t({ ar: "حالات والتزامات العهدة", en: "Custody cases & liabilities" })}</h2>
      {flash && <div className="text-xs text-amber-300 mb-2">{flash}</div>}
      <div className="space-y-2">
        {list.map((l) => {
          const hidden = !l.show_to_employee;   // amount arrives NULL from the server when hidden
          return (
            <div key={l.id} className="rounded-lg border border-stone-700 bg-stone-800/40 p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[12.5px] text-white">
                  <span className="font-semibold">{l.liability_type}</span>
                  {l.asset_name && <span className="text-stone-400"> · {l.asset_name}</span>}
                </div>
                <span className="text-[10.5px] text-amber-300 border border-amber-400/30 rounded px-2 py-0.5">{l.status}</span>
              </div>
              {hidden ? (
                <div className="text-[12px] text-stone-400 mt-1.5">{t({ ar: "حالة إرجاع عهدتك قيد المراجعة من قبل الإدارة.", en: "Your custody return case is under review by management." })}</div>
              ) : (
                <div className="mt-1.5 text-[12.5px] text-stone-200">
                  {l.amount != null && <div dir="ltr">{t({ ar: "المبلغ:", en: "Amount:" })} {l.amount} {l.currency}</div>}
                  {l.description && <div className="text-stone-300 mt-0.5">{l.description}</div>}
                  {l.calculation_basis && <div className="text-stone-400 text-[11px] mt-0.5">{t({ ar: "الأساس:", en: "Basis:" })} {l.calculation_basis}</div>}
                  {l.due_date && <div className="text-stone-400 text-[11px] mt-0.5" dir="ltr">{t({ ar: "الاستحقاق:", en: "Due:" })} {new Date(l.due_date).toLocaleDateString("en-GB")}</div>}
                </div>
              )}
              {!hidden && !["waived", "closed", "paid", "deducted", "disputed"].includes(l.status) && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => respond(l, "dispute")} disabled={busy} className="text-[11px] text-red-300 border border-red-700/50 rounded px-2.5 py-1">{t({ ar: "اعتراض", en: "Dispute" })}</button>
                  <button onClick={() => respond(l, "accept")} disabled={busy} className="text-[11px] text-emerald-300 border border-emerald-700/50 rounded px-2.5 py-1">{t({ ar: "قبول", en: "Accept" })}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
