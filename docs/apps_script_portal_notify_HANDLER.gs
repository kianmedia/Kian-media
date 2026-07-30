/* ════════════════════════════════════════════════════════════════════════════
   KIAN — Google Apps Script: PORTAL NOTIFY HANDLER   (تطبيق يدويّ — إلزاميّ)

   ⚠️ هذا الملفّ للنسخ اليدويّ فقط. لا يُنشَر تلقائيًّا من المستودع، ولا يستطيع أيّ
      كود هنا الوصول إلى حساب Google الخاصّ بالمالك. حتى تُلصق وتُنشر نسخة جديدة،
      كلّ إرسال بريد من البوابة يُصنَّف relay_handler_missing — وهو تصنيف صادق:
      لا شيء يُرسَل، ولا شيء يُفقَد (يبقى الصفّ في الطابور).

   ★★ سبب عدم وصول أيّ بريد من البوابة ★★
   بريد كيان يُرسَل من سكربت Google هذا (هو وحده يملك صلاحية الإرسال — لا مفاتيح
   بريد داخل الموقع إطلاقًا). السكربت المنشور حاليًّا يحتوي على ما معناه:

       if (String(data._type || "") !== "quote") return;   // عروض الأسعار فقط

   أي أنّه يُرسل لطلبات عروض الأسعار فقط، بينما كلّ إشعارات البوابة تُرسَل بالنوع
   "portal_notify" — فيخرج السكربت فورًا دون إرسال، ثمّ يردّ HTTP 200 وكأنّ كلّ
   شيء تمام. لذلك سُجِّلت رسائل كـ«أُرسلت» ولم يُرسَل بريد قطّ.

   ─────────────────────────────────────────────────────────────────────────────
   ما الجديد في هذه النسخة (عقد مركز الاتصالات — docs/EMAIL_PROVIDER_CONTRACT.md)
   ─────────────────────────────────────────────────────────────────────────────
   1) توقيع HMAC-SHA256 اختياريّ ثمّ إلزاميّ: نقطة /exec مفتوحة للعموم بحكم
      إعداد "Who has access = Anyone"، فبدون توقيع يستطيع أيّ شخص يعرف الرابط
      أن يجعل السكربت يُرسل بريدًا. المفتاح يُخزَّن في Script Properties — ولا
      يوجد أيّ سرّ حقيقيّ في هذا الملفّ ولا في المستودع.
   2) منع التكرار (Idempotency): تكرار نفس IdempotencyKey خلال 6 ساعات يُعيد
      نفس النتيجة السابقة مع duplicate:true بدل إرسال بريد ثانٍ.
   3) نافذة زمنيّة ±10 دقائق على SignedAt لمنع إعادة التشغيل (replay).
   4) ردّ JSON صريح دائمًا: الموقع يميّز «وصلت فعلًا» من «السكربت لم يفهمها».

   ─────────────────────────────────────────────────────────────────────────────
   خطوات التطبيق (دقيقتان)
   ─────────────────────────────────────────────────────────────────────────────
   1) افتح  script.google.com  ← المشروع الذي يملك رابط الـWeb App المستخدم في
      الموقع (نفس رابط /exec).
   2) الصق محتوى هذا الملفّ كاملًا في نهاية ملفّ الكود (Code.gs) — إضافة فقط،
      لا تحذف شيئًا موجودًا.
   3) في دالّة doPost لديك، أضِف الأسطر الثلاثة المعلَّمة في *أوّل* الدالّة
      مباشرة بعد قراءة البيانات:

        function doPost(e) {
          var data = JSON.parse(e.postData.contents);

          // ▼▼▼ أضِف هذه الأسطر الثلاثة ▼▼▼
          var portal = kianHandlePortalNotify_(data);
          if (portal) return kianJson_(portal);
          // ▲▲▲ نهاية الإضافة ▲▲▲

          // ...بقيّة الكود الحاليّ كما هو (كتابة الصفّ + بريد عروض الأسعار)...
        }

      وضعُها في الأوّل مقصود: إشعارات البوابة لا يجب أن تُكتب في جدول عروض الأسعار.

   4) (موصى به بشدّة) اضبط المفتاح السرّيّ:
        Project Settings ← Script Properties ← Add script property
          KIAN_PORTAL_NOTIFY_SECRET = «سلسلة عشوائيّة طويلة تُنشئها أنت»
      ثمّ ضع القيمة نفسها في Vercel باسم COMMS_RELAY_SIGNING_SECRET.
      ⚠️ لا تكتب المفتاح في هذا الملفّ ولا في أيّ ملفّ داخل المستودع.

   5) بعد أن يصبح كلّ مُنتِج للبريد مارًّا بمركز الاتصالات (وليس قبل ذلك)، اضبط:
          KIAN_PORTAL_NOTIFY_REQUIRE_SIGNATURE = true
      عندها تُرفض أيّ حمولة غير موقَّعة. قبل تلك اللحظة تُقبل الحمولات القديمة
      غير الموقَّعة حتى لا ينكسر مسار عامل اليوم.

   6) Deploy ← Manage deployments ← عدّل النشر الحاليّ ← Version: New version
      ← Deploy.  (بدون نشر نسخة جديدة يبقى الكود القديم يعمل.)
      تأكّد أنّ الإعداد: Execute as = Me،  Who has access = Anyone.

   ─────────────────────────────────────────────────────────────────────────────
   الأمان والحدود
   ─────────────────────────────────────────────────────────────────────────────
   • إضافيّ بالكامل: لا يمسّ منطق quote/meeting/upload الحاليّ العامل.
   • كلّ شيء داخل try/catch: خطأ البريد لا يُفشِل كتابة الجدول أبدًا.
   • رسالة منفصلة لكلّ مستلِم (لا تُكشَف العناوين بين المستلِمين).
   • الحصّة اليوميّة: 100 رسالة/يوم لحساب Gmail عاديّ، و1500 لحساب Workspace.
     تجاوز الحصّة يُسجَّل خطأً صريحًا (لا فشل صامت).
   • CacheService قد يُفرِغ مفاتيحه مبكرًا تحت الضغط: منع التكرار هنا طبقة
     ثانية، والطبقة الأولى (والملزِمة) هي مفتاح التكرار في قاعدة البيانات.
   ════════════════════════════════════════════════════════════════════════════ */


