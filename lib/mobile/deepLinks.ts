// ════════════════════════════════════════════════════════════════════════════
// lib/mobile/deepLinks.ts — طبقة جاهزية الروابط العميقة (الويب فقط).
//
// Wave 8 · V2-8.4-A
//
// ★ ما هذا، وما ليس ★
//  ✅ **قائمة سماح** للمسارات التي يجوز أن يقصدها رابط عميق، مع تحقّق صارم.
//  ⛔ **ليست Universal Links ولا App Links**: هذه تتطلّب ملفَّي ارتباط مستضافَين
//     (`apple-app-site-association` و`assetlinks.json`) مُوقَّعَين بمُعرِّف تطبيق
//     حقيقيّ وبصمة توقيع. لا يوجد تطبيق ولا مُعرِّف ولا شهادة ⇒ ادّعاء دعمها
//     كذبٌ يُكتشف عند أوّل نقرة. انظر docs/mobile/MOBILE_WAVE_9_IMPLEMENTATION_PLAN.md
//  ⛔ ولا تُنفَّذ سكيمة `kian://` هنا: تسجيل السكيمة فعلٌ داخل التطبيق الأصليّ.
//
// ★ الخطر الذي تمنعه ★
//  رابط عميق **مُدخَل مستخدم**. يأتي من بريد أو إشعار أو رسالة، وقد صاغه مهاجم.
//  فالتحويل غير المُقيَّد (`open redirect`) يجعل نطاقنا جسرًا موثوقًا إلى صفحة
//  تصيّد؛ والمخطّطات النشطة (`javascript:` وأخواتها) تُنفَّذ في سياق صفحتنا.
// ════════════════════════════════════════════════════════════════════════════

/** تصنيف كل هدف — يُستعمل في خطّة Wave 9 ولا يُخمَّن هناك من جديد. */
export type LinkReadiness =
  | "WEB ROUTE READY"
  | "NEEDS NATIVE MAPPING"
  | "NEEDS HOSTED ASSOCIATION FILE"
  | "SECURITY REVIEW REQUIRED";

export interface DeepLinkTarget {
  key: string;
  /** نمط المسار على الويب. `:param` جزء واحد لا يحوي شرطة مائلة. */
  pattern: string;
  readiness: LinkReadiness;
  /** يحمل رمزًا في الاستعلام ⇒ يُعامَل معاملة خاصّة (§الرموز). */
  tokenParam?: string;
  /** هل يتطلّب جلسة؟ يُستعمل لتقرير وجهة إعادة التوجيه بعد الدخول. */
  requiresAuth: boolean;
}

// ─── قائمة السماح ───────────────────────────────────────────────────────────
//
// 🔴 قائمة **سماح** لا قائمة منع: كل مسار غير مذكور مرفوض. قائمة المنع تفشل
//    دائمًا عند أوّل مسار جديد يُضاف ويُنسى.
export const DEEP_LINK_TARGETS: readonly DeepLinkTarget[] = [
  { key: "project",            pattern: "/portal/projects/:id",         readiness: "NEEDS NATIVE MAPPING",           requiresAuth: true },
  { key: "client_portal",      pattern: "/client-portal",               readiness: "WEB ROUTE READY",                requiresAuth: false },
  { key: "portal_home",        pattern: "/portal",                      readiness: "NEEDS NATIVE MAPPING",           requiresAuth: true },
  { key: "call_sheet",         pattern: "/portal/ops/call-sheets/:id",  readiness: "NEEDS NATIVE MAPPING",           requiresAuth: true },
  { key: "qr_scan",            pattern: "/qr/:code",                    readiness: "SECURITY REVIEW REQUIRED",       requiresAuth: false },
  { key: "calendar_feed",      pattern: "/api/calendar/:token",         readiness: "SECURITY REVIEW REQUIRED",       tokenParam: "token", requiresAuth: false },
  { key: "password_reset",     pattern: "/reset-password",              readiness: "NEEDS HOSTED ASSOCIATION FILE",  tokenParam: "token", requiresAuth: false },
  { key: "email_confirm",      pattern: "/confirm-email",               readiness: "NEEDS HOSTED ASSOCIATION FILE",  tokenParam: "token", requiresAuth: false },
  { key: "notification",       pattern: "/portal/notifications",        readiness: "NEEDS NATIVE MAPPING",           requiresAuth: true },
  { key: "shared_resource",    pattern: "/portal/shared/:id",           readiness: "SECURITY REVIEW REQUIRED",       tokenParam: "t", requiresAuth: false },
] as const;

