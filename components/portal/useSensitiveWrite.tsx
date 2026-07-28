// FILE: components/portal/useSensitiveWrite.tsx   (new — tsc --noEmit exit 0 against the repo)
"use client";
// ════════════════════════════════════════════════════════════════════════════
// KIAN — S4b · الغلاف الحميّ للكتابات الحسّاسة (محاولة إعادة واحدة فقط)
//         The client half of the S4b sensitive-write gate. Retry-once, never loop.
//
// ★ لماذا يوجد هذا الملفّ أصلًا ★
//   بوّابة `mfa_require_aal2()` تُطلق `raise exception 'mfa_required'` بالرمز `P0002`.
//   PostgREST يُعيدها جسمًا فيه `{"code":"P0002","message":"mfa_required","hint":…}`.
//   و`prpc` في `lib/portal/client.ts:135` يُطبّع ذلك إلى `{ ok:false, error:"mfa_required" }`.
//   **بلا هذا الغلاف** كل واجهة تعرض النصّ الخام `mfa_required` — وهي بالنسبة للمالك
//   رسالة بلا معنى، أو — في المسارات التي تبتلع النتيجة — لا شيء إطلاقًا: الشاشة
//   البيضاء التي مُنعت صراحة.
//
// ★ حدود هذا الملفّ — اقرأها قبل تعديله ★
//   • هذا **تجربة استخدام، لا حدّ أمنيّ.** الحدّ هو `mfa_write_ok()` في Postgres.
//     من يُغلق النافذة لا يتجاوز شيئًا؛ هو ببساطة لا يحصل على رمز aal2.
//   • **لا عميل مصادقة ثانٍ.** كل شيء هنا يمرّ عبر `lib/portal/mfa.ts` و`prpc`
//     الموجودَين، ولا يُضاف `@supabase/supabase-js` ولا مخزن جلسة ثانٍ.
//   • **لا حلقة.** `mfa_required` ثانية بعد الترقية تُعرض خطأً ولا تفتح النافذة ثانية.
//   • **لا ابتلاع.** كل مسار خروج يحمل رسالة قابلة للعرض. لا `catch(() => {})`.
//   • **لا فقدان لبيانات النموذج.** الغلاف يستقبل *دالّة* (thunk) تُغلِّف حالة المكوّن،
//     والنافذة طبقة فوقية لا تُفكّك الشجرة. لا تُفرّغ حقولك قبل وصول النتيجة.
//   • **النتيجة المُبلَّغة هي نتيجة العملية الأصلية** بعد الإعادة، لا مجرّد «نجح التحقّق».
//     لهذا يعود `status:"ok"` حاملًا `data` الحقيقية (بما فيها `false` من
//     `admin_set_staff_role` التي تعني «صفّ محميّ / لا صفّ»).
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import MfaStepUp from "@/components/portal/MfaStepUp";
import { mfaMyAssurance, mfaErrorText, type MfaError } from "@/lib/portal/mfa";
import type { Result } from "@/lib/portal/client";

// ─────────────────────────────────────────────────────────────────────────────
// المفردات — مغلقة عمدًا. لا تُشتقّ رسالة من نثر الخادم أبدًا.
// ─────────────────────────────────────────────────────────────────────────────
export type SensitiveWriteCode =
  | "mfa_required"                // P0002 — البوّابة طلبت aal2
  | "mfa_verification_failed"     // تعذّر إثبات نجاح الترقية
  | "mfa_session_not_elevated"    // التحقّق نجح لكن Postgres ما زال يقول aal1
  | "authorization_denied"        // P0003 — الحارس رفض (ليست MFA)
  | "role_change_denied"          // P0003 من `admin_set_staff_role` تحديدًا
  | "sensitive_write_retry_failed"// إعادة واحدة تمّت وعادت `mfa_required` ثانية
  | "mfa_cancelled"               // المستخدم أغلق النافذة — لم تُنفَّذ العملية
  | "sensitive_write_busy";       // عملية حسّاسة أخرى تنتظر التحقّق الآن

