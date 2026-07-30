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
  project_core:  { href: "/client-portal/project-core",  ar: "إدارة المشاريع", en: "Project Core", adminAr: "منصّة المشاريع", adminEn: "Project Core", staffAr: "منصّة المشاريع", staffEn: "Project Core" },
  quotes:        { href: "/client-portal/quotes",        ar: "طلبات السعر", en: "Quotes",        adminAr: "طلبات عروض السعر",     adminEn: "Quote Requests" },
  messages:      { href: "/client-portal/messages",      ar: "الرسائل",     en: "Messages",      adminAr: "رسائل العملاء",        adminEn: "Client Messages" },
  files:         { href: "/client-portal/files",         ar: "ملفاتي",      en: "My Files",      adminAr: "روابط وملفات العملاء", adminEn: "Client Files" },
  accounts:      { href: "/client-portal/accounts",      ar: "الحسابات",    en: "Accounts",      adminAr: "إدارة العملاء",        adminEn: "Accounts" },
  staff:         { href: "/client-portal/staff",         ar: "الموظفون",    en: "Staff" },
  whatsapp:      { href: "/client-portal/admin/whatsapp", ar: "صندوق واتساب", en: "WhatsApp Inbox" },
  opportunities: { href: "/client-portal/opportunities", ar: "مركز الفرص",  en: "Opportunities" },
  equipment:     { href: "/client-portal/equipment",     ar: "تأجير المعدات", en: "Equipment Rental", adminAr: "العهدة والتأجير", adminEn: "Custody & Rental", staffAr: "العهدة", staffEn: "Custody" },
  asset_custody: { href: "/client-portal/asset-custody",  ar: "عهدتي المسجلة", en: "My Registered Custody", adminAr: "مخزون الأصول والعهد", adminEn: "Asset Inventory & Custody", staffAr: "عهدتي المسجلة", staffEn: "My Registered Custody" },
  rentals:       { href: "/client-portal/rentals",         ar: "تأجيراتي",      en: "My Rentals", adminAr: "تأجير المعدات", adminEn: "Equipment Rental", staffAr: "تأجير المعدات", staffEn: "Rental" },
  employee:      { href: "/client-portal/employee",      ar: "بوابة الموظف",  en: "Employee Portal", adminAr: "الموارد البشرية", adminEn: "Human Resources" },
  // مركز التشغيل والإنتاج (Phase 2) — داخليّ بحت: غائب عن مجموعتَي client/lead، والقاعدة
  // ترفض العميل حتى برابط مباشر (prodops_can_view = is_staff). الطاقم يرى إسناداته هو فقط.
  operations:    { href: "/client-portal/operations",    ar: "مركز التشغيل", en: "Operations", adminAr: "التشغيل والإنتاج", adminEn: "Production Operations", staffAr: "مهامّي الميدانية", staffEn: "My Field Work" },
  // وحدة المبيعات (Phase 3) — داخليّة بحتة: غائبة عن مجموعتَي client/lead،
  // والقاعدة ترفض العميل حتى برابط مباشر (crm_can_view = is_staff + مفتاح صريح).
  // موظّف المبيعات يرى سجلّاته هو؛ رؤية الفريق مفتاح مستقلّ لا يمنحه هذا التبويب.
  crm:           { href: "/client-portal/crm",           ar: "المبيعات",     en: "Sales", adminAr: "المبيعات وعلاقات العملاء", adminEn: "Sales & CRM", staffAr: "مبيعاتي", staffEn: "My Sales" },
  // المركز المالي (Phase 4) — داخليّ بحت وأخطر سطح في البرنامج: غائب عن مجموعتَي
  // client/lead، والقاعدة ترفض العميل حتى برابط مباشر (finops_can_view_finance_sensitive = is_staff+is_owner
  // + دور مالية أو مفتاح finance_ops.* صريح). الموظّف العاديّ يرى «طلباتي» فقط:
  // لا ميزانية ولا تكاليف غيره ولا هامش. التبويب ليس تفويضًا — المنع في القاعدة.
  finance_ops:   { href: "/client-portal/finance",       ar: "طلباتي المالية", en: "My Finance Requests", adminAr: "المالية والربحية", adminEn: "Finance & Profitability", staffAr: "طلباتي المالية", staffEn: "My Finance Requests" },
  // اللوحة التنفيذية (Phase 5) — قراءة فقط عبر الموديولات الأربعة. داخليّة بحتة:
  // غائبة عن مجموعتَي client/lead، والقاعدة ترفض العميل حتى برابط مباشر
  // (mgmt_can_view = is_staff + مفتاح exec_report.view أو ملكية). التبويب معروض
  // للمدير/المالك فقط لأنّ المفتاح لا يُمنَح افتراضيًّا؛ ولو ظهر لغير مُخوَّل
  // فالشاشة تقول «لا تملك صلاحية» بدل شاشة فارغة. المؤشّرات المالية والهوامش
  // مقصورة على المالك بنيويًّا ولا مفتاح لها إطلاقًا.
  executive:     { href: "/client-portal/executive",     ar: "اللوحة التنفيذية", en: "Executive", adminAr: "اللوحة التنفيذية", adminEn: "Executive Dashboard", staffAr: "اللوحة التنفيذية", staffEn: "Executive Dashboard" },
  invoices:      { href: "/client-portal/invoices",      ar: "الفواتير",    en: "Invoices" },
  offers:        { href: "/client-portal/offers",        ar: "العروض",      en: "Offers" },
  notifications: { href: "/client-portal/notifications", ar: "الإشعارات",   en: "Notifications" },
  profile:       { href: "/client-portal/profile",       ar: "ملفي",        en: "Profile",       adminAr: "الإعدادات",            adminEn: "Settings" },
};

