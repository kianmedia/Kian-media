"use client";
// ════════════════════════════════════════════════════════════════════════════
// FinForms — نماذج الكتابة في المركز المالي.
//
// نموذج واحد مُعرَّف بمواصفات حقول بدل ستّة عشر نموذجًا متشابهًا. لماذا يهمّ:
// كلّ نموذج يكتب مالًا يمرّ من هنا، فقاعدة «الصافي والنسبة فقط، والإجمالي يُحسب
// في القاعدة» تُطبَّق في مكان واحد ولا تُنسى في نموذج سابع.
//
// ★ لا حقل «الإجمالي» في أيّ مواصفة ★ — والحمولة تمرّ بـfinMoneyPayload التي
// تحذف أيّ مفتاح إجماليّ. الخادم يرفضه أيضًا (gross_not_writable): طبقتان،
// لأنّ الواجهة قد تُتجاوَز.
// ════════════════════════════════════════════════════════════════════════════
import { useState, type ReactNode } from "react";
import {
  finMoneyPayload, type FinLookups, type FinRow, type FinState,
} from "@/lib/portal/financeOps";
import {
  btnGhost, btnPrimary, card, Field, fieldCls, Flash, MoneyBreakdown,
} from "./FinAtoms";

export type FieldKind = "text" | "textarea" | "number" | "money" | "vat" | "date" | "month" | "select" | "checkbox";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
  /** خيارات ثابتة، أو مرجع إلى قوائم finops_lookups. */
  options?: { value: string; label: string }[];
  lookup?: "cost_centers" | "categories" | "suppliers" | "budgets";
  placeholder?: string;
}

export interface FormSpec {
  title: string;
  note?: string;
  fields: FieldSpec[];
  /** يظهر تفصيل الصافي/الضريبة/الإجمالي أسفل النموذج. */
  money?: boolean;
}

const yesNo = [{ value: "true", label: "نعم" }, { value: "false", label: "لا" }];

const MONEY_FIELDS: FieldSpec[] = [
  { key: "amount_net", label: "الصافي قبل الضريبة", kind: "money", required: true,
    hint: "يُكتب الصافي فقط. الإجمالي عمود مولَّد في القاعدة ولا يُرسَل من هنا." },
  { key: "vat_rate", label: "نسبة الضريبة ٪", kind: "vat", hint: "الافتراضيّ ١٥٪." },
  { key: "vat_amount", label: "قيمة الضريبة (اختياريّ)", kind: "money",
    hint: "اتركه فارغًا ليُحسب من النسبة. يُملأ فقط حين تختلف الفاتورة عن الحساب." },
];

