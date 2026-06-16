// ════════════════════════════════════════════════════════════════════════
// Kian Portal — role-aware tab registry. Tabs depend on the viewer's role:
// owner/super_admin/manager see the admin area; editor/support/sales/hr/readonly
// see scoped staff views; clients/leads see the client portal (unchanged). Data
// access itself is RLS-enforced — tabs only shape the experience.
// ════════════════════════════════════════════════════════════════════════
import type { Profile } from "@/lib/portal/types";
import { caps, type ViewRole } from "@/lib/portal/roles";

export interface PortalTab { key: string; href: string; ar: string; en: string; }

interface TabDef { href: string; ar: string; en: string; adminAr?: string; adminEn?: string; }

const REG: Record<string, TabDef> = {
  overview:      { href: "/client-portal",               ar: "نظرة عامة",   en: "Overview",      adminAr: "لوحة الإدارة",         adminEn: "Admin Dashboard" },
  projects:      { href: "/client-portal/projects",      ar: "مشاريعي",     en: "Projects",      adminAr: "المشاريع",             adminEn: "Projects" },
  quotes:        { href: "/client-portal/quotes",        ar: "طلبات السعر", en: "Quotes",        adminAr: "طلبات عروض السعر",     adminEn: "Quote Requests" },
  messages:      { href: "/client-portal/messages",      ar: "الرسائل",     en: "Messages",      adminAr: "رسائل العملاء",        adminEn: "Client Messages" },
  files:         { href: "/client-portal/files",         ar: "ملفاتي",      en: "My Files",      adminAr: "روابط وملفات العملاء", adminEn: "Client Files" },
  accounts:      { href: "/client-portal/accounts",      ar: "الحسابات",    en: "Accounts",      adminAr: "إدارة العملاء",        adminEn: "Accounts" },
  staff:         { href: "/client-portal/staff",         ar: "الموظفون",    en: "Staff" },
  offers:        { href: "/client-portal/offers",        ar: "العروض",      en: "Offers" },
  notifications: { href: "/client-portal/notifications", ar: "الإشعارات",   en: "Notifications" },
  profile:       { href: "/client-portal/profile",       ar: "ملفي",        en: "Profile",       adminAr: "الإعدادات",            adminEn: "Settings" },
};

// Tab keys per viewer role. staff_role=null → client/lead/admin (unchanged).
const SETS: Record<ViewRole, string[]> = {
  admin:       ["overview", "projects", "quotes", "messages", "files", "accounts", "staff", "notifications", "profile"],
  super_admin: ["overview", "projects", "quotes", "messages", "files", "staff", "notifications", "profile"],
  manager:     ["overview", "projects", "quotes", "messages", "files", "notifications", "profile"],
  support:     ["messages", "files", "notifications", "profile"],
  sales:       ["quotes", "notifications", "profile"],
  editor:      ["projects", "notifications", "profile"],
  hr:          ["overview", "notifications", "profile"],
  readonly:    ["projects", "notifications", "profile"],
  client:      ["overview", "projects", "quotes", "messages", "files", "offers", "notifications", "profile"],
  lead:        ["overview", "quotes", "messages", "files", "offers", "notifications", "profile"],
};

/** Tabs for the viewer, with admin-area label overrides resolved. */
export function tabsForViewer(p: Pick<Profile, "account_type" | "staff_role">): PortalTab[] {
  const c = caps(p);
  const useAdminLabels = c.isAdminArea;
  const keys = SETS[c.view] ?? SETS.client;
  return keys.map((k) => {
    const r = REG[k];
    return {
      key: k,
      href: r.href,
      ar: useAdminLabels ? (r.adminAr ?? r.ar) : r.ar,
      en: useAdminLabels ? (r.adminEn ?? r.en) : r.en,
    };
  });
}
