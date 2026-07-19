"use client";
// ════════════════════════════════════════════════════════════════════════
// P0-2 — Admin custody liability panel. Create/list liabilities, drive the
// 8-state machine, toggle employee visibility, add internal notes, view the
// audited event trail. Financial transitions (approve/waive/paid/deducted)
// are gated server-side (civ_can_admin OR custody.approve_compensation) — a
// denied manager gets a "not authorized: compensation" error surfaced here.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  civLiabilityAdminList, civLiabilityCreate, civLiabilitySetStatus, civLiabilitySetVisibility,
  civLiabilitySetInternalNote, civLiabilityEvents, civLiabilityAmend,
  type CivLiability, type CivLiabilityStatus, type CivLiabilityEvent,
} from "@/lib/portal/custodyInventory";

const TYPES = ["repair", "missing_accessory", "asset_damage", "missing_asset", "replacement", "other"] as const;
const STATUSES: CivLiabilityStatus[] = ["draft", "pending_admin_approval", "approved", "disputed", "waived", "paid", "deducted", "closed"];
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 3, padding: "7px 9px", color: "#fff", fontSize: 12.5, outline: "none" };

export default function CustodyLiabilityAdmin({ assignmentId, employeeUserId }: { assignmentId?: string; employeeUserId?: string }) {
  const [list, setList] = useState<CivLiability[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [events, setEvents] = useState<Record<string, CivLiabilityEvent[]>>({});
  const [form, setForm] = useState({ liability_type: "repair", amount: "", currency: "SAR", description: "", calculation_basis: "", internal_note: "", show_to_employee: false });
  const say = (m: string) => { setFlash(m); window.setTimeout(() => setFlash(null), 4000); };

  const load = useCallback(async () => {
    const r = await civLiabilityAdminList(assignmentId ? { assignment: assignmentId } : undefined);
    if (r.ok) setList(r.data);
  }, [assignmentId]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (busy) return; setBusy(true);
    const r = await civLiabilityCreate({
      assignment_id: assignmentId ?? null, employee_user_id: employeeUserId ?? null,
      liability_type: form.liability_type, amount: form.amount || null, currency: form.currency,
      description: form.description || null, calculation_basis: form.calculation_basis || null,
      internal_note: form.internal_note || null, show_to_employee: form.show_to_employee,
    });
    setBusy(false);
    if (!r.ok) return say("تعذّر الإنشاء: " + r.error);
    setCreating(false); setForm({ liability_type: "repair", amount: "", currency: "SAR", description: "", calculation_basis: "", internal_note: "", show_to_employee: false });
    say("سُجّل الالتزام."); void load();
  }
  async function setStatus(l: CivLiability, s: CivLiabilityStatus) {
    setBusy(true); const r = await civLiabilitySetStatus(l.id, s); setBusy(false);
    if (!r.ok) return say("تعذّر تغيير الحالة: " + r.error);
    say("تم التحديث."); void load();
  }
  async function toggleVis(l: CivLiability) {
    setBusy(true); const r = await civLiabilitySetVisibility(l.id, !l.show_to_employee); setBusy(false);
    if (!r.ok) return say("تعذّر: " + r.error);
    void load();
  }
  async function amendAmount(l: CivLiability) {
    const a = window.prompt("المبلغ الجديد:", l.amount != null ? String(l.amount) : "");
    if (a == null) return;
    setBusy(true); const r = await civLiabilityAmend(l.id, { amount: a || null }); setBusy(false);
    if (!r.ok) return say("تعذّر: " + r.error); void load();
  }
  async function note(l: CivLiability) {
    const n = window.prompt("ملاحظة داخلية (لا تُعرض للموظف):", l.internal_note ?? "");
    if (n == null) return;
    setBusy(true); const r = await civLiabilitySetInternalNote(l.id, n); setBusy(false);
    if (!r.ok) return say("تعذّر: " + r.error); void load();
  }
  async function showEvents(l: CivLiability) {
    if (events[l.id]) { setEvents((e) => { const c = { ...e }; delete c[l.id]; return c; }); return; }
    const r = await civLiabilityEvents(l.id);
    if (r.ok) setEvents((e) => ({ ...e, [l.id]: r.data }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="flex items-center justify-between">
        <span className="f-sans" style={{ fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>التزامات / تعويضات العهدة ({list.length})</span>
        <button onClick={() => setCreating((v) => !v)} className="f-sans" style={{ fontSize: 11, color: "#fff", background: "rgba(227,30,36,0.16)", border: "1px solid rgba(227,30,36,0.45)", borderRadius: 4, padding: "6px 11px", cursor: "pointer" }}>+ التزام جديد</button>
      </div>
      {flash && <div className="f-sans" style={{ fontSize: 12, color: "#ffd28a" }}>{flash}</div>}

      {creating && (
        <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, padding: 11, display: "flex", flexDirection: "column", gap: 7 }}>
          <div className="flex gap-2 flex-wrap">
            <select value={form.liability_type} onChange={(e) => setForm({ ...form, liability_type: e.target.value })} style={{ ...inp, colorScheme: "dark" }}>{TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="المبلغ" type="number" style={{ ...inp, width: 110 }} />
            <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="العملة" style={{ ...inp, width: 70 }} />
          </div>
          <input value={form.calculation_basis} onChange={(e) => setForm({ ...form, calculation_basis: e.target.value })} placeholder="أساس الحساب (فاتورة/تقدير)" style={inp} />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="الوصف (يُعرض للموظف عند الإظهار)" style={{ ...inp, minHeight: 44 }} />
          <textarea value={form.internal_note} onChange={(e) => setForm({ ...form, internal_note: e.target.value })} placeholder="ملاحظة داخلية (لا تُعرض للموظف أبدًا)" style={{ ...inp, minHeight: 36 }} />
          <label className="f-sans flex items-center gap-2" style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
            <input type="checkbox" checked={form.show_to_employee} onChange={(e) => setForm({ ...form, show_to_employee: e.target.checked })} /> إظهار المبلغ للموظف
          </label>
          <div className="flex gap-2">
            <button onClick={create} disabled={busy} className="btn-red">{busy ? "…" : "حفظ"}</button>
            <button onClick={() => setCreating(false)} className="f-sans" style={{ ...inp, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {list.map((l) => (
        <div key={l.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, padding: 11 }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="f-sans" style={{ fontSize: 12.5, color: "#fff" }}>
              <span style={{ fontWeight: 700 }}>{l.liability_type}</span>
              {l.amount != null && <span dir="ltr"> · {l.amount} {l.currency}</span>}
              {l.asset_name && <span style={{ color: "rgba(255,255,255,0.5)" }}> · {l.asset_name}</span>}
              {l.employee_name && <span style={{ color: "rgba(255,255,255,0.5)" }}> · {l.employee_name}</span>}
            </div>
            <span className="f-sans" style={{ fontSize: 10.5, color: "#ffd28a", border: "1px solid rgba(255,210,138,0.35)", borderRadius: 2, padding: "2px 6px" }}>{l.status}</span>
          </div>
          {l.description && <div className="f-sans" style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>{l.description}</div>}
          <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 7 }}>
            <span className="f-sans" style={{ fontSize: 10.5, color: l.show_to_employee ? "#7CFC9A" : "rgba(255,255,255,0.45)" }}>{l.show_to_employee ? "👁 مرئي للموظف" : "🚫 مخفي عن الموظف"}</span>
            <button onClick={() => toggleVis(l)} disabled={busy} className="f-sans" style={{ fontSize: 10.5, ...inp, cursor: "pointer", padding: "3px 8px" }}>{l.show_to_employee ? "إخفاء" : "إظهار"}</button>
            <select value={l.status} onChange={(e) => setStatus(l, e.target.value as CivLiabilityStatus)} disabled={busy} style={{ ...inp, colorScheme: "dark", fontSize: 11, padding: "3px 6px" }}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <button onClick={() => amendAmount(l)} disabled={busy} className="f-sans" style={{ fontSize: 10.5, ...inp, cursor: "pointer", padding: "3px 8px" }}>تعديل المبلغ</button>
            <button onClick={() => note(l)} disabled={busy} className="f-sans" style={{ fontSize: 10.5, ...inp, cursor: "pointer", padding: "3px 8px" }}>ملاحظة داخلية</button>
            <button onClick={() => showEvents(l)} className="f-sans" style={{ fontSize: 10.5, ...inp, cursor: "pointer", padding: "3px 8px" }}>{events[l.id] ? "إخفاء السجل" : "السجل"}</button>
          </div>
          {events[l.id] && (
            <div style={{ marginTop: 7, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
              {events[l.id].map((e) => (
                <div key={e.id} className="f-sans" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.6)" }}>
                  <span dir="ltr">{new Date(e.created_at).toLocaleString("en-GB")}</span> · {e.event_type}
                  {e.previous_status && e.new_status && <span> ({e.previous_status}→{e.new_status})</span>}
                  {e.actor_name && <span style={{ color: "rgba(255,255,255,0.4)" }}> · {e.actor_name}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {list.length === 0 && <div className="f-sans" style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>لا التزامات مسجّلة.</div>}
    </div>
  );
}
