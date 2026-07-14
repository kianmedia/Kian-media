// ════════════════════════════════════════════════════════════════════════════
// Kian — تحويل زمن التأجير (إصلاح bad_window).
// قاعدة: إدخال <input type="datetime-local"> يُفسَّر بتوقيت الرياض (UTC+3، بلا توقيت
// صيفي) — لا بتوقيت متصفح المستخدم. يُخزَّن في القاعدة UTC (ISO 8601)، ويُعرض بتوقيت
// الرياض. لا نستخدم `new Date(localString)` (يفسّرها بمنطقة المتصفح) ولا تنسيقًا
// يعتمد على لغة المتصفح ثم نعيد تحليله.
// ════════════════════════════════════════════════════════════════════════════

const RIYADH_OFFSET = "+03:00"; // السعودية — إزاحة ثابتة (لا DST)
const RIYADH_MS = 3 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const asInput = (r: Date) =>
  `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}T${pad(r.getUTCHours())}:${pad(r.getUTCMinutes())}`;

/** datetime-local ("YYYY-MM-DDTHH:mm") مُفسَّرًا كتوقيت الرياض → UTC ISO 8601 صريح. null إن كان غير صالح. */
export function riyadhInputToUtcISO(local: string | null | undefined): string | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(local).trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${RIYADH_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** UTC ISO → قيمة datetime-local بتوقيت الرياض ("YYYY-MM-DDTHH:mm"). "" إن غير صالح. */
export function utcToRiyadhInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return asInput(new Date(t + RIYADH_MS)); // مكوّنات UTC لهذا الكائن = ساعة حائط الرياض
}

/** عرض بتوقيت الرياض (Intl مع timeZone صريح — لا يعتمد الحساب على منطقة المتصفح). */
export function formatRiyadh(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
      timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    }).format(d);
  } catch {
    return utcToRiyadhInput(iso).replace("T", " ");
  }
}

/** نافذة افتراضية: البداية = بداية الساعة القادمة (توقيت الرياض)، النهاية = بعدها بـ24 ساعة (لا تساوي). */
export function defaultRentalWindow(): { from: string; to: string } {
  const start = new Date(Date.now() + RIYADH_MS);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() + 1);
  return { from: asInput(start), to: asInput(new Date(start.getTime() + 24 * 60 * 60 * 1000)) };
}

/** نهاية مقترحة = البداية + 24 ساعة (كقيمة datetime-local). "" إن كانت البداية غير صالحة. */
export function endPlus24h(fromLocal: string | null | undefined): string {
  const iso = riyadhInputToUtcISO(fromLocal);
  if (!iso) return "";
  return utcToRiyadhInput(new Date(new Date(iso).getTime() + 24 * 60 * 60 * 1000).toISOString());
}

export type WindowError = "invalid_start" | "invalid_end" | "end_before_start";
/** تحقق من نافذة التأجير قبل الإرسال. يعيد رمز خطأ أو null. لا يسمح بتساوي البداية والنهاية. */
export function validateWindow(fromLocal: string | null | undefined, toLocal: string | null | undefined): WindowError | null {
  const f = riyadhInputToUtcISO(fromLocal);
  if (!f) return "invalid_start";
  const t = riyadhInputToUtcISO(toLocal);
  if (!t) return "invalid_end";
  if (new Date(t).getTime() <= new Date(f).getTime()) return "end_before_start";
  return null;
}