// Tab keys per viewer role. staff_role=null → client/lead/admin (unchanged).
const SETS: Record<ViewRole, string[]> = {
  admin:       ["overview", "projects", "project_core", "quotes", "messages", "files", "accounts", "staff", "employee", "operations", "crm", "finance_ops", "executive", "whatsapp", "opportunities", "equipment", "asset_custody", "rentals", "invoices", "notifications", "profile"],
  super_admin: ["overview", "projects", "project_core", "quotes", "messages", "files", "staff", "employee", "operations", "crm", "finance_ops", "executive", "whatsapp", "opportunities", "equipment", "asset_custody", "rentals", "invoices", "notifications", "profile"],
  // org_admin — DAY ONE IS DELIBERATELY MINIMAL. The tier exists as an identity, not as
  // a bundle of powers: its capabilities are granted one at a time through the
  // permission engine after a trial account is tested. Giving it manager-like tabs here
  // would hand it broad reach the moment anyone is assigned the role, which is exactly
  // what the owner ruled out. Widen this list only with explicit approval.
  org_admin:   ["employee", "notifications", "profile"],
  manager:     ["overview", "projects", "project_core", "quotes", "messages", "files", "employee", "operations", "crm", "finance_ops", "executive", "whatsapp", "opportunities", "equipment", "asset_custody", "rentals", "invoices", "notifications", "profile"],
  support:     ["employee", "messages", "files", "whatsapp", "equipment", "asset_custody", "finance_ops", "notifications", "profile"],
  sales:       ["employee", "crm", "quotes", "whatsapp", "equipment", "asset_custody", "finance_ops", "notifications", "profile"],
  editor:      ["employee", "operations", "projects", "project_core", "equipment", "asset_custody", "finance_ops", "notifications", "profile"],
  hr:          ["employee", "overview", "whatsapp", "opportunities", "equipment", "asset_custody", "finance_ops", "notifications", "profile"],
  readonly:    ["employee", "projects", "equipment", "asset_custody", "finance_ops", "notifications", "profile"],
  // دور المالية: التبويب هنا يفتح المركز كاملًا **إن** منحته القاعدة ذلك. لا يشتقّ
  // هذا السطر ليس صلاحية: البوّابات في القاعدة هي الفاصل، وهذا مجرّد مدخل تنقّل.
  finance:     ["employee", "finance_ops", "invoices", "whatsapp", "equipment", "asset_custody", "rentals", "notifications", "profile"],
  photographer:     ["employee", "operations", "equipment", "asset_custody", "projects", "finance_ops", "notifications", "profile"],
  lighting_tech:    ["employee", "operations", "equipment", "asset_custody", "finance_ops", "notifications", "profile"],
  camera_assistant: ["employee", "operations", "equipment", "asset_custody", "finance_ops", "notifications", "profile"],
  custody_officer:  ["employee", "operations", "equipment", "asset_custody", "rentals", "finance_ops", "notifications", "profile"],
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