/** مواصفات كلّ نموذج — مفاتيحها مطابقة حرفيًّا لما يقرأه الخادم من الحمولة. */
export const FORM_SPECS: Record<string, FormSpec> = {
  cost_center: {
    title: "مركز تكلفة",
    note: "مراكز التكلفة مستقلّة عن هيكل المشاريع. الربط بمشروع اختياريّ وعلى مستوى الصفّ المالي.",
    fields: [
      { key: "code", label: "الرمز", kind: "text", placeholder: "CC-OPS" },
      { key: "name_ar", label: "الاسم", kind: "text", required: true },
      { key: "name_en", label: "الاسم بالإنجليزية", kind: "text" },
      { key: "kind", label: "النوع", kind: "select", options: [
        { value: "company", label: "الشركة" }, { value: "department", label: "قسم" },
        { value: "program", label: "برنامج" }, { value: "project", label: "مشروع" },
        { value: "client", label: "عميل" }, { value: "other", label: "أخرى" }] },
      { key: "parent_id", label: "المركز الأب", kind: "select", lookup: "cost_centers" },
      { key: "notes", label: "ملاحظات", kind: "textarea" },
    ],
  },
  category: {
    title: "بند مصروف",
    fields: [
      { key: "key", label: "المفتاح", kind: "text", placeholder: "crew_daily", hint: "حروف لاتينية صغيرة وأرقام و_ فقط." },
      { key: "name_ar", label: "الاسم", kind: "text", required: true },
      { key: "cost_nature", label: "طبيعة التكلفة", kind: "select", options: [
        { value: "crew", label: "طاقم" }, { value: "freelancer", label: "مستقلّ" },
        { value: "travel", label: "سفر" }, { value: "equipment_rental", label: "تأجير معدّات" },
        { value: "production_purchase", label: "مشتريات إنتاج" }, { value: "logistics", label: "لوجستيّات" },
        { value: "software", label: "برمجيّات" }, { value: "other", label: "أخرى" }] },
      { key: "default_vat_rate", label: "نسبة الضريبة الافتراضية ٪", kind: "vat" },
      { key: "is_capex", label: "أصل رأسماليّ", kind: "select", options: yesNo },
      { key: "sort_order", label: "الترتيب", kind: "number" },
    ],
  },
  supplier: {
    title: "مورّد",
    note: "★ لا يُخزَّن رقم حساب بنكيّ كامل ★ — المرجع البنكيّ اسم البنك وآخر أربعة أرقام فقط، والقاعدة ترفض ما عدا ذلك.",
    fields: [
      { key: "code", label: "الرمز", kind: "text" },
      { key: "name", label: "الاسم", kind: "text", required: true },
      { key: "legal_name", label: "الاسم النظاميّ", kind: "text" },
      { key: "supplier_type", label: "النوع", kind: "select", options: [
        { value: "company", label: "شركة" }, { value: "freelancer", label: "مستقلّ" },
        { value: "individual", label: "فرد" }, { value: "government", label: "جهة حكومية" },
        { value: "other", label: "أخرى" }] },
      { key: "vat_number", label: "الرقم الضريبيّ", kind: "text" },
      { key: "cr_number", label: "السجلّ التجاريّ", kind: "text" },
      { key: "contact_name", label: "جهة الاتصال", kind: "text" },
      { key: "phone", label: "الجوّال", kind: "text" },
      { key: "email", label: "البريد", kind: "text" },
      { key: "payment_terms_days", label: "مهلة السداد (يومًا)", kind: "number" },
      { key: "bank_ref", label: "مرجع بنكيّ تعريفيّ", kind: "text",
        hint: "مثال: الراجحي ****1234. رقم الحساب الكامل مرفوض من القاعدة." },
      { key: "rating", label: "التقييم ١–٥", kind: "number" },
    ],
  },
  budget: {
    title: "ميزانية",
    fields: [
      { key: "title", label: "العنوان", kind: "text", required: true },
      { key: "scope", label: "النطاق", kind: "select", options: [
        { value: "company", label: "الشركة" }, { value: "cost_center", label: "مركز تكلفة" },
        { value: "project", label: "مشروع" }, { value: "program", label: "برنامج" }] },
      { key: "cost_center_id", label: "مركز التكلفة", kind: "select", lookup: "cost_centers" },
      { key: "project_id", label: "معرّف المشروع (اختياريّ)", kind: "text",
        hint: "ربط للتجميع والعرض فقط — لا يُعدَّل المشروع ولا تُقرأ ماليات المنصّة." },
      { key: "fiscal_year", label: "السنة المالية", kind: "number" },
      { key: "period_start", label: "من", kind: "date" },
      { key: "period_end", label: "إلى", kind: "date" },
      { key: "status", label: "الحالة", kind: "select", options: [
        { value: "draft", label: "مسوّدة" }, { value: "active", label: "نشطة" },
        { value: "locked", label: "مُقفَلة" }, { value: "closed", label: "مغلقة" }],
        hint: "فتح ميزانية مُقفَلة بيد المالك وحده." },
      { key: "notes", label: "ملاحظات", kind: "textarea" },
    ],
  },
  budget_line: {
    title: "بند ميزانية",
    money: true,
    fields: [
      { key: "budget_id", label: "الميزانية", kind: "select", lookup: "budgets", required: true },
      { key: "label", label: "الوصف", kind: "text", required: true },
      { key: "category_id", label: "بند المصروف", kind: "select", lookup: "categories" },
      { key: "cost_center_id", label: "مركز التكلفة", kind: "select", lookup: "cost_centers" },
      ...MONEY_FIELDS,
      { key: "note", label: "ملاحظة", kind: "textarea" },
    ],
  },
  cost: {
    title: "تكلفة",
    note: "commitment = التزام (لم يُصرَف بعد) أو فعليّ (وقع). انحراف الميزانية يُشتقّ من هذا التمييز.",
    money: true,
    fields: [
      { key: "title", label: "الوصف", kind: "text", required: true },
      { key: "cost_type", label: "نوع التكلفة", kind: "select", options: [
        { value: "crew", label: "طاقم" }, { value: "freelancer", label: "مستقلّ" },
        { value: "travel", label: "سفر وتنقّل" }, { value: "equipment_rental", label: "تأجير معدّات" },
        { value: "production_purchase", label: "مشتريات إنتاج" }, { value: "logistics", label: "لوجستيّات" },
        { value: "software", label: "برمجيّات" }, { value: "other", label: "أخرى" }] },
      { key: "commitment", label: "الطبيعة", kind: "select", options: [
        { value: "actual", label: "فعليّ" }, { value: "committed", label: "التزام" }] },
      { key: "category_id", label: "بند المصروف", kind: "select", lookup: "categories" },
      { key: "cost_center_id", label: "مركز التكلفة", kind: "select", lookup: "cost_centers" },
      { key: "budget_id", label: "الميزانية", kind: "select", lookup: "budgets" },
      { key: "supplier_id", label: "المورّد", kind: "select", lookup: "suppliers" },
      { key: "person_label", label: "اسم الشخص/المستقلّ", kind: "text" },
      { key: "project_id", label: "معرّف المشروع (اختياريّ)", kind: "text" },
      { key: "incurred_on", label: "تاريخ التكلفة", kind: "date" },
      ...MONEY_FIELDS,
      { key: "notes", label: "ملاحظات", kind: "textarea" },
    ],
  },
  contract: {
    title: "عقد",
    note: "العقود طرف الإيراد. لا يراها إلّا من يملك بوّابة الربحية.",
    money: true,
    fields: [
      { key: "title", label: "العنوان", kind: "text", required: true },
      { key: "client_label", label: "العميل", kind: "text" },
      { key: "project_id", label: "معرّف المشروع (اختياريّ)", kind: "text" },
      { key: "signed_on", label: "تاريخ التوقيع", kind: "date" },
      { key: "start_date", label: "البداية", kind: "date" },
      { key: "end_date", label: "النهاية", kind: "date" },
      { key: "is_retainer", label: "اشتراك شهريّ", kind: "select", options: yesNo },
      { key: "status", label: "الحالة", kind: "select", options: [
        { value: "draft", label: "مسوّدة" }, { value: "active", label: "ساري" },
        { value: "completed", label: "منتهٍ" }, { value: "cancelled", label: "ملغى" }] },
      ...MONEY_FIELDS,
    ],
  },
  revenue: {
    title: "إيراد",
    money: true,
    fields: [
      { key: "title", label: "الوصف", kind: "text", required: true },
      { key: "revenue_type", label: "النوع", kind: "select", options: [
        { value: "contract", label: "عقد" }, { value: "retainer", label: "اشتراك" },
        { value: "change_order", label: "أمر تغيير" }, { value: "other", label: "أخرى" }] },
      { key: "client_label", label: "العميل", kind: "text" },
      { key: "project_id", label: "معرّف المشروع (اختياريّ)", kind: "text" },
      { key: "recognized_on", label: "تاريخ الاعتراف", kind: "date" },
      { key: "status", label: "الحالة", kind: "select", options: [
        { value: "expected", label: "متوقّع" }, { value: "confirmed", label: "مؤكَّد" },
        { value: "cancelled", label: "ملغى" }] },
      { key: "zoho_reference", label: "مرجع Zoho (نصّ فقط)", kind: "text",
        hint: "مرجع مكتوب يدويًّا. لا مزامنة ولا اتصال." },
      ...MONEY_FIELDS,
    ],
  },
  retainer: {
    title: "اشتراك شهريّ",
    money: true,
    fields: [
      { key: "title", label: "العنوان", kind: "text", required: true },
      { key: "client_label", label: "العميل", kind: "text" },
      { key: "start_month", label: "شهر البداية", kind: "month" },
      { key: "end_month", label: "شهر النهاية", kind: "month" },
      { key: "billing_day", label: "يوم الفوترة", kind: "number" },
      { key: "status", label: "الحالة", kind: "select", options: [
        { value: "active", label: "نشط" }, { value: "paused", label: "موقوف" },
        { value: "ended", label: "منتهٍ" }] },
      ...MONEY_FIELDS,
    ],
  },
  receivable: {
    title: "ذمّة مدينة",
    note: "حالة التحصيل والمتأخّر تُشتقّ من الدفعات المسجَّلة ولا تُكتب هنا.",
    money: true,
    fields: [
      { key: "title", label: "الوصف", kind: "text", required: true },
      { key: "client_label", label: "العميل", kind: "text" },
      { key: "project_id", label: "معرّف المشروع (اختياريّ)", kind: "text" },
      { key: "issue_date", label: "تاريخ الإصدار", kind: "date" },
      { key: "due_date", label: "تاريخ الاستحقاق", kind: "date" },
      { key: "status", label: "الحالة", kind: "select", options: [
        { value: "draft", label: "مسوّدة" }, { value: "open", label: "قائمة" },
        { value: "written_off", label: "مشطوبة" }, { value: "void", label: "ملغاة" }] },
      { key: "zoho_invoice_id", label: "رقم فاتورة Zoho (مرجع نصّيّ)", kind: "text" },
      ...MONEY_FIELDS,
    ],
  },
  collection: {
    title: "تسجيل تحصيل",
    money: true,
    fields: [
      { key: "collected_on", label: "تاريخ التحصيل", kind: "date" },
      { key: "method", label: "الطريقة", kind: "select", options: [
        { value: "bank_transfer", label: "حوالة بنكية" }, { value: "cash", label: "نقدًا" },
        { value: "cheque", label: "شيك" }, { value: "card", label: "بطاقة" },
        { value: "other", label: "أخرى" }] },
      { key: "reference", label: "المرجع", kind: "text" },
      ...MONEY_FIELDS,
      { key: "note", label: "ملاحظة", kind: "textarea" },
    ],
  },
  milestone: {
    title: "دفعة عقد",
    money: true,
    fields: [
      { key: "title", label: "الوصف", kind: "text", required: true },
      { key: "due_on", label: "تاريخ الاستحقاق", kind: "date" },
      { key: "sort_order", label: "الترتيب", kind: "number" },
      // ★ لا حالة «محصَّلة» هنا عمدًا ★ — التحصيل واقعة تخصّ الذمّة ويُشتقّ منها،
      // وقيد الجدول لا يقبلها أصلًا. إضافتها كانت ستنتج 23514 عند أوّل حفظ.
      { key: "status", label: "الحالة", kind: "select", options: [
        { value: "planned", label: "مخطَّطة" }, { value: "invoiced", label: "مفوترة" },
        { value: "cancelled", label: "ملغاة" }] },
      ...MONEY_FIELDS,
    ],
  },
  threshold: {
    title: "حدّ اعتماد",
    note: "★ المالك وحده ★ يضبط الحدود. لو ضبطها من يعتمد لرفع سقفه بنفسه.",
    fields: [
      { key: "scope", label: "النطاق", kind: "select", options: [
        { value: "expense", label: "طلب صرف" }, { value: "purchase", label: "طلب شراء" }] },
      { key: "min_amount", label: "من مبلغ", kind: "money" },
      { key: "max_amount", label: "إلى مبلغ (فارغ = بلا سقف)", kind: "money" },
      { key: "required_role", label: "الدور المطلوب", kind: "select", options: [
        { value: "finance", label: "المالية" }, { value: "owner", label: "المالك" }] },
      { key: "requires_second_approval", label: "يتطلّب اعتمادًا ثانيًا", kind: "select", options: yesNo },
      { key: "category_id", label: "بند مخصوص (اختياريّ)", kind: "select", lookup: "categories" },
      { key: "cost_center_id", label: "مركز تكلفة مخصوص (اختياريّ)", kind: "select", lookup: "cost_centers" },
      { key: "notes", label: "ملاحظات", kind: "textarea" },
    ],
  },
  purchase_order: {
    title: "أمر شراء",
    note: "أمر الشراء المُصدَر عقدٌ مع مورّد: بعد الإصدار لا يُعدَّل، يُلغى ويُصدَر غيره.",
    money: true,
    fields: [
      { key: "supplier_id", label: "المورّد", kind: "select", lookup: "suppliers", required: true },
      { key: "cost_center_id", label: "مركز التكلفة", kind: "select", lookup: "cost_centers" },
      { key: "budget_id", label: "الميزانية", kind: "select", lookup: "budgets" },
      { key: "project_id", label: "معرّف المشروع (اختياريّ)", kind: "text" },
      { key: "issue_date", label: "تاريخ الإصدار", kind: "date" },
      { key: "expected_date", label: "التاريخ المتوقّع", kind: "date" },
      ...MONEY_FIELDS,
      { key: "terms", label: "الشروط", kind: "textarea" },
    ],
  },
  po_item: {
    title: "بند أمر شراء",
    fields: [
      { key: "line_no", label: "رقم السطر", kind: "number" },
      { key: "description", label: "الوصف", kind: "text", required: true },
      { key: "quantity", label: "الكمّية", kind: "number", required: true },
      { key: "unit", label: "الوحدة", kind: "text" },
      { key: "unit_price_net", label: "سعر الوحدة قبل الضريبة", kind: "money", required: true },
      { key: "vat_rate", label: "نسبة الضريبة ٪", kind: "vat" },
      { key: "received_qty", label: "المستلَم", kind: "number", hint: "لا يُستلَم بند قبل إصدار الأمر." },
    ],
  },
  expense_request: {
    title: "طلب صرف",
    note: "يُنسب الطلب لصاحب الجلسة على الخادم دائمًا. لا يمكن رفع طلب باسم غيرك.",
    money: true,
    fields: [
      { key: "title", label: "سبب الصرف", kind: "text", required: true },
      { key: "category_id", label: "بند المصروف", kind: "select", lookup: "categories" },
      { key: "cost_center_id", label: "مركز التكلفة", kind: "select", lookup: "cost_centers" },
      { key: "spent_on", label: "تاريخ الصرف", kind: "date" },
      { key: "project_id", label: "معرّف المشروع (اختياريّ)", kind: "text" },
      ...MONEY_FIELDS,
      { key: "description", label: "تفاصيل", kind: "textarea" },
    ],
  },
  purchase_request: {
    title: "طلب شراء",
    money: true,
    fields: [
      { key: "title", label: "المطلوب", kind: "text", required: true },
      { key: "cost_center_id", label: "مركز التكلفة", kind: "select", lookup: "cost_centers" },
      { key: "needed_by", label: "مطلوب بحلول", kind: "date" },
      { key: "project_id", label: "معرّف المشروع (اختياريّ)", kind: "text" },
      ...MONEY_FIELDS,
      { key: "justification", label: "المبرّر", kind: "textarea" },
    ],
  },
  purchase_item: {
    title: "بند طلب شراء",
    fields: [
      { key: "line_no", label: "رقم السطر", kind: "number" },
      { key: "description", label: "الوصف", kind: "text", required: true },
      { key: "quantity", label: "الكمّية", kind: "number", required: true },
      { key: "unit", label: "الوحدة", kind: "text" },
      { key: "unit_price_net", label: "سعر الوحدة قبل الضريبة", kind: "money", required: true },
      { key: "vat_rate", label: "نسبة الضريبة ٪", kind: "vat" },
      { key: "note", label: "ملاحظة", kind: "textarea" },
    ],
  },
  attachment: {
    title: "مرفق",
    note: "رابط الملفّ فقط — لا يُرفع محتوى ماليّ إلى أيّ طرف خارجيّ من هذه الشاشة.",
    fields: [
      { key: "file_url", label: "رابط الملفّ", kind: "text", required: true },
      { key: "file_name", label: "اسم الملفّ", kind: "text" },
      { key: "note", label: "ملاحظة", kind: "textarea" },
    ],
  },
};

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      dir="rtl"
    >
      <div className={`${card} w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-4 space-y-3 rounded-b-none sm:rounded-xl`}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-stone-100 text-sm font-medium">{title}</h3>
          <button className={btnGhost} onClick={onClose} aria-label="إغلاق">إغلاق</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * النموذج العامّ. لا يفحص صلاحية ولا يخفي زرًّا بوصفه حماية: الحفظ يُرسَل،
 * والخادم يقبل أو يردّ 42501 فتُعرض «لا تملك صلاحية» بصدق.
 */