// ─── ربط أخطاء الخادم برسائل عربية واضحة ───
const ERR_AR: Record<string, string> = {
  bad_window: "نافذة التأجير غير صالحة — تحقق من تاريخي الاستلام والإرجاع.",
  invalid_start: "تاريخ/وقت الاستلام غير صالح.",
  invalid_end: "تاريخ/وقت الإرجاع غير صالح.",
  end_before_start: "يجب أن يكون وقت الإرجاع بعد وقت الاستلام.",
  unavailable: "المعدّة غير متاحة في الفترة المحددة.",
  not_available: "المعدّة غير متاحة في الفترة المحددة.",
  quantity_unavailable: "الكمية المطلوبة غير متاحة في الفترة المحددة.",
  no_items: "أضف معدّة واحدة على الأقل.",
  customer_incomplete: "بيانات المستأجر غير مكتملة.",
  reason_required: "سبب الرفض مطلوب.",
  note_required: "ملاحظة التعديل مطلوبة.",
  not_editable: "لا يمكن تعديل الطلب في حالته الحالية.",
  bad_status: "لا يمكن تنفيذ هذا الإجراء في حالة الطلب الحالية.",
  contract_not_signed: "العقد غير موقّع بعد.",
  signatures_required: "توقيع المستأجر وموظف كيان مطلوبان.",
  overall_photo_required: "صورة إجمالية واحدة على الأقل للمعدات مطلوبة.",
  overall_return_photo_required: "صورة إرجاع إجمالية مطلوبة قبل إنهاء الفحص.",
  identity_incomplete: "أكمل بيانات الهوية: الاسم الكامل والجوال ونوع/رقم الهوية والعنوان.",
  item_photo_required: "صوّر كل معدة — صورة واحدة على الأقل لكل معدة.",
  return_item_photo_required: "صوّر كل معدة عند الإرجاع — صورة واحدة على الأقل لكل معدة.",
  return_overall_photo_required: "صورة إرجاع إجمالية مطلوبة.",
  consent_required: "يجب توقيع الإقرار/عقد التأجير قبل الإرسال.",
  code_required: "أدخل باركود/كود المعدة.",
  asset_not_found: "لم يُعثر على معدة بهذا الباركود/الكود.",
  customer_portal_disabled: "بوابة طلبات التأجير للمستأجرين غير مفعّلة حاليًا.",
  rental_disabled: "وحدة التأجير غير مفعّلة.",
  profile_not_found: "لم يُعثر على حساب العميل.",
  not_found: "الطلب غير موجود.",
  "not authorized": "لا تملك صلاحية هذا الإجراء.",
};
/** رسالة عربية لأي رمز خطأ خادمي/محلي (يقتطع اللاحقة مثل quantity_unavailable:<uuid>). */
export function rentalErrorAr(raw: string | null | undefined): string {
  if (!raw) return "حدث خطأ غير متوقع.";
  const code = String(raw).split(":")[0].trim();
  if (ERR_AR[code]) return ERR_AR[code];
  if (/items_incomplete/.test(raw)) return "أكمل حالة وصورة كل قطعة أولًا.";
  if (/insufficient_stock_at_handover/.test(raw)) return "الكمية غير كافية في المخزون لحظة التسليم.";
  if (/items_not_inspected/.test(raw)) return "افحص جميع القطع قبل إنهاء الإرجاع.";
  // لا تُظهر رسائل PostgREST التقنية للمستخدم (دالة غير موجودة/مخزّن المخطط/عمود مفقود).
  if (/could not find|schema cache|PGRST\d|does not exist|function .* in the schema/i.test(raw)) return "الخدمة غير مهيأة بعد — يرجى المحاولة لاحقًا.";
  return "تعذّر إتمام العملية. حاول مرة أخرى.";
}

/** رسائل دقيقة لرفع الأدلة (تحدّد المرحلة التي فشلت — لا تُظهر نصًا تقنيًا). */
export function rentalUploadErrorAr(raw: string | null | undefined): string {
  const r = String(raw ?? "");
  if (r.startsWith("attach:")) {
    if (/could not find|schema cache|PGRST\d|does not exist/i.test(r)) return "خدمة حفظ الصور غير مطبقة في قاعدة البيانات.";
    if (/not authorized|403/.test(r)) return "لا تملك صلاحية رفع صورة لهذا الطلب.";
    if (/not_editable/.test(r)) return "لا يمكن إضافة صور بعد إرسال أو إغلاق الطلب.";
    if (/storage_object_missing/.test(r)) return "لم يكتمل رفع الملف إلى التخزين. أعد المحاولة.";
    return "تم رفع الملف ولكن تعذر ربطه بالطلب. أعد المحاولة.";
  }
  if (/not_authorized|not authorized/.test(r)) return "لا تملك صلاحية رفع صورة لهذا الطلب.";
  if (/not_editable/.test(r)) return "لا يمكن إضافة صور بعد إرسال أو إغلاق الطلب.";
  if (/could not find|schema cache|PGRST\d|does not exist|server_not_configured|server_supabase_not_configured/i.test(r)) return "خدمة حفظ الصور غير مطبقة في قاعدة البيانات — طبّق ملف التحديث ثم أعد المحاولة.";
  if (/upload_failed_404/.test(r)) return "مخزن الصور غير مُهيّأ بعد (لم يُطبَّق تحديث قاعدة البيانات). طبّق ملف التحديث.";
  if (/upload_failed_40[13]/.test(r)) return "تعذّر رفع الصورة — تأكد من تطبيق تحديث قاعدة البيانات، أو أعد تسجيل الدخول.";
  if (/too_large/.test(r)) return "الصورة أكبر من الحد المسموح. اختر صورة أصغر.";
  if (/bad_mime/.test(r)) return "صيغة الصورة غير مدعومة. اختر JPG أو PNG.";
  if (/upload_failed|sign_failed|upload_network|http_5\d\d/.test(r)) return "تعذر رفع الصورة إلى التخزين. أعد المحاولة.";
  if (/item_not_in_request|item_required/.test(r)) return "المعدة غير صحيحة لهذا الطلب.";
  return "تعذر رفع الصورة. أعد المحاولة.";
}

/** رسائل دقيقة لعملية ربط/اختيار عميل البوابة — لا تُظهر نص PostgREST للمستخدم. */
export function rentalLinkErrorAr(raw: string | null | undefined): string {
  const r = String(raw ?? "");
  const code = r.split(":")[0].trim();
  if (/could not find|schema cache|PGRST\d|does not exist|function .* in the schema/i.test(r)) return "خدمة ربط العميل غير مطبقة في قاعدة البيانات.";
  if (code === "not authorized" || /permission denied/i.test(r)) return "ليس لديك صلاحية لاختيار هذا العميل.";
  if (code === "profile_not_found") return "حساب العميل غير موجود.";
  if (code === "invalid_account") return "الحساب المحدد ليس حساب عميل صالحًا.";
  return "تعذر اختيار العميل. يرجى إعادة المحاولة.";
}
