// ════════════════════════════════════════════════════════════════════════════
// lib/notifications/expoPush.ts — مُهايئ Expo Push.
//
// Wave 8 · V2-8.3-B
//
// ★ ما هذا الملفّ ★
//  **قناة إضافية داخل نطاق الإشعارات القائم** — نفس المستلمين، نفس التفضيلات،
//  نفس سجلّ التسليم (`notification_delivery_log`, channel='push').
//  ⛔ **ليس خدمة إشعارات ثانية**، ولا طابورًا موازيًا، ولا عاملًا خلفيًّا.
//
// ★ الحالة ★
//  🔴 **العلم مطفأ افتراضيًّا** (`PUSH_EXPO_ENABLED` ≠ "1")، والنقل الافتراضيّ
//  **وهميّ**. ⛔ لا اعتماد Expo في المستودع، ولا نداء شبكة حقيقيّ في أيّ اختبار.
//
// ★ ما لا يفعله عمدًا ★
//  • لا يُسقط البريد ولا إشعار البوّابة عند فشله — الدفع **إضافة** لا بديل.
//  • لا يطبع رمزًا ولا جزءًا منه في أيّ مسار (§التنقيح).
//  • لا يَعِد بأنّ المستخدم **قرأ** الإشعار: الإيصال يعني «سلّمناه للمزوِّد».
// ════════════════════════════════════════════════════════════════════════════

/** حدّ Expo المعلن للدفعة الواحدة. تجاوزه يُرفض كاملًا لا جزئيًّا. */
export const EXPO_MAX_BATCH = 100;
export const EXPO_TIMEOUT_MS = 10_000;
export const EXPO_MAX_ATTEMPTS = 3;
const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send";

export type PushTicketStatus = "ok" | "error";
export type PushErrorCode =
  | "DeviceNotRegistered" | "MessageTooBig" | "MessageRateExceeded"
  | "InvalidCredentials" | "ProviderOther" | "Timeout" | "MalformedResponse"
  | "RateLimited" | "Disabled";

export interface PushMessage {
  /** رمز Expo. 🔴 حسّاس — لا يُسجَّل ولا يُعاد في أيّ مخرَج. */
  token: string;
  /** بصمة الرمز — **هذه** ما يُسجَّل ويُستعمل في الإبطال. */
  fingerprint: string;
  title: string;
  body: string;
  /** ⛔ بيانات وصفية فقط: مُعرِّفات توجيه لا محتوى حسّاس (§الخصوصية). */
  data?: Record<string, string>;
}

export interface PushTicket {
  fingerprint: string;
  status: PushTicketStatus;
  /** مُعرِّف الإيصال من المزوِّد — للمتابعة لاحقًا. */
  receiptId?: string;
  errorCode?: PushErrorCode;
  /** يجب إبطال الرمز في القاعدة (`push_mark_invalid`). */
  shouldInvalidate?: boolean;
}

export interface PushSendResult {
  attempted: number;
  sent: number;
  failed: number;
  /** رموز يجب إبطالها — **بصمات**، لا رموز. */
  invalidate: string[];
  tickets: PushTicket[];
  /** سبب عدم المحاولة إطلاقًا (علم مطفأ مثلًا). */
  skippedReason?: "flag_off" | "no_recipients" | "empty_batch";
}

/** النقل — يُحقَن، فالاختبار لا يلمس الشبكة أبدًا. */
export interface PushTransport {
  send(payload: unknown, signal: AbortSignal): Promise<unknown>;
}

// ─── العلم ──────────────────────────────────────────────────────────────────
//
// 🔴 مقارنة صارمة بـ"1" لا `!== "false"`: المتغيّر الغائب أو الفارغ أو أيّ قيمة
//    أخرى تعني **مطفأ**. قناة تُرسل إلى أجهزة المستخدمين لا تُفعَّل بالسهو.
// ⛔ وليست `NEXT_PUBLIC_*` عمدًا: الإرسال خادميّ بحت، ولا سبب لتسريب حالته
//    إلى حزمة المتصفّح.
export function expoPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUSH_EXPO_ENABLED === "1";
}

// ─── التنقيح — يُستعمل في كلّ مسار تسجيل ────────────────────────────────────
/**
 * 🔴 لا يُعيد أيّ جزء من الرمز.
 *
 * الشائع أن يُطبع «آخر أربعة محارف للتشخيص» — ورمز Expo بنية معروفة
 * (`ExponentPushToken[…]`)، فالذيل يضيّق مجال التخمين ويربط السجلّات ببعضها.
 * البصمة تكفي للتتبّع: مستقرّة، وقابلة للمطابقة، ولا تُفكّ.
 */
