// ════════════════════════════════════════════════════════════════════════
// Kian Portal — role-aware tab registry. Tabs depend on the viewer's role:
// owner/super_admin/manager see the admin area; editor/support/sales/hr/readonly
// see scoped staff views; clients/leads see the client portal (unchanged). Data
// access itself is RLS-enforced — tabs only shape the experience.
// ════════════════════════════════════════════════════════════════════════
import type { Profile } from "@/lib/portal/types";
import { caps, type ViewRole } from "@/lib/portal/roles";

export interface PortalTab { key: string; href: string; ar: string; en: string; }

interface TabDef { href: string; ar: string; en: string; adminAr?: string; adminEn?: string; staffAr?: string; staffEn?: string; }

const REG: Record<string, TabDef> = {
  overview:      { href: "/client-portal",               ar: "نظرة عامة",   en: "Overview",      adminAr: "لوحة الإدارة",         adminEn: "Admin Dashboard" },
  projects:      { href: "/client-portal/projects",      ar: "مشاريعي",     en: "Projects",      adminAr: "المشاريع",             adminEn: "Projects" },
  quotes:        { href: "/client-portal/quotes",        ar: "طلبات السعر", en: "Quotes",        adminAr: "طلبات عروض السعر",     adminEn: "Quote Requests" },
  messages:      { href: "/client-portal/messages",      ar: "الرسائل",     en: "Messages",      adminAr: "رسائل العملاء",        adminEn: "Client Messages" },
  files:         { href: "/client-portal/files",         ar: "ملفاتي",      en: "My Files",      adminAr: "روابط وملفات العملاء", adminEn: "Client Files" },
  accounts:      { href: "/client-portal/accounts",      ar: "الحسابات",    en: "Accounts",      adminAr: "إدارة العملاء",        adminEn: "Accounts" },
  staff:         { href: "/client-portal/staff",         ar: "الموظفون",    en: "Staff" },
  whatsapp:      { href: "/client-portal/admin/whatsapp", ar: "صندوق واتساب", en: "WhatsApp Inbox" },
  opportunities: { href: "/client-portal/opportunities", ar: "مركز الفرص",  en: "Opportunities" },
  testimonials:  { href: "/client-portal/testimonials",   ar: "آراء العملاء", en: "Testimonials" },
  equipment:     { href: "/client-portal/equipment",     ar: "تأجير المعدات", en: "Equipment Rental", adminAr: "العهدة والتأجير", adminEn: "Custody & Rental", staffAr: "العهدة", staffEn: "Custody" },
  asset_custody: { href: "/client-portal/asset-custody",  ar: "عهدتي المسجلة", en: "My Registered Custody", adminAr: "مخزون الأصول والعهد", adminEn: "Asset Inventory & Custody", staffAr: "عهدتي المسجلة", staffEn: "My Registered Custody" },
  rentals:       { href: "/client-portal/rentals",         ar: "تأجيراتي",      en: "My Rentals", adminAr: "تأجير المعدات", adminEn: "Equipment Rental", staffAr: "تأجير المعدات", staffEn: "Rental" },
  employee:      { href: "/client-portal/employee",      ar: "بوابة الموظف",  en: "Employee Portal", adminAr: "الموارد البشرية", adminEn: "Human Resources" },
  invoices:      { href: "/client-portal/invoices",      ar: "الفواتير",    en: "Invoices" },
  offers:        { href: "/client-portal/offers",        ar: "العروض",      en: "Offers" },
  notifications: { href: "/client-portal/notifications", ar: "الإشعارات",   en: "Notifications" },
  profile:       { href: "/client-portal/profile",       ar: "ملفي",        en: "Profile",       adminAr: "الإعدادات",            adminEn: "Settings" },
};

// Tab keys per viewer role. staff_role=null → client/lead/admin (unchanged).
const SETS: Record<ViewRole, string[]> = {
  admin:       ["overview", "projects", "quotes", "messages", "files", "accounts", "staff", "employee", "whatsapp", "opportunities", "testimonials", "equipment", "asset_custody", "rentals", "invoices", "notifications", "profile"],
  super_admin: ["overview", "projects", "quotes", "messages", "files", "staff", "employee", "whatsapp", "opportunities", "testimonials", "equipment", "asset_custody", "rentals", "invoices", "notifications", "profile"],
  manager:     ["overview", "projects", "quotes", "messages", "files", "employee", "whatsapp", "opportunities", "testimonials", "equipment", "asset_custody", "rentals", "invoices", "notifications", "profile"],
  support:     ["employee", "messages", "files", "whatsapp", "equipment", "notifications", "profile"],
  sales:       ["employee", "quotes", "whatsapp", "equipment", "notifications", "profile"],
  editor:      ["employee", "projects", "equipment", "notifications", "profile"],
  hr:          ["employee", "overview", "whatsapp", "opportunities", "equipment", "notifications", "profile"],
  readonly:    ["employee", "projects", "equipment", "notifications", "profile"],
  finance:     ["employee", "invoices", "whatsapp", "equipment", "rentals", "notifications", "profile"],
  photographer:     ["employee", "equipment", "projects", "notifications", "profile"],
  lighting_tech:    ["employee", "equipment", "notifications", "profile"],
  camera_assistant: ["employee", "equipment", "notifications", "profile"],
  custody_officer:  ["employee", "equipment", "asset_custody", "rentals", "notifications", "profile"],
  client:      ["overview", "projects", "quotes", "messages", "files", "invoices", "offers", "equipment", "rentals", "notifications", "profile"],
  lead:        ["overview", "quotes", "messages", "files", "offers", "equipment", "notifications", "profile"],
};

/** Applicant tab — appended by PortalShell only when the logged-in email matches
 *  one or more opportunity requests (so non-applicants never see it). */
export const MY_OPPORTUNITIES_TAB: PortalTab = {
  key: "my_opportunities", href: "/client-portal/my-opportunities", ar: "طلباتي", en: "My Requests",
};

/** Tabs for the viewer, with admin-area / staff label overrides resolved
 *  (e.g. equipment: clients see "تأجير المعدات", staff see "العهدة",
 *   admin area sees "العهدة والتأجير"). */
export function tabsForViewer(p: Pick<Profile, "account_type" | "staff_role">): PortalTab[] {
  const c = caps(p);
  const useAdminLabels = c.isAdminArea;
  const useStaffLabels = !useAdminLabels && c.isStaff;
  const keys = SETS[c.view] ?? SETS.client;
  return keys.map((k) => {
    const r = REG[k];
    return {
      key: k,
      href: r.href,
      ar: useAdminLabels ? (r.adminAr ?? r.ar) : useStaffLabels ? (r.staffAr ?? r.ar) : r.ar,
      en: useAdminLabels ? (r.adminEn ?? r.en) : useStaffLabels ? (r.staffEn ?? r.en) : r.en,
    };
  });
}
