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
  explore:       { href: "/client-portal/explore",       ar: "أدوات المشروع", en: "Project Tools" },
  projects:      { href: "/client-portal/projects",      ar: "مشاريعي",     en: "Projects",      adminAr: "المشاريع",             adminEn: "Projects" },
  quotes:        { href: "/client-portal/quotes",        ar: "طلبات السعر", en: "Quotes",        adminAr: "طلبات عروض السعر",     adminEn: "Quote Requests" },
  messages:      { href: "/client-portal/messages",      ar: "الرسائل",     en: "Messages",      adminAr: "رسائل العملاء",        adminEn: "Client Messages" },
  files:         { href: "/client-portal/files",         ar: "ملفاتي",      en: "My Files",      adminAr: "روابط وملفات العملاء", adminEn: "Client Files" },
  accounts:      { href: "/client-portal/accounts",      ar: "الحسابات",    en: "Accounts",      adminAr: "إدارة العملاء",        adminEn: "Accounts" },
  staff:         { href: "/client-portal/staff",         ar: "الموظفون",    en: "Staff" },
  whatsapp:      { href: "/client-portal/admin/whatsapp", ar: "صندوق واتساب", en: "WhatsApp Inbox" },
  opportunities: { href: "/client-portal/opportunities", ar: "مركز الفرص",  en: "Opportunities" },
  invoices:      { href: "/client-portal/invoices",      ar: "الفواتير",    en: "Invoices" },
  offers:        { href: "/client-portal/offers",        ar: "العروض",      en: "Offers" },
  notifications: { href: "/client-portal/notifications", ar: "الإشعارات",   en: "Notifications" },
  deliveries:    { href: "/client-portal/deliveries",    ar: "سجل التسليم",  en: "Delivery Log" },
  profile:       { href: "/client-portal/profile",       ar: "ملفي",        en: "Profile",       adminAr: "الإعدادات",            adminEn: "Settings" },
};

// Tab keys per viewer role. staff_role=null → client/lead/admin (unchanged).
const SETS: Record<ViewRole, string[]> = {
  admin:       ["overview", "projects", "quotes", "messages", "files", "accounts", "staff", "whatsapp", "opportunities", "invoices", "deliveries", "notifications", "profile"],
  super_admin: ["overview", "projects", "quotes", "messages", "files", "staff", "whatsapp", "opportunities", "invoices", "deliveries", "notifications", "profile"],
  manager:     ["overview", "projects", "quotes", "messages", "files", "whatsapp", "opportunities", "invoices", "deliveries", "notifications", "profile"],
  support:     ["messages", "files", "whatsapp", "notifications", "profile"],
  sales:       ["quotes", "whatsapp", "deliveries", "notifications", "profile"],
  editor:      ["projects", "notifications", "profile"],
  hr:          ["overview", "whatsapp", "opportunities", "notifications", "profile"],
  readonly:    ["projects", "notifications", "profile"],
  finance:     ["invoices", "whatsapp", "deliveries", "notifications", "profile"],
  client:      ["overview", "explore", "projects", "quotes", "messages", "files", "invoices", "offers", "notifications", "profile"],
  lead:        ["overview", "explore", "quotes", "messages", "files", "offers", "notifications", "profile"],
};

/** Applicant tab — appended by PortalShell only when the logged-in email matches
 *  one or more opportunity requests (so non-applicants never see it). */
export const MY_OPPORTUNITIES_TAB: PortalTab = {
  key: "my_opportunities", href: "/client-portal/my-opportunities", ar: "طلباتي", en: "My Requests",
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