export function redactToken(token: string): string {
  if (!token) return "(empty)";
  return `token(len=${token.length},redacted)`;
}

/** ⛔ يمنع تسرّب الرمز عبر رسالة خطأ أو حقل بيانات. */
export function redactPayloadForLog(msgs: PushMessage[]): Array<Record<string, unknown>> {
  return msgs.map((m) => ({
    fingerprint: m.fingerprint,
    token: redactToken(m.token),
    titleLen: m.title.length,
    bodyLen: m.body.length,
    dataKeys: Object.keys(m.data ?? {}),   // مفاتيح لا قيم
  }));
}

// ─── النقل الوهميّ — الافتراض في كلّ اختبار ────────────────────────────────
export function mockTransport(
  script: (payload: unknown) => unknown | Promise<unknown>,
): PushTransport {
  return { async send(payload) { return script(payload); } };
}

/** النقل الحقيقيّ. ⛔ لا يُبنى إلّا باستدعاء صريح، ولا يُستعمل في اختبار. */
export function httpTransport(accessToken?: string): PushTransport {
  return {
    async send(payload, signal) {
      const res = await fetch(EXPO_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal,
      });
      if (res.status === 429) {
        const e = new Error("rate_limited") as Error & { code?: string };
        e.code = "RateLimited";
        throw e;
      }
      return res.json();
    },
  };
}

// ─── تقسيم الدفعات ──────────────────────────────────────────────────────────
export function chunk<T>(items: T[], size = EXPO_MAX_BATCH): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * مفتاح التكرار — يمنع إرسال نفس المحتوى لنفس الجهاز مرّتين عند إعادة المحاولة.
 *
 * 🔴 مبنيّ على البصمة لا الرمز، فلا يمرّ الرمز في مفتاح قد يُسجَّل.
 */
export function idempotencyKey(correlationId: string, fingerprint: string): string {
  return `${correlationId}:${fingerprint}`;
}

// ─── قراءة استجابة المزوِّد — بتحقّق، لا بثقة ──────────────────────────────
const INVALIDATING: ReadonlySet<string> = new Set(["DeviceNotRegistered", "InvalidCredentials"]);

function mapErrorCode(raw: unknown): PushErrorCode {
  const s = typeof raw === "string" ? raw : "";
  switch (s) {
    case "DeviceNotRegistered": case "MessageTooBig":
    case "MessageRateExceeded": case "InvalidCredentials":
      return s;
    default: return "ProviderOther";
  }
}

/**
 * يحوّل استجابة Expo إلى تذاكر.
 *
 * 🔴 **الفشل الجزئيّ هو الحالة العادية لا الاستثناء:** ترجع Expo مصفوفة بطول
 *    الدفعة، وقد ينجح عنصر ويفشل جاره. فمعالجة «الاستجابة نجحت ⇒ الكلّ وصل»
 *    تُسقط أعطالًا حقيقية بصمت — ولذلك تُقرأ كلّ تذكرة على حدة.
 * ⚠️ واستجابة مشوَّهة **ليست نجاحًا**: تُعامَل فشلًا صريحًا لا تُتجاهل.
 */
export function parseExpoResponse(raw: unknown, batch: PushMessage[]): PushTicket[] {
  const body = raw as { data?: unknown } | null;
  const arr = body && Array.isArray(body.data) ? (body.data as unknown[]) : null;
  if (!arr || arr.length !== batch.length) {
    return batch.map((m) => ({
      fingerprint: m.fingerprint, status: "error" as const,
      errorCode: "MalformedResponse" as const, shouldInvalidate: false,
    }));
  }
  return arr.map((entry, i) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const fingerprint = batch[i].fingerprint;
    if (e.status === "ok") {
      return {
        fingerprint, status: "ok" as const,
        receiptId: typeof e.id === "string" ? e.id : undefined,
      };
    }
    const detailsErr = ((e.details ?? {}) as Record<string, unknown>).error;
    const code = mapErrorCode(detailsErr);
    return {
      fingerprint, status: "error" as const, errorCode: code,
      // 🔴 الإبطال لأسباب **دائمة** فقط. إبطال رمز عند تجاوز معدّل مؤقّت يفقد
      //    الجهاز إشعاراته إلى الأبد بسبب ازدحام عابر.
      shouldInvalidate: INVALIDATING.has(String(detailsErr ?? "")),
    };
  });
}