/** المستلِم الاحتياطيّ حين لا تُمرَّر عناوين صريحة. عدّله إن لزم. */
var KIAN_PORTAL_FALLBACK_TO = "info@kianmedia.com";

/** اسم المُرسِل الظاهر للمستلِم. */
var KIAN_PORTAL_SENDER_NAME = "كيان الابتكار | Kian Media";

/** إصدار العقد المدعوم. يجب أن يطابق COMMS_CONTRACT_VERSION في lib/server/commsProvider.ts. */
var KIAN_PORTAL_CONTRACT_VERSION = 1;

/** نافذة صلاحيّة التوقيع بالمللي ثانية (±10 دقائق). */
var KIAN_PORTAL_SIGNATURE_WINDOW_MS = 10 * 60 * 1000;

/** مدّة تذكّر مفتاح منع التكرار (ثوانٍ) — 6 ساعات. */
var KIAN_PORTAL_IDEMPOTENCY_TTL_SEC = 6 * 60 * 60;

/** مفتاح ثابت غير سرّيّ لتلخيص النصّ داخل سلسلة التوقيع (مطابق للخادم). */
var KIAN_PORTAL_BODY_HASH_KEY = "kian.body";


/** قراءة خاصيّة سكربت — لا أسرار في الكود، فقط أسماء الخصائص. */
function kianProp_(name) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(name);
    return v === null || v === undefined ? "" : String(v).trim();
  } catch (e) {
    return "";
  }
}

/** تحويل مصفوفة بايتات إلى hex بأحرف صغيرة. */
function kianToHex_(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    var h = b.toString(16);
    out += h.length === 1 ? "0" + h : h;
  }
  return out;
}

function kianHmacHex_(message, key) {
  return kianToHex_(
    Utilities.computeHmacSha256Signature(
      Utilities.newBlob(message).getBytes(),
      Utilities.newBlob(key).getBytes()
    )
  );
}

/**
 * سلسلة التوقيع القانونيّة — نفس الترتيب والحقول تمامًا كما في
 * canonicalSigningString() داخل lib/server/commsProvider.ts. أيّ اختلاف في
 * الترتيب يعني فشل تحقّق دائم، لذلك لا تُعدَّل هذه الدالّة وحدها أبدًا.
 */