/** مخطّطات تُنفَّذ أو تقرأ محلّيًّا — مرفوضة دائمًا. */
const DANGEROUS_SCHEMES = ["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"];

export type RejectReason =
  | "empty" | "dangerous_scheme" | "protocol_relative" | "external_host"
  | "path_traversal" | "malformed_encoding" | "not_in_allow_list"
  | "control_characters" | "too_long";

export type LinkResolution =
  | { ok: true; target: DeepLinkTarget; path: string; params: Record<string, string>; hasToken: boolean }
  | { ok: false; reason: RejectReason };

const MAX_LEN = 2048;

/**
 * فكّ الترميز **مرّة واحدة** مع كشف التشويه.
 *
 * 🔴 الفكّ المتكرّر حتى الاستقرار خطأ شائع: `%252e%252e%252f` يصير `../` بعد
 *    فكّين، فيتجاوز فحصًا وقع بعد فكّ واحد. لذا نفكّ مرّة، ونرفض ما بقي فيه
 *    ترميزٌ يفكّ إلى محرف خطر.
 */
export function safeDecodeOnce(raw: string): { ok: true; value: string } | { ok: false } {
  try {
    const once = decodeURIComponent(raw);
    // ترميز مزدوج متبقٍّ ⇒ نيّة إخفاء.
    if (/%25|%2e|%2f|%5c/i.test(once)) return { ok: false };
    return { ok: true, value: once };
  } catch {
    return { ok: false };   // ترميز غير صالح — ⛔ لا يُمرَّر «كما هو».
  }
}

/** يتحقّق أنّ المضيف من نطاقنا. ⛔ ولا يُقبل نطاق فرعيّ لم يُذكر. */
export function isAllowedHost(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");   // النقطة الأخيرة تخدع المقارنة
  // 🔴 مطابقة تامّة فقط: `kianmedia.com.evil.tld` ينتهي بـ… لا شيء منّا،
  //    لكنّ `endsWith("kianmedia.com")` كان سيقبل `evilkianmedia.com`.
  return allowed.some((a) => h === a.toLowerCase());
}

export interface ResolveOptions {
  allowedHosts?: readonly string[];
  targets?: readonly DeepLinkTarget[];
}

const DEFAULT_HOSTS = ["kianmedia.com", "www.kianmedia.com"] as const;

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const pSeg = pattern.split("/").filter(Boolean);
  const aSeg = pathname.split("/").filter(Boolean);
  if (pSeg.length !== aSeg.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pSeg.length; i++) {
    if (pSeg[i].startsWith(":")) {
      if (!aSeg[i]) return null;
      params[pSeg[i].slice(1)] = aSeg[i];
    } else if (pSeg[i] !== aSeg[i]) return null;
  }
  return params;
}

/**
 * يحلّ رابطًا عميقًا مقابل قائمة السماح.
 *
 * ⚠️ يُعيد **سببًا** عند الرفض للتشخيص الداخليّ، ⛔ ولا يُعرض هذا السبب للمستخدم
 *    حين يتعلّق برمز (§`neutralUserMessage`).
 */