export function FinForm({
  spec, initial, lookups, onSubmit, onClose,
}: {
  spec: FormSpec;
  initial?: FinRow;
  lookups: FinLookups | null;
  onSubmit: (payload: Record<string, unknown>) => Promise<FinState<unknown>>;
  onClose: () => void;
}) {
  const [v, setV] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const f of spec.fields) {
      const raw = initial ? (initial as Record<string, unknown>)[f.key] : undefined;
      o[f.key] = raw === null || raw === undefined ? "" : String(raw);
    }
    if (initial && typeof initial.id === "string") o.id = initial.id;
    return o;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const opts = (f: FieldSpec): { value: string; label: string }[] => {
    if (f.options) return f.options;
    if (!f.lookup || !lookups) return [];
    if (f.lookup === "cost_centers") return lookups.cost_centers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name_ar}` }));
    if (f.lookup === "categories") return lookups.categories.map((c) => ({ value: c.id, label: c.name_ar }));
    if (f.lookup === "suppliers") return lookups.suppliers.map((s) => ({ value: s.id, label: s.name }));
    return lookups.budgets.map((b) => ({ value: b.id, label: `${b.code} — ${b.title}` }));
  };

  const save = async () => {
    setErr(null);
    for (const f of spec.fields) {
      if (f.required && !String(v[f.key] ?? "").trim()) {
        setErr(`الحقل المطلوب «${f.label}» فارغ.`);
        return;
      }
    }
    setBusy(true);
    const r = await onSubmit(finMoneyPayload(v));
    setBusy(false);
    if (r.state === "ok") { onClose(); return; }
    setErr(r.message);
  };

  const net = parseFloat(v.amount_net ?? "");
  const rate = v.vat_rate === "" || v.vat_rate === undefined ? 15 : parseFloat(v.vat_rate);

  return (
    <Modal title={spec.title} onClose={onClose}>
      {spec.note && <p className="text-[11px] text-stone-500 leading-6">{spec.note}</p>}
      <Flash msg={err} tone="bad" />
      <div className="space-y-3">
        {spec.fields.map((f) => (
          <Field key={f.key} label={f.required ? `${f.label} *` : f.label} hint={f.hint}>
            {f.kind === "textarea" ? (
              <textarea
                className={fieldCls} rows={2} value={v[f.key] ?? ""}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              />
            ) : f.kind === "select" ? (
              <select
                className={fieldCls} value={v[f.key] ?? ""}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              >
                <option value="">—</option>
                {opts(f).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                className={fieldCls}
                type={f.kind === "date" ? "date" : f.kind === "month" ? "date"
                  : f.kind === "number" || f.kind === "money" || f.kind === "vat" ? "number" : "text"}
                inputMode={f.kind === "money" || f.kind === "vat" ? "decimal" : undefined}
                step={f.kind === "money" ? "0.01" : f.kind === "vat" ? "0.001" : undefined}
                min={f.kind === "money" || f.kind === "vat" ? "0" : undefined}
                placeholder={f.placeholder}
                value={v[f.key] ?? ""}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              />
            )}
          </Field>
        ))}
        {spec.money && (
          <MoneyBreakdown
            net={Number.isFinite(net) ? net : 0}
            vatRate={Number.isFinite(rate) ? rate : 15}
            currency={v.currency || "SAR"}
          />
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <button className={btnPrimary} onClick={() => void save()} disabled={busy}>
          {busy ? "جارٍ الحفظ…" : "حفظ"}
        </button>
        <button className={btnGhost} onClick={onClose} disabled={busy}>إلغاء</button>
      </div>
    </Modal>
  );
}

/** حوار سبب — الحذف والرفض والإلغاء لا تمرّ بلا سبب مكتوب (والخادم يفرضه). */
export function ReasonDialog({
  title, label, onConfirm, onClose,
}: {
  title: string; label: string;
  onConfirm: (reason: string) => Promise<FinState<unknown>>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <Flash msg={err} tone="bad" />
      <Field label={label} hint="٣ أحرف على الأقلّ — يُحفَظ في سجلّ التدقيق.">
        <textarea className={fieldCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <button
          className={btnPrimary}
          disabled={busy || reason.trim().length < 3}
          onClick={async () => {
            setBusy(true); setErr(null);
            const r = await onConfirm(reason.trim());
            setBusy(false);
            if (r.state === "ok") onClose(); else setErr(r.message);
          }}
        >
          {busy ? "جارٍ…" : "تأكيد"}
        </button>
        <button className={btnGhost} onClick={onClose} disabled={busy}>إلغاء</button>
      </div>
    </Modal>
  );
}
