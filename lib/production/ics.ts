// ════════════════════════════════════════════════════════════════════════════
// lib/production/ics.ts — تغذية iCalendar لأيام التصوير.
//
// Wave 3 · V2-3.6-B  (MASTER_BRIEF_v2.1.md §4 WAVE 3)
//
// ★ لماذا بلا مكتبة ★
// RFC 5545 كبير، والمستعمَل منه هنا صغير ومحدَّد: VCALENDAR واحد، VEVENTs،
// وطيّ سطور عند ٧٥ ثمانيّة. حزمة كاملة لأجل ذلك تضيف سطح سلسلة توريد أكبر من
// المسألة (G7).
//
// ★★ ما يكسر تغذية ICS فعليًّا ★★
// التهريب. نصّ عربيّ فيه فاصلة أو فاصلة منقوطة أو سطر جديد — وهو الحال الطبيعيّ
// لعنوان مهمّة — يُفسد الملفّ كلّه إن لم يُهرَّب، فيرفضه Google Calendar بصمت.
// ولذلك `escapeText` هو قلب هذا الملفّ، والاختبارات تركّز عليه.
//
// ⛔ ولا يخرج من هنا هاتف ولا أجر ولا ملاحظة داخلية: رابط تقويم قد يُشارَك بلا
//    قصد، فما فيه هو ما لا يضرّ تسرّبه. التصفية الحقيقية في القاعدة
//    (prodops_calendar_feed)، وهذا الملفّ لا يُضيف حقلًا لم يصله.
// ════════════════════════════════════════════════════════════════════════════

export interface IcsEvent {
  id: string;
  code?: string | null;
  title?: string | null;
  /** ISO 8601. غياب البداية يُسقط الحدث — لا يُخترع وقت. */
  start?: string | null;
  end?: string | null;
  status?: string | null;
  location?: string | null;
  city?: string | null;
}

/**
 * تهريب RFC 5545 §3.3.11. الترتيب مقصود: العكسيّة أوّلًا وإلّا ضوعف تهريبها.
 */
export function escapeText(v: unknown): string {
  return String(v ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/**
 * طيّ السطور عند ٧٥ **ثمانيّة** لا ٧٥ محرفًا.
 *
 * 🔴 الفرق جوهريّ بالعربية: الحرف العربيّ ثمانيّتان في UTF-8، فالطيّ بعدّ
 * المحارف يُنتج سطورًا تتجاوز الحدّ ويرفضها بعض العملاء. والقصّ يجب ألّا يقع
 * داخل محرف متعدّد الثمانيّات وإلّا خرجت بايتات معطوبة.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  // أوّل سطر ٧٥ ثمانيّة، وما يليه ٧٤ (مسافة الاستمرار تشغل واحدة).
  let limit = 75;
  for (const ch of line) {          // التكرار بالمحارف: لا يقصّ زوجًا بديلًا
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = ch;
      curBytes = b;
      limit = 74;
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");
}

/** ISO → "20260621T043000Z". قيمة غير صالحة ⇒ null، ولا يُخترع وقت. */
export function toIcsUtc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** مدّة افتراضية حين لا نهاية مسجَّلة. مُعلنة لا مخفيّة. */
export const DEFAULT_DURATION_HOURS = 4;

export interface IcsOptions {
  calendarName?: string;
  /** نطاق UID — يجب أن يكون ثابتًا كي لا يتكرّر الحدث عند كل تحديث. */
  uidDomain?: string;
  /** لحظة التوليد. مُمرَّرة كي يكون الإخراج قابلًا للاختبار حرفيًّا. */
  now?: Date;
}

/**
 * يبني VCALENDAR كاملًا. حدث بلا بداية صالحة يُسقَط بصمت — تغذية ناقصة أفضل من
 * تغذية معطوبة يرفضها العميل كلّها.
 */
export function buildIcs(events: IcsEvent[], opts: IcsOptions = {}): string {
  const name = opts.calendarName ?? "Kian Media — أيام التصوير";
  const domain = opts.uidDomain ?? "kianmedia.com";
  const stamp = toIcsUtc((opts.now ?? new Date()).toISOString()) ?? "19700101T000000Z";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//Kian Media//Production Operations//AR`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    // العملاء يحترمون هذا كتلميح لدورية التحديث؛ ساعة كافية ليوم تصوير.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const e of Array.isArray(events) ? events : []) {
    // 🔴 عنصر null داخل المصفوفة كان يُسقط البنّاء كلّه. تغذية تقويم تُبنى من
    // ردّ قاعدة، والردّ ليس مضمون الشكل — فالحارس هنا لا في المستدعي.
    if (!e || typeof e !== "object") continue;
    const dtStart = toIcsUtc(e.start);
    if (!dtStart || !e.id) continue;          // بلا بداية أو هويّة ⇒ لا حدث

    const dtEnd =
      toIcsUtc(e.end) ??
      toIcsUtc(new Date(Date.parse(e.start as string) + DEFAULT_DURATION_HOURS * 3_600_000).toISOString());

    const summary = [e.code, e.title].filter(Boolean).join(" · ") || "مهمّة تصوير";
    const where = [e.location, e.city].filter(Boolean).join("، ");

    lines.push(
      "BEGIN:VEVENT",
      // UID ثابت مشتقّ من هويّة المهمّة: التحديث يُعدّل الحدث ولا يُنشئ نسخة.
      `UID:${e.id}@${domain}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dtStart}`,
      ...(dtEnd ? [`DTEND:${dtEnd}`] : []),
      `SUMMARY:${escapeText(summary)}`,
      ...(where ? [`LOCATION:${escapeText(where)}`] : []),
      // ⛔ لا وصف يحمل تفاصيل: الحالة وحدها.
      ...(e.status ? [`DESCRIPTION:${escapeText(`الحالة: ${e.status}`)}`] : []),
      // مهمّة ملغاة تُعلَّم ملغاة فيُزيلها العميل، بدل أن تختفي بلا أثر.
      `STATUS:${e.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  // CRLF إلزاميّ في RFC 5545 — بعض العملاء يرفض LF وحده.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** تغذية فارغة صالحة — لرمز نشط بلا مهامّ. أفضل من 404 يبدو عطلًا. */
export const emptyIcs = (opts: IcsOptions = {}): string => buildIcs([], opts);
