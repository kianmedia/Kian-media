// ════════════════════════════════════════════════════════════════════════
// Kian Portal — own profile & notification preferences.
// Column-level grants restrict updates to exactly these fields; the role/
// status/level columns are not updatable from the browser by design.
// ════════════════════════════════════════════════════════════════════════

import { pget, ppatch, enc, currentUserId, type Result } from "@/lib/portal/client";
import type { Company, NotificationPreferences, Profile } from "@/lib/portal/types";

/** The only profile fields a user may edit (matches the DB column grant). */
export type EditableProfileFields = Partial<
  Pick<Profile, "full_name" | "company" | "mobile" | "preferred_lang" | "marketing_opt_in">
>;

export async function updateMyProfile(fields: EditableProfileFields): Promise<Result<Profile | null>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppatch<Profile[]>(`profiles?id=eq.${enc(uid)}`, fields);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}

export async function getMyCompany(): Promise<Result<Company | null>> {
  const r = await pget<Company[]>(`companies?select=*&limit=1`);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}

export async function getMyPrefs(): Promise<Result<NotificationPreferences | null>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await pget<NotificationPreferences[]>(`notification_preferences?user_id=eq.${enc(uid)}&select=*`);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}

export async function updateMyPrefs(
  fields: Partial<Pick<NotificationPreferences, "portal_enabled" | "email_enabled" | "whatsapp_enabled">>
): Promise<Result<NotificationPreferences | null>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppatch<NotificationPreferences[]>(`notification_preferences?user_id=eq.${enc(uid)}`, fields);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}