export function resolveDeepLink(input: string, opts: ResolveOptions = {}): LinkResolution {
  const allowedHosts = opts.allowedHosts ?? DEFAULT_HOSTS;
  const targets = opts.targets ?? DEEP_LINK_TARGETS;

  if (!input || !input.trim()) return { ok: false, reason: "empty" };
  if (input.length > MAX_LEN) return { ok: false, reason: "too_long" };

  // محارف تحكّم وأسطر جديدة — تُستعمل لتقسيم الترويسات وخداع المحلِّلات.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(input)) return { ok: false, reason: "control_characters" };

  const trimmed = input.trim();
  const lower = trimmed.toLowerCase().replace(/\s+/g, "");
  for (const s of DANGEROUS_SCHEMES) {
    if (lower.startsWith(s)) return { ok: false, reason: "dangerous_scheme" };
  }
  // 🔴 `//evil.tld/x` يرث مخطّط الصفحة ويخرج من نطاقنا — وهو أكثر ما يُنسى.
  if (/^\/\//.test(trimmed) || /^\\\\/.test(trimmed)) {
    return { ok: false, reason: "protocol_relative" };
  }

  let pathname: string, search: URLSearchParams;
  try {
    // قاعدة وهمية للمسارات النسبية؛ والمطلقة يُفحص مضيفها.
    const url = new URL(trimmed, "https://kianmedia.com");
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return { ok: false, reason: "dangerous_scheme" };
      }
      if (!isAllowedHost(url.hostname, allowedHosts)) {
        return { ok: false, reason: "external_host" };
      }
    }
    pathname = url.pathname;
    search = url.searchParams;
  } catch {
    return { ok: false, reason: "malformed_encoding" };
  }

  const decoded = safeDecodeOnce(pathname);
  if (!decoded.ok) return { ok: false, reason: "malformed_encoding" };
  const cleanPath = decoded.value;

  // اجتياز المسار — يُفحص **بعد** الفكّ، وإلّا مرّ `%2e%2e%2f`.
  if (cleanPath.includes("..") || cleanPath.includes("\\")) {
    return { ok: false, reason: "path_traversal" };
  }

  for (const t of targets) {
    const params = matchPattern(t.pattern, cleanPath);
    if (params) {
      return {
        ok: true, target: t, path: cleanPath, params,
        hasToken: Boolean(t.tokenParam && search.get(t.tokenParam)),
      };
    }
  }
  return { ok: false, reason: "not_in_allow_list" };
}

// ─── الرموز ─────────────────────────────────────────────────────────────────

/**
 * 🔴 ردّ محايد **واحد** لكل حالات الرمز.
 *
 * التمييز بين «الرمز غير موجود» و«منتهٍ» و«مُلغى» يُسلّم المهاجم مُخبِرًا:
 * يجرّب رموزًا فيعرف أيّها كان صحيحًا يومًا. والرسالة الواحدة تُفقده ذلك تمامًا.
 */
export const NEUTRAL_TOKEN_MESSAGE_AR =
  "هذا الرابط لم يعد صالحًا. اطلب رابطًا جديدًا.";
export const NEUTRAL_TOKEN_MESSAGE_EN =
  "This link is no longer valid. Please request a new one.";

export type TokenState = "missing" | "expired" | "revoked" | "invalid" | "valid";

/** ⛔ لا يكشف الحالة الحقيقية إطلاقًا خارج الحالة الصالحة. */
export function neutralUserMessage(state: TokenState, locale: "ar" | "en" = "ar"): string | null {
  if (state === "valid") return null;
  return locale === "ar" ? NEUTRAL_TOKEN_MESSAGE_AR : NEUTRAL_TOKEN_MESSAGE_EN;
}

/**
 * ينزع الرمز من الرابط بعد استهلاكه.
 *
 * 🔴 لماذا: الرابط يبقى في التاريخ وفي `document.referrer` وفي سجلّات الخادم
 *    الوسيط ومشاركة الشاشة. ونزعه بعد الاستهلاك يقصّر نافذة التسريب كثيرًا.
 */
export function stripTokenFromUrl(rawUrl: string, tokenParams: readonly string[] = ["token", "t", "access_token", "code"]): string {
  try {
    const url = new URL(rawUrl, "https://kianmedia.com");
    let touched = false;
    for (const p of tokenParams) {
      if (url.searchParams.has(p)) { url.searchParams.delete(p); touched = true; }
    }
    if (!touched) return rawUrl;
    const qs = url.searchParams.toString();
    return `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`;
  } catch {
    return rawUrl;
  }
}

/**
 * حمولة تحليلات آمنة.
 * ⛔ لا رمز ولا مُعرِّف كيان ولا استعلام — المفتاح ونتيجة الحلّ فقط.
 */
export function analyticsPayload(res: LinkResolution): Record<string, string | boolean> {
  if (!res.ok) return { deep_link: "rejected", reason: res.reason };
  return {
    deep_link: "resolved",
    target: res.target.key,
    readiness: res.target.readiness,
    // ⛔ لا القيمة، بل وجودها فقط.
    had_token: res.hasToken,
  };
}