/** هل يُعاد المحاولة؟ الأخطاء الدائمة **لا** تُعاد. */
export function isRetryable(code: PushErrorCode | undefined): boolean {
  return code === "Timeout" || code === "RateLimited" || code === "MessageRateExceeded";
}

// ─── الإرسال ────────────────────────────────────────────────────────────────
export interface SendOptions {
  transport: PushTransport;
  correlationId: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxAttempts?: number;
  batchSize?: number;
  /** يُستدعى بدل console — ويستقبل حمولة منقَّحة سلفًا. */
  log?: (event: string, detail: Record<string, unknown>) => void;
  /** مفاتيح تكرار سبق تنفيذها — يمنع الإرسال المكرَّر. */
  seenKeys?: Set<string>;
  sleep?: (ms: number) => Promise<void>;
}

export async function sendPush(
  messages: PushMessage[], opts: SendOptions,
): Promise<PushSendResult> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});
  const empty: PushSendResult = {
    attempted: 0, sent: 0, failed: 0, invalidate: [], tickets: [],
  };

  // 🔴 الحارس الأوّل: علم مطفأ ⇒ **صفر نداء**. لا نقل يُستدعى، ولا مؤقّت يُنشأ.
  if (!expoPushEnabled(env)) {
    log("push.skipped", { reason: "flag_off", count: messages.length });
    return { ...empty, skippedReason: "flag_off" };
  }
  if (messages.length === 0) return { ...empty, skippedReason: "empty_batch" };

  const seen = opts.seenKeys ?? new Set<string>();
  const fresh = messages.filter((m) => !seen.has(idempotencyKey(opts.correlationId, m.fingerprint)));
  if (fresh.length === 0) return { ...empty, skippedReason: "no_recipients" };

  const timeoutMs = opts.timeoutMs ?? EXPO_TIMEOUT_MS;
  const maxAttempts = opts.maxAttempts ?? EXPO_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const tickets: PushTicket[] = [];

  for (const batch of chunk(fresh, Math.min(opts.batchSize ?? EXPO_MAX_BATCH, EXPO_MAX_BATCH))) {
    let pending = batch;
    let attempt = 0;

    while (pending.length > 0 && attempt < maxAttempts) {
      attempt++;
      const payload = pending.map((m) => ({
        to: m.token, title: m.title, body: m.body, data: m.data ?? {},
      }));

      let batchTickets: PushTicket[];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const raw = await opts.transport.send(payload, controller.signal);
        batchTickets = parseExpoResponse(raw, pending);
      } catch (err) {
        const code: PushErrorCode =
          (err as { code?: string })?.code === "RateLimited" ? "RateLimited" : "Timeout";
        batchTickets = pending.map((m) => ({
          fingerprint: m.fingerprint, status: "error" as const, errorCode: code,
        }));
      } finally {
        clearTimeout(timer);   // ⛔ وإلّا بقي المؤقّت يمنع خروج العملية.
      }

      // ⛔ الحمولة المسجَّلة منقَّحة دائمًا — لا رمز في أيّ سطر.
      log("push.attempt", {
        attempt, size: pending.length, correlationId: opts.correlationId,
        messages: redactPayloadForLog(pending),
        outcomes: batchTickets.map((t) => ({ fingerprint: t.fingerprint, status: t.status, errorCode: t.errorCode })),
      });

      const retry: PushMessage[] = [];
      for (let i = 0; i < batchTickets.length; i++) {
        const t = batchTickets[i];
        if (t.status === "error" && isRetryable(t.errorCode) && attempt < maxAttempts) {
          retry.push(pending[i]);
        } else {
          tickets.push(t);
          if (t.status === "ok") seen.add(idempotencyKey(opts.correlationId, t.fingerprint));
        }
      }
      pending = retry;
      if (pending.length > 0) await sleep(Math.min(250 * attempt, 1000));
    }

    // ما بقي بعد استنفاد المحاولات يُسجَّل فشلًا صريحًا — ⛔ لا يُبتلع.
    for (const m of pending) {
      tickets.push({ fingerprint: m.fingerprint, status: "error", errorCode: "Timeout" });
    }
  }

  const sent = tickets.filter((t) => t.status === "ok").length;
  return {
    attempted: fresh.length,
    sent,
    failed: tickets.length - sent,
    invalidate: tickets.filter((t) => t.shouldInvalidate).map((t) => t.fingerprint),
    tickets,
  };
}