function kianCanonicalString_(data, signedAt) {
  var bodyHash = kianHmacHex_(
    String(data.Subject || "") + "\n" + String(data.Body || ""),
    KIAN_PORTAL_BODY_HASH_KEY
  );
  return [
    "v" + String(data.contract_version),
    String(data._type || ""),
    String(data.Event || ""),
    String(data.To || ""),
    String(data.IdempotencyKey || ""),
    String(data.CorrelationId || ""),
    String(signedAt || ""),
    bodyHash
  ].join("\n");
}

/** مقارنة ثابتة الزمن — لا تُسرِّب طول التطابق. */
function kianSafeEquals_(a, b) {
  var x = String(a || ""), y = String(b || "");
  if (x.length !== y.length) return false;
  var diff = 0;
  for (var i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/**
 * تحقّق التوقيع.
 * يُعيد: { mode: "signed"|"legacy_unsigned", ok: true }  أو  { ok:false, error }
 *
 * القاعدة:
 *   • حمولة تحمل contract_version (أي: من مركز الاتصالات) + مفتاح مضبوط ⇒ التوقيع إلزاميّ.
 *   • حمولة قديمة بلا contract_version ⇒ تُقبل ما لم يُفعَّل REQUIRE_SIGNATURE.
 *   • لا مفتاح مضبوط ⇒ وضع توافق غير موقَّع، ويُعلَن صراحةً في الردّ.
 */
function kianVerifySignature_(data) {
  var secret = kianProp_("KIAN_PORTAL_NOTIFY_SECRET");
  var requireSig = kianProp_("KIAN_PORTAL_NOTIFY_REQUIRE_SIGNATURE").toLowerCase() === "true";
  var hasVersion = data.contract_version !== undefined && data.contract_version !== null;
  var sig = String(data.Signature || "").trim();
  var signedAt = String(data.SignedAt || "").trim();

  if (!secret) {
    if (requireSig) return { ok: false, error: "relay_secret_not_configured" };
    return { ok: true, mode: "legacy_unsigned" };
  }

  if (!sig || !signedAt) {
    if (requireSig || hasVersion) return { ok: false, error: "signature_required" };
    return { ok: true, mode: "legacy_unsigned" };
  }

  if (hasVersion && Number(data.contract_version) !== KIAN_PORTAL_CONTRACT_VERSION) {
    return { ok: false, error: "unsupported_contract_version" };
  }

  var ts = Date.parse(signedAt);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > KIAN_PORTAL_SIGNATURE_WINDOW_MS) {
    return { ok: false, error: "signature_expired" };
  }

  var expected = kianHmacHex_(kianCanonicalString_(data, signedAt), secret);
  if (!kianSafeEquals_(expected, sig.toLowerCase())) return { ok: false, error: "bad_signature" };
  return { ok: true, mode: "signed" };
}


/**
 * معالج إشعارات البوابة.
 * يُعيد كائن نتيجة إذا كانت الرسالة من نوع portal_notify، وإلّا null (فيكمل
 * doPost مساره الطبيعيّ للنماذج: quote / meeting / upload).
 */
function kianHandlePortalNotify_(data) {
  if (!data || String(data._type || "") !== "portal_notify") return null;

  var result = {
    ok: true, handler: "portal_notify", sent: 0, failed: 0, recipients: 0,
    contract_version: KIAN_PORTAL_CONTRACT_VERSION
  };

  try {
    // ── 1) التحقّق قبل أيّ إرسال ──
    var v = kianVerifySignature_(data);
    if (!v.ok) {
      result.ok = false;
      result.error = v.error;
      return result;   // ردّ صريح: رفض، وليس صمتًا ولا نجاحًا كاذبًا
    }
    result.mode = v.mode;

    // ── 2) منع التكرار: نفس المفتاح خلال 6 ساعات ⇒ أعِد النتيجة السابقة ──
    var idem = String(data.IdempotencyKey || "").trim();
    var cache = null;
    var cacheKey = "";
    if (idem) {
      try {
        cache = CacheService.getScriptCache();
        cacheKey = "kian_notify_" + Utilities.base64EncodeWebSafe(idem).slice(0, 200);
        var prior = cache.get(cacheKey);
        if (prior) {
          var replay = JSON.parse(prior);
          replay.duplicate = true;
          replay.handler = "portal_notify";
          return replay;   // نفس الإقرار السابق ⇒ لا بريد ثانٍ
        }
      } catch (eCache) {
        cache = null;   // الذاكرة المؤقّتة ليست شرطًا للإرسال
      }
    }

    // ── 3) المستلِمون ──
    var raw = String(data.To || data.to || "").trim();
    if (!raw) raw = KIAN_PORTAL_FALLBACK_TO;
    var list = raw.split(/[,;]+/)
      .map(function (x) { return String(x).trim().toLowerCase(); })
      .filter(function (x) { return x.indexOf("@") > 0; });

    var seen = {}, to = [];
    for (var i = 0; i < list.length; i++) {
      if (!seen[list[i]]) { seen[list[i]] = true; to.push(list[i]); }
    }
    result.recipients = to.length;
    if (to.length === 0) {
      result.ok = false;
      result.error = "no_valid_recipients";
      return result;
    }

    // ── 4) الموضوع والنصّ ──
    var subject = String(data.Subject || data.subject || "تحديث من منصّة كيان").trim();
    if (String(data.Urgent || "") === "URGENT") subject = "🔴 عاجل — " + subject;

    var lines = [];
    var main = String(data.Body || data.Message || "").trim();
    if (main) lines.push(main);

    var record = String(data.Record || "").trim();
    if (record) lines.push("السجلّ: " + record);

    var party = String(data.Party || "").trim();
    if (party) lines.push("الطرف: " + party);

    var ev = String(data.Event || "").trim();
    if (ev) lines.push("نوع الحدث: " + ev);

    var link = String(data.Link || "").trim();
    if (link) lines.push("", "افتح البوابة: " + link);

    lines.push("", "—", "هذه رسالة آليّة من منصّة كيان الابتكار.");
    var body = lines.join("\n");

    // ── 5) إرسال منفصل لكلّ مستلِم ──
    for (var j = 0; j < to.length; j++) {
      try {
        MailApp.sendEmail({
          to: to[j],
          subject: subject,
          body: body,
          name: KIAN_PORTAL_SENDER_NAME
        });
        result.sent++;
      } catch (errOne) {
        result.failed++;
        if (!result.error) result.error = String(errOne).slice(0, 180);
      }
    }

    // نجاح حقيقيّ فقط إذا وصلت رسالة واحدة على الأقلّ إلى المزوّد.
    if (result.sent === 0) result.ok = false;

    // ── 6) خزِّن الإقرار حتى لا يُرسَل نفس الحدث مرّتين عند إعادة المحاولة ──
    if (cache && cacheKey && result.sent > 0) {
      try { cache.put(cacheKey, JSON.stringify(result), KIAN_PORTAL_IDEMPOTENCY_TTL_SEC); } catch (ePut) { /* اختياريّ */ }
    }
    return result;

  } catch (err) {
    return {
      ok: false, handler: "portal_notify", sent: 0, failed: 0,
      error: String(err).slice(0, 180)
    };
  }
}


/** ردّ JSON — يسمح للموقع بتمييز النجاح الحقيقيّ من الصمت. */
function kianJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ════════════════════════════════════════════════════════════════════════════
   اختبارات سريعة داخل محرّر Apps Script (اختياريّة)
   ════════════════════════════════════════════════════════════════════════════ */

/** يُرسل بريدًا حقيقيًّا إلى العنوان الاحتياطيّ. شغّله بعد النشر للتأكّد. */
function kianTestPortalNotify_() {
  var out = kianHandlePortalNotify_({
    _type: "portal_notify",
    To: KIAN_PORTAL_FALLBACK_TO,
    Subject: "اختبار قناة إشعارات البوابة — كيان",
    Event: "diagnostic.self_test",
    Body: "إن وصلتك هذه الرسالة فقناة بريد البوابة تعمل بشكل صحيح.",
    Link: "https://www.kianmedia.com/client-portal"
  });
  Logger.log(JSON.stringify(out));
}

/**
 * لا يُرسل بريدًا: يتحقّق فقط من أنّ سلسلة التوقيع تُبنى كما يبنيها الخادم.
 * قارِن الناتج مع ما يعرضه مركز الاتصالات في «معاينة حمولة المُرحِّل».
 */
function kianTestCanonicalString_() {
  var sample = {
    _type: "portal_notify",
    contract_version: KIAN_PORTAL_CONTRACT_VERSION,
    Event: "comms.self_test",
    To: "someone@example.com",
    IdempotencyKey: "comms.self_test:-:00000000-0000-0000-0000-000000000000:email",
    CorrelationId: "00000000-0000-0000-0000-000000000000",
    Subject: "اختبار",
    Body: "نصّ الاختبار"
  };
  Logger.log(kianCanonicalString_(sample, "2026-01-01T00:00:00.000Z"));
}
