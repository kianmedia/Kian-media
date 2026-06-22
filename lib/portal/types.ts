// ════════════════════════════════════════════════════════════════════════
// Kian Portal — TypeScript types for the Phase 0/1 schema.
// Mirrors docs/phase0_migration.sql (+ phase1_addendum_s1.sql RPCs).
// ════════════════════════════════════════════════════════════════════════

// ─── Enums ───
export type AccountType    = "lead" | "client" | "admin";
export type AccountStatus  = "active" | "inactive" | "blocked";
export type ClientLevel    = "prospect" | "active" | "vip";
export type PreferredLang  = "ar" | "en";

/** Staff tiers (profiles.staff_role; NULL = not staff). DB-enforced via RLS/RPCs
 *  added in docs/staff_roles_task_assignment_RUNME.sql. */
export type StaffRole =
  | "super_admin" | "manager" | "support" | "editor" | "sales" | "hr" | "readonly" | "finance";

export type ProjectMemberRole =
  | "client_owner" | "client_member"
  | "kian_admin" | "kian_manager" | "kian_editor" | "kian_photographer" | "kian_viewer";

/** Live projects.status values used by the portal timeline. */
export type ProjectStatus =
  | "request_received" | "pre_production" | "shooting_scheduled"
  | "shooting_completed" | "editing" | "ready_for_review" | "delivered";

export type DeliverableStatus =
  | "draft" | "internal_review" | "client_review"
  | "revision_requested" | "approved" | "final_delivered" | "archived";

/** Deliverable states a client account is allowed to see (RLS-enforced). */
export const CLIENT_VISIBLE_DLV_STATUSES: readonly DeliverableStatus[] =
  ["client_review", "revision_requested", "approved", "final_delivered"];

export type DeliverableType = "video" | "photo" | "other";
export type ReviewDecision  = "approved" | "revision_requested";

export type QuoteStatus =
  | "new" | "in_review" | "quoted" | "accepted" | "rejected" | "archived";

export type NotificationType =
  | "quote_request_new" | "message_new" | "file_link_new" | "project_note_new"
  | "deliverable_new" | "revision_requested" | "deliverable_approved"
  | "deliverable_final_delivered" | "project_status_changed" | "opportunity_new"
  | "whatsapp_new"
  | "quote_sent" | "quote_accepted" | "quote_revision_requested" | "invoice_visible";

export type OfferAudience = "all" | "leads" | "clients";
export type InternalCommentCategory = "editor" | "production" | "budget" | "qa" | "general";

/** Tables carrying soft-delete columns (whitelist of public.soft_delete()). */
export type SoftDeletableTable =
  | "companies" | "clients" | "projects" | "project_members" | "quote_requests"
  | "messages" | "file_links" | "offers" | "project_notes" | "deliverables"
  | "deliverable_assets" | "client_comments" | "internal_comments"
  | "deliverable_reviews" | "project_messages" | "admin_notes";

// ─── Shared row fragments ───
export interface SoftDeletable {
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
}

// ─── Rows ───
export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  company: string | null;          // free-text (transition)
  company_id: string | null;
  mobile: string | null;
  preferred_lang: PreferredLang;
  account_type: AccountType;
  account_status: AccountStatus;
  client_level: ClientLevel;
  staff_role: StaffRole | null;
  marketing_opt_in: boolean;
  created_at: string;
  updated_at: string;
}

export interface Company extends SoftDeletable {
  id: string;
  name: string;
  name_en: string | null;
  cr_number: string | null;
  vat_number: string | null;
  city: string | null;
  created_at: string;
}