const TEXT: Record<SensitiveWriteCode, [ar: string, en: string]> = {
  mfa_required: [
    "هذه عملية حسّاسة وتحتاج تأكيد الهوية بخطوتين. لم يُنفَّذ أيّ تغيير بعد.",
    "This is a sensitive action and needs two-step confirmation. Nothing has been changed yet.",
  ],
  mfa_verification_failed: [
    "تعذّر إتمام التحقّق بخطوتين. لم يُنفَّذ أيّ تغيير.",
    "Two-step verification could not be completed. No change was made.",
  ],
  mfa_session_not_elevated: [
    "قُبل الرمز لكن لم يرتفع مستوى الجلسة، فلم تُنفَّذ العملية. سجّل الخروج ثم الدخول وأعد المحاولة.",
    "The code was accepted but your session was not elevated, so the operation was not performed. Sign out, sign in again, and retry.",
  ],
  authorization_denied: [
    "لا تملك صلاحية تنفيذ هذه العملية. لم يُنفَّذ أيّ تغيير.",
    "You are not authorized to perform this operation. No change was made.",
  ],
  role_change_denied: [
    "تغيير هذا الدور غير مسموح لحسابك. لم يُنفَّذ أيّ تغيير.",
    "Your account is not allowed to make this role change. No change was made.",
  ],
  sensitive_write_retry_failed: [
    "طُلب التحقّق مرة أخرى بعد نجاحه، فأُوقفت العملية بدل تكرار السؤال. لم يُنفَّذ أيّ تغيير — أعد تحميل الصفحة وحاول مجددًا.",
    "Verification was demanded again after it had succeeded, so the operation was stopped instead of asking twice. No change was made — reload the page and try again.",
  ],
  mfa_cancelled: [
    "أُلغي التحقّق، ولذلك **لم تُنفَّذ** العملية. بياناتك كما هي.",
    "Verification was cancelled, so the operation was **not** performed. Your input is unchanged.",
  ],
  sensitive_write_busy: [
    "هناك عملية حسّاسة أخرى تنتظر التحقّق. أكملها أو ألغِها أولًا.",
    "Another sensitive operation is waiting for verification. Finish or cancel it first.",
  ],
};

/** نصّ ثنائي اللغة لكل رمز. لا يُعيد فراغًا أبدًا. */
export function sensitiveWriteText(code: SensitiveWriteCode, isAr: boolean): string {
  const pair = TEXT[code] ?? TEXT.mfa_verification_failed;
  return isAr ? pair[0] : pair[1];
}

// ─────────────────────────────────────────────────────────────────────────────
// الكشف — من رسالة PostgREST، لا من رمز HTTP
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ `prpc` يُسقط حقل `code` (SQLSTATE) في `client.ts:104` ويُبقي `message` فقط،
//    ولذلك المطابقة تتمّ على الرسالة أوّلًا. وهي **ليست** مطابقة نثر هشّة: النصّ
//    `mfa_required` نُصدره نحن حرفيًا من `raise exception` ولا يُترجم ولا يتغيّر.
//    ومع ذلك نقبل `P0002`/`P0003` أيضًا لو سُرِّب الرمز يومًا داخل النصّ، ونقبل
//    نصّ الـ`hint` الذي يظهر حين يغيب `message` — ثلاث طبقات لا واحدة.
//    كما لا نعتمد على رمز HTTP: PostgREST يُعيد 500 لصنف `P0`، وهو رقم يشترك فيه
//    عشرات الأعطال غير المتعلّقة بـMFA.
const RE_MFA_REQUIRED = /(^|[^a-z0-9_])mfa_required([^a-z0-9_]|$)|\bP0002\b|التحقّق بخطوتين|two-step verification/i;
const RE_ROLE_DENIED = /(^|[^a-z0-9_])role_change_denied([^a-z0-9_]|$)/i;
const RE_AUTHZ_DENIED = /(^|[^a-z0-9_])authorization_denied([^a-z0-9_]|$)|\bP0003\b/i;

/**
 * صنّف نصّ خطأ من `Result.error`. يُعيد `null` لأيّ خطأ آخر — والمُستدعي **يجب**
 * أن يعرضه كما هو؛ `null` تعني «ليس من عائلتنا»، لا «تجاهله».
 */
