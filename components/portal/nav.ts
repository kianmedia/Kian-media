// ════════════════════════════════════════════════════════════════════════
// Kian Portal — role-aware tab registry.
// Labels differ by role: clients/leads see a client portal; admins see an
// admin dashboard. Adding a future section = one entry + one route folder.
// ════════════════════════════════════════════════════════════════════════

import type { AccountType } from "@/lib/portal/types";

export interface PortalTab {
  key: string;
  href: string;
  ar: string;
  en: string;
  /** Admin-specific overrides (fall back to ar/en when absent). */
  adminAr?: string;
  adminEn?: string;
  roles: AccountType[];
}

const TABS: PortalTab[] = [
  { key: "overview",      href: "/client-portal",               ar: "نظرة عامة",   en: "Overview",      adminAr: "لوحة الإدارة",          adminEn: "Admin Dashboard", roles: ["lead", "client", "admin"] },
  { key: "projects",      href: "/client-portal/projects",      ar: "مشاريعي",     en: "Projects",      adminAr: "المشاريع",              adminEn: "Projects",        roles: ["client", "admin"] },
  { key: "quotes",        href: "/client-portal/quotes",        ar: "طلبات السعر", en: "Quotes",        adminAr: "طلبات عروض السعر",      adminEn: "Quote Requests",  roles: ["lead", "client", "admin"] },
  { key: "messages",      href: "/client-portal/messages",      ar: "الرسائل",     en: "Messages",      adminAr: "رسائل العملاء",         adminEn: "Client Messages", roles: ["lead", "client", "admin"] },
  { key: "files",         href: "/client-portal/files",         ar: "ملفاتي",      en: "My Files",      adminAr: "روابط وملفات العملاء",  adminEn: "Client Files",    roles: ["lead", "client", "admin"] },
  { key: "accounts",      href: "/client-portal/accounts",      ar: "الحسابات",    en: "Accounts",      adminAr: "إدارة العملاء",         adminEn: "Accounts",        roles: ["admin"] },
  { key: "offers",        href: "/client-portal/offers",        ar: "العروض",      en: "Offers",        roles: ["lead", "client"] },
  { key: "notifications", href: "/client-portal/notifications", ar: "الإشعارات",   en: "Notifications", roles: ["lead", "client", "admin"] },
  { key: "profile",       href: "/client-portal/profile",       ar: "ملفي",        en: "Profile",       adminAr: "الإعدادات",             adminEn: "Settings",        roles: ["lead", "client", "admin"] },
  // Reserved — uncomment + add route folder to activate:
  // { key: "opportunities", href: "/client-portal/opportunities", ar: "مركز الفرص", en: "Opportunities", roles: ["lead", "client", "admin"] },
];

/** Tabs for a role, with admin label overrides already resolved into ar/en. */
export function tabsForRole(role: AccountType): PortalTab[] {
  return TABS.filter((t) => t.roles.includes(role)).map((t) =>
    role === "admin"
      ? { ...t, ar: t.adminAr ?? t.ar, en: t.adminEn ?? t.en }
      : t
  );
}
