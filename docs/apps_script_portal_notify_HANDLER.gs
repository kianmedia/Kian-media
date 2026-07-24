/* ════════════════════════════════════════════════════════════════════════════
   KIAN — Google Apps Script: PORTAL NOTIFY HANDLER   (تطبيق يدويّ — إلزاميّ)
   ════════════════════════════════════════════════════════════════════════════

   ★★ هذا هو سبب عدم وصول أيّ بريد من البوابة. اقرأ هذه الفقرة كاملة. ★★

   بريد كيان يُرسَل من سكربت Google هذا (هو وحده يملك صلاحية الإرسال — لا توجد
   مفاتيح بريد داخل الموقع إطلاقًا). السكربت الحاليّ يحتوي على السطر:

       if (String(data._type || "") !== "quote") return;   // quotes only

   أي أنّه يُرسل بريدًا لطلبات عروض الأسعار فقط. وكلّ إشعارات البوابة — المشاريع،
   الأصول والعهدة، التأجير، الموارد البشرية — تُرسَل بالنوع "portal_notify"، فيخرج
   السكربت فورًا ولا يُرسل شيئًا... ثمّ يردّ HTTP 200 وكأنّ كلّ شيء تمام.

   لذلك: الموقع كان يُسجِّل الرسائل كـ«أُرسلت» بينما لم يُرسَل بريد قط. وهذا يفسّر
   لماذا فشلت كلّ محاولات الإصلاح السابقة (الطابور والعامل والمُحلِّل كانوا سليمين —
   المشكلة في القفزة الأخيرة وحدها).

   الحلّ = لصق هذا الملفّ في مشروع Apps Script، وإضافة 3 أسطر إلى doPost.
   بعدها يعمل البريد لكلّ الوحدات ولكلّ المستلِمين (مالك/سوبر أدمن/أدمن/مدير/
   أمين عهدة/مالية/عميل/مستأجر/موظف) فورًا وبدون أيّ تغيير آخر.

   ─────────────────────────────────────────────────────────────────────────────
   خطوات التطبيق (دقيقتان)
   ─────────────────────────────────────────────────────────────────────────────
   1) افتح  script.google.com  ← المشروع الذي يملك رابط الـWeb App المستخدم
      في الموقع (نفس رابط /exec).
   2) الصق محتوى هذا الملفّ كاملًا في نهاية ملفّ الكود (Code.gs) — إضافة فقط،
      لا تحذف أيّ شيء موجود.
   3) في دالّة doPost الموجودة لديك، أضِف الأسطر الثلاثة المعلَّمة أدناه في
      *أوّل* الدالّة مباشرة بعد قراءة البيانات:

        function doPost(e) {
          var data = JSON.parse(e.postData.contents);

          // ▼▼▼ أضِف هذه الأسطر الثلاثة ▼▼▼
          var portal = kianHandlePortalNotify_(data);
          if (portal) return kianJson_(portal);
          // ▲▲▲ نهاية الإضافة ▲▲▲

          // ...بقيّة الكود الحاليّ كما هو (كتابة الصفّ في الجدول + بريد عروض الأسعار)...
        }

      ملاحظة: وضعُها في الأوّل مقصود — إشعارات البوابة لا يجب أن تُكتب في جدول
      طلبات عروض الأسعار.

   4) Deploy ← Manage deployments ← عدّل النشر الحاليّ ← Version: New version
      ← Deploy.  (مهمّ: بدون نشر نسخة جديدة يبقى الكود القديم يعمل.)
      تأكّد أنّ الإعداد: Execute as = Me،  Who has access = Anyone.

   5) للتأكّد: من لوحة «مراقبة الإشعارات» في البوابة اضغط «فحص قناة البريد».
      يجب أن تظهر النتيجة: القناة تعمل ✓ (handler: portal_notify).

   ─────────────────────────────────────────────────────────────────────────────
   الأمان
   ─────────────────────────────────────────────────────────────────────────────
   • إضافيّ بالكامل: لا يمسّ منطق quote/meeting/upload الحاليّ العامل.
   • كلّ شيء داخل try/catch: خطأ البريد لا يُفشِل كتابة الجدول أبدًا.
   • يُرسل رسالة منفصلة لكلّ مستلِم (لا يكشف عناوين المستلِمين لبعضهم).
   • يردّ JSON صريحًا، فيستطيع الموقع تمييز «وصلت فعلًا» من «السكربت لم يفهمها»
     بدل الافتراض الخاطئ بالنجاح.
   • حصّة الإرسال اليوميّة: 100 رسالة/يوم لحساب Gmail عاديّ، و1500 لحساب
     Google Workspace. تجاوز الحصّة يُسجَّل كخطأ صريح (لا فشل صامت).
   ════════════════════════════════════════════════════════════════════════════ */


/** المستلِمون الاحتياطيّون حين لا يُمرِّر الموقع عنوانًا صريحًا. عدّلهم إن لزم. */
var KIAN_PORTAL_FALLBACK_TO = "info@kianmedia.com";

/** اسم المُرسِل الظاهر للمستلِم. */
var KIAN_PORTAL_SENDER_NAME = "كيان الابتكار | Kian Media";


/**
 * معالج إشعارات البوابة.
 * يُعيد كائن نتيجة إذا كانت الرسالة من نوع portal_notify، وإلّا يُعيد null
 * (فيكمل doPost مساره الطبيعيّ للنماذج: quote / meeting / upload).
 */
function kianHandlePortalNotify_(data) {
  if (!data || String(data._type || "") !== "portal_notify") return null;

  var result = { ok: true, handler: "portal_notify", sent: 0, failed: 0, recipients: 0 };
  try {
    // ── المستلِمون: الحقل To (مفصول بفواصل) وإلّا الاحتياطيّ ──
    var raw = String(data.To || data.to || "").trim();
    if (!raw) raw = KIAN_PORTAL_FALLBACK_TO;
    var list = raw.split(/[,;]+/)
      .map(function (x) { return String(x).trim().toLowerCase(); })
      .filter(function (x) { return x.indexOf("@") > 0; });

    // إزالة التكرار
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

    // ── الموضوع ──
    var subject = String(data.Subject || data.subject || "تحديث من منصّة كيان").trim();
    if (String(data.Urgent || "") === "URGENT") subject = "🔴 عاجل — " + subject;

    // ── النصّ: يدعم شكل المشاريع (Body) وشكل الموارد البشرية (Message/Record/Party) ──
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

    // ── إرسال منفصل لكلّ مستلِم (لا كشف للعناوين بين المستلِمين) ──
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
    return result;

  } catch (err) {
    return { ok: false, handler: "portal_notify", sent: 0, failed: 0, error: String(err).slice(0, 180) };
  }
}


/** ردّ JSON — يسمح للموقع بتمييز النجاح الحقيقيّ من الصمت. */
function kianJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ════════════════════════════════════════════════════════════════════════════
   اختبار سريع داخل محرّر Apps Script (اختياريّ):
   شغّل الدالّة kianTestPortalNotify_ ثمّ راجع بريدك.
   ════════════════════════════════════════════════════════════════════════════ */
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
