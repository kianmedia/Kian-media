// ════════════════════════════════════════════════════════════════════════
// Kian Portal — in-portal notification center (poll-driven in Phase 1).
// RLS limits rows to the logged-in recipient; mark-read is column-granted.
// ════════════════════════════════════════════════════════════════════════

import { pget, ppatch, enc, currentUserId, type Result } from "@/lib/portal/client";
import type { NotificationRow } from "@/lib/portal/types";

export function listNotifications(limit = 30): Promise<Result<NotificationRow[]>> {
  return pget<NotificationRow[]>(`notifications?select=*&order=created_at.desc&limit=${limit}`);
}

export async function unreadCount(): Promise<Result<number>> {
  // Count only personally-targeted unread (recipient_id = me). Admin broadcasts
  // (recipient_id = null) are a read-only feed and have no per-user read state,
  // so excluding them keeps the badge from being permanently stuck for admins.
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await pget<NotificationRow[]>(
    `notifications?select=id&read_at=is.null&recipient_id=eq.${enc(uid)}`,
    { count: true }
  );
  if (!r.ok) return r;
  return { ok: true, data: r.count ?? r.data.length };
}

export async function markRead(id: string): Promise<Result<null>> {
  const r = await ppatch<NotificationRow[]>(
    `notifications?id=eq.${enc(id)}`,
    { read_at: new Date().toISOString() }
  );
  return r.ok ? { ok: true, data: null } : r;
}

export async function markAllRead(): Promise<Result<null>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppatch<NotificationRow[]>(
    `notifications?recipient_id=eq.${enc(uid)}&read_at=is.null`,
    { read_at: new Date().toISOString() }
  );
  return r.ok ? { ok: true, data: null } : r;
}