export interface NotificationPreferences {
  user_id: string;
  portal_enabled: boolean;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  recipient_id: string | null;     // null ⇒ admin broadcast
  recipient_role: "user" | "admin";
  type: NotificationType;
  title_ar: string;
  title_en: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface QuoteRequest extends SoftDeletable {
  id: string;
  user_id: string;
  reference: string | null;
  services: string[];
  description: string | null;
  budget_range: string | null;
  city: string | null;
  preferred_date: string | null;   // ISO date
  status: QuoteStatus;
  sheet_mirrored: boolean;
  zoho_deal_id: string | null;
  zoho_books_estimate_id: string | null;
  created_at: string;
}

export interface MessageRow extends SoftDeletable {
  id: string;
  user_id: string;                 // conversation owner
  sender: "user" | "admin";
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface FileLink extends SoftDeletable {
  id: string;
  user_id: string;
  project_id: string | null;
  url: string;
  label: string | null;
  created_at: string;
}

export interface Offer extends SoftDeletable {
  id: string;
  title_ar: string | null;
  title_en: string | null;
  body_ar: string | null;
  body_en: string | null;
  audience: OfferAudience;
  is_published: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

/** Legacy `clients` table (admin-provisioned; the client→project link). */
export interface ClientRow extends SoftDeletable {
  id: string;
  user_id: string;
  full_name: string | null;
  company: string | null;
  mobile: string | null;
  email: string | null;
  created_at: string;
}

export interface Project extends SoftDeletable {
  id: string;
  project_name: string;
  status: ProjectStatus | string;  // legacy column has no CHECK — tolerate unknowns
  shooting_date: string | null;
  delivery_status: string | null;
  revision_status: string | null;
  download_url: string | null;
  notes: string | null;
  client_id: string;
  company_id: string | null;
  created_at: string;
}

export interface ProjectMember extends SoftDeletable {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectMemberRole;
  added_by: string | null;
  created_at: string;
}

export interface ProjectNote extends SoftDeletable {
  id: string;
  project_id: string;
  author_id: string;
  author_role: "client" | "admin";
  body: string | null;
  reference_url: string | null;
  created_at: string;
}

export interface Deliverable extends SoftDeletable {
  id: string;
  project_id: string;
  title: string;
  type: DeliverableType;
  version: number;
  preview_url: string | null;
  vimeo_video_id: string | null;
  vimeo_review_url: string | null;
  watermark_required: boolean;
  allow_download: boolean;
  status: DeliverableStatus;
  created_at: string;
}

export interface ClientComment extends SoftDeletable {
  id: string;
  deliverable_id: string;
  author_id: string;
  author_role: "client" | "admin";
  body: string;
  timecode_seconds: number | null;
  resolved_at: string | null;
  created_at: string;
}

export interface InternalComment extends SoftDeletable {
  id: string;
  project_id: string | null;
  deliverable_id: string | null;
  author_id: string;
  category: InternalCommentCategory;
  body: string;
  timecode_seconds: number | null;
  created_at: string;
}

export interface DeliverableReview extends SoftDeletable {
  id: string;
  deliverable_id: string;
  reviewer_id: string;
  decision: ReviewDecision;
  comments: string | null;
  created_at: string;
}

export interface ProjectMessage extends SoftDeletable {
  id: string;
  project_id: string;
  sender_id: string;
  sender_role: "client" | "admin";
  body: string;
  created_at: string;
}

// ─── Staff assignment notes + invoices (staff_assignment_notifications_finance_ADDENDUM.sql) ───
export interface AssignmentNote extends SoftDeletable {
  id: string;
  project_id: string;
  staff_user_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface Invoice extends SoftDeletable {
  id: string;
  invoice_number: string | null;
  zoho_invoice_id: string | null;
  client_id: string | null;
  project_id: string | null;
  status: string | null;
  currency: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  due_date: string | null;
  pdf_url: string | null;
  public_portal_visible: boolean;
  zoho_customer_id?: string | null;
  source?: string | null; // 'zoho' | 'manual'
  created_at: string;
  // Legacy columns from the finance-addendum PROPOSAL (optional; may be absent).
  user_id?: string | null;
  zoho_estimate_id?: string | null;
  number?: string | null;
  amount?: number | null;
  url?: string | null;
  issued_at?: string | null;
}

// ─── Formal (priced) quotes — distinct from the lightweight quote_requests ───
export type FormalQuoteStatus =
  | "draft" | "internal_review" | "approved" | "sent" | "accepted" | "rejected" | "expired";

export interface QuoteItem {
  id: string;
  quote_id: string;
  title: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  position: number;
}

export interface Quote {
  id: string;
  quote_number: string | null;
  title: string | null;
  client_id: string | null;
  lead_id: string | null;
  project_id: string | null;
  quote_request_id: string | null;
  status: FormalQuoteStatus;
  currency: string;
  subtotal: number;
  vat: number;
  total: number;
  vat_rate: number;
  valid_until: string | null;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  public_portal_visible: boolean;
  // Zoho Books estimate mirror (additive — docs/portal_zoho_estimates_RUNME.sql).
  email?: string | null;
  source?: string | null;              // 'local' | 'zoho'
  zoho_customer_id?: string | null;
  zoho_estimate_id?: string | null;
  estimate_number?: string | null;
  estimate_url?: string | null;
  client_response?: "pending" | "accepted" | "declined" | null;
  admin_approved_at?: string | null;
  admin_approved_by?: string | null;
  synced_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteRevisionRequest {
  id: string;
  quote_id: string;
  author_id: string | null;
  note: string;
  created_at: string;
}

export const FORMAL_QUOTE_STATUS_LABELS: Record<FormalQuoteStatus, { ar: string; en: string }> = {
  draft:           { ar: "مسودة",         en: "Draft" },
  internal_review: { ar: "مراجعة داخلية",  en: "Internal review" },
  approved:        { ar: "معتمد",         en: "Approved" },
  sent:            { ar: "مُرسل",          en: "Sent" },
  accepted:        { ar: "مقبول",         en: "Accepted" },
  rejected:        { ar: "مرفوض",         en: "Rejected" },
  expired:         { ar: "منتهٍ",          en: "Expired" },
};