export function classifySensitiveError(message: string | null | undefined): SensitiveWriteCode | null {
  const s = String(message ?? "");
  if (!s) return null;
  if (RE_MFA_REQUIRED.test(s)) return "mfa_required";
  if (RE_ROLE_DENIED.test(s)) return "role_change_denied";   // الأخصّ قبل الأعمّ
  if (RE_AUTHZ_DENIED.test(s)) return "authorization_denied";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// النتيجة — اتحاد مميَّز، لا boolean
// ─────────────────────────────────────────────────────────────────────────────
export type SensitiveOutcome<T> =
  /** نجحت العملية الأصلية. `data` هي حمولتها الحقيقية. `steppedUp` = هل احتاجت ترقية. */
  | { status: "ok"; data: T; steppedUp: boolean }
  /** رُفضت لسبب تفويض معروف (P0003). مترجَمة. */
  | { status: "denied"; code: SensitiveWriteCode; message: string; raw: string; httpStatus?: number }
  /** ألغى المستخدم التحقّق — **لم تُنفَّذ** العملية. */
  | { status: "cancelled"; code: "mfa_cancelled"; message: string }
  /** فشل آخر. `code` قد تكون `null` لخطأ خارج عائلتنا، و`message` عندها هو النصّ الخام. */
  | { status: "failed"; code: SensitiveWriteCode | null; message: string; raw: string; httpStatus?: number };

export interface SensitiveReason {
  /** وصف قصير لما يفعله المستخدم، يظهر داخل نافذة التحقّق: «تغيير دور موظف». */
  ar: string;
  en: string;
}

type StepUpVerdict = "verified" | "cancelled";

export interface UseSensitiveWrite {
  /**
   * نفّذ كتابة حسّاسة مع إعادة واحدة بعد الترقية.
   *
   * `op` **دالّة** لا وعد جاهز: تُستدعى مرة ثانية عند الإعادة، وتُغلِّف حالة النموذج
   * الحيّة، فلا تُفقد بيانات المستخدم ولا تُعاد قيمة قديمة.
   */
  run: <T>(op: () => Promise<Result<T>>, reason?: SensitiveReason) => Promise<SensitiveOutcome<T>>;
  /** اعرضه في شجرة المكوّن. لا يرسم شيئًا ما لم تُطلب ترقية. */
  stepUpModal: React.ReactNode;
  /** true بين بدء العملية ونتيجتها (بما في ذلك انتظار النافذة) — لتعطيل الأزرار. */
  pending: boolean;
  /** نصّ ثنائي اللغة جاهز، مربوط بلغة الواجهة الحالية. */
  text: (code: SensitiveWriteCode) => string;
}

export function useSensitiveWrite(): UseSensitiveWrite {
  const { t, isAr } = useI18n();
  const [pending, setPending] = useState(false);
  const [stepUp, setStepUp] = useState<{ open: boolean; reason?: string }>({ open: false });

  const resolverRef = useRef<((v: StepUpVerdict) => void) | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  // لو فُكّ المكوّن والنافذة مفتوحة، لا يجوز أن يبقى وعد معلّق إلى الأبد.
  // نحسمها «إلغاءً» — وهو الوصف الصادق: لم تُنفَّذ العملية.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const r = resolverRef.current;
      resolverRef.current = null;
      if (r) r("cancelled");
    };
  }, []);

  const settle = useCallback((v: StepUpVerdict) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    if (mountedRef.current) setStepUp({ open: false });
    if (r) r(v);
  }, []);

  const promptStepUp = useCallback((reason?: string) => {
    return new Promise<StepUpVerdict>((resolve) => {
      resolverRef.current = resolve;
      setStepUp({ open: true, reason });
    });
  }, []);

  const text = useCallback((code: SensitiveWriteCode) => sensitiveWriteText(code, isAr), [isAr]);

  const run = useCallback(
    async function run<T>(op: () => Promise<Result<T>>, reason?: SensitiveReason): Promise<SensitiveOutcome<T>> {
      if (busyRef.current) {
        return { status: "failed", code: "sensitive_write_busy", message: sensitiveWriteText("sensitive_write_busy", isAr), raw: "sensitive_write_busy" };
      }
      busyRef.current = true;
      if (mountedRef.current) setPending(true);

      // مُغلِّف: أيّ استثناء JS حقيقي (شبكة، تحليل) يصير نتيجة معروضة — لا ابتلاع ولا انهيار.
      const call = async (): Promise<Result<T>> => {
        try {
          return await op();
        } catch (e) {
          return { ok: false, error: String(e), status: 0 };
        }
      };

      try {
        // ── المحاولة الأولى ──────────────────────────────────────────────────
        const first = await call();
        if (first.ok) return { status: "ok", data: first.data, steppedUp: false };

        const code1 = classifySensitiveError(first.error);
        if (code1 === "role_change_denied" || code1 === "authorization_denied") {
          return { status: "denied", code: code1, message: sensitiveWriteText(code1, isAr), raw: first.error, httpStatus: first.status };
        }
        if (code1 !== "mfa_required") {
          // ليس من عائلتنا — يُعرض النصّ الخام كما هو. أبدًا لا يُبتلع.
          return { status: "failed", code: null, message: first.error, raw: first.error, httpStatus: first.status };
        }

        // ── الترقية — نافذة MfaStepUp القائمة، بلا نسخة ثانية ────────────────
        const verdict = await promptStepUp(reason ? t(reason) : undefined);
        if (verdict === "cancelled") {
          return { status: "cancelled", code: "mfa_cancelled", message: sensitiveWriteText("mfa_cancelled", isAr) };
        }

        // ── إثبات الترقية من Postgres، لا من اعتقادنا ────────────────────────
        // `mfaVerify` كتب الجلسة الجديدة أصلًا (mfa.ts)، و`mfaStepUp` تحقّق مرة.
        // نُعيد السؤال هنا مستقلًّا: لا نُعيد المحاولة إلّا على تأكيد صريح `is_aal2`.
        const assurance = await mfaMyAssurance();
        if (!assurance.ok) {
          const why: MfaError = assurance.error;
          return {
            status: "failed",
            code: "mfa_verification_failed",
            message: `${sensitiveWriteText("mfa_verification_failed", isAr)} — ${mfaErrorText(why, isAr)}`,
            raw: why,
          };
        }
        if (assurance.data.is_aal2 !== true) {
          // نجح التحقّق ومع ذلك الجلسة aal1 ⇒ **لا نُعيد**. إعادة محكومة بالفشل تُنتج
          // نافذة ثانية أو رسالة كاذبة؛ التسمية الصريحة أنفع للمالك.
          return { status: "failed", code: "mfa_session_not_elevated", message: sensitiveWriteText("mfa_session_not_elevated", isAr), raw: "mfa_session_not_elevated" };
        }

        // ── الإعادة — **مرة واحدة**، ولا شيء بعدها يفتح نافذة ────────────────
        const second = await call();
        if (second.ok) return { status: "ok", data: second.data, steppedUp: true };

        const code2 = classifySensitiveError(second.error);
        if (code2 === "mfa_required") {
          return { status: "failed", code: "sensitive_write_retry_failed", message: sensitiveWriteText("sensitive_write_retry_failed", isAr), raw: second.error, httpStatus: second.status };
        }
        if (code2 === "role_change_denied" || code2 === "authorization_denied") {
          return { status: "denied", code: code2, message: sensitiveWriteText(code2, isAr), raw: second.error, httpStatus: second.status };
        }
        return { status: "failed", code: null, message: second.error, raw: second.error, httpStatus: second.status };
      } finally {
        busyRef.current = false;
        if (mountedRef.current) {
          setPending(false);
          setStepUp({ open: false });
        }
        resolverRef.current = null;
      }
    },
    [isAr, promptStepUp, t],
  );

  const stepUpModal = (
    <MfaStepUp
      open={stepUp.open}
      reason={stepUp.reason}
      onCancel={() => settle("cancelled")}
      onVerified={() => settle("verified")}
    />
  );

  return { run, stepUpModal, pending, text };
}

// ─────────────────────────────────────────────────────────────────────────────
// مساعد عرض — سطر واحد صالح للعرض من أيّ نتيجة، ولا يُعيد فراغًا أبدًا
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `prefix` هو نصّ الواجهة القائم («تعذّر الحفظ: ») حتى لا تتغيّر نبرة الشاشة.
 * `okText` يُستعمل فقط حين تريد الواجهة رسالة نجاح موحّدة؛ الأفضل أن تبني رسالة
 * النجاح من `outcome.data` الحقيقية.
 */
export function sensitiveOutcomeMessage<T>(outcome: SensitiveOutcome<T>, prefix = ""): string {
  switch (outcome.status) {
    case "ok": return "";
    case "cancelled": return outcome.message;
    case "denied":
    case "failed": return prefix + outcome.message;
  }
}
