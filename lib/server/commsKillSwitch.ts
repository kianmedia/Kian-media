// ════════════════════════════════════════════════════════════════════════════
// lib/server/commsKillSwitch.ts — ONE switch that stops every legacy email
// sender at once.
//
// WHY
//   The audit found five independent code paths posting the same
//   `_type:"portal_notify"` payload to the same relay, with three different
//   enable flags and two opposite defaults
//   (docs/NOTIFICATIONS_CURRENT_STATE_AUDIT.md §5). The browser one (D5) is now
//   gone. The three server ones (project / custody+rental / HR) still exist and
//   still work exactly as before — deleting them would break live paths for no
//   gain, since they are server-side, authenticated and already flagged.
//
//   What was missing was a way to stop ALL of them in one action. Chasing three
//   env vars across two systems during an incident is how a mistake gets made.
//
// BEHAVIOUR
//   COMMS_LEGACY_SENDERS_ENABLED unset  → unchanged (every existing flag rules)
//   COMMS_LEGACY_SENDERS_ENABLED=false  → every legacy sender reports `disabled`
//
//   Note the polarity: this switch can only ever turn senders OFF. It cannot
//   enable a sender that its own module flag disabled, so flipping it can never
//   cause a send that was not already possible.
//
// ⚠️ This is a kill switch, not authorization. Each sender keeps its own gate.
// ════════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/commsKillSwitch must never be imported in the browser");
}

/** False only when explicitly set to "false". Default keeps today's behaviour. */
export function legacySendersEnabled(): boolean {
  return (process.env.COMMS_LEGACY_SENDERS_ENABLED ?? "").trim() !== "false";
}

/** Reason string every disabled sender reports, so the logs read the same way. */
export const LEGACY_SENDERS_DISABLED_REASON = "disabled_by_comms_kill_switch";
