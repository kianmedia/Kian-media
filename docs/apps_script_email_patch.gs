/* ════════════════════════════════════════════════════════════════════════
   KIAN — Google Apps Script email-notification patch (MANUAL APPLY)
   ════════════════════════════════════════════════════════════════════════
   WHY: The portal quote form now sends the EXACT same payload shape as the
   main-site hero form to the same Apps Script Web App (SHEETS_ENDPOINT).
   If Kian still doesn't receive an email for portal submissions, the email
   logic lives in the Apps Script (NOT in this repo) and must be ensured there.

   This file is NOT executed by the website. Paste it into the Apps Script
   project that owns SHEETS_ENDPOINT (script.google.com → your project), then
   call sendKianNotification_(data) inside doPost after you parse the body.

   Handles: Source = "client-portal" (and "website" for the hero) and
   Reference = "QR-YYYY-######".
   ════════════════════════════════════════════════════════════════════════ */

// 1) Set recipients (comma-separated):
var KIAN_NOTIFY_TO = "info@kianmedia.com,sales@kianmedia.com";

// 2) In your existing doPost(e), after you JSON.parse the body and append the
//    row to the Sheet, add ONE line:
//
//      var data = JSON.parse(e.postData.contents);
//      // ...your existing sheet-append code...
//      sendKianNotification_(data);   // <-- ADD THIS
//
//    (Email failure is swallowed below, so it can never break the sheet write.)

function sendKianNotification_(data) {
  try {
    if (String(data._type || "") !== "quote") return; // quotes only

    var f = function (k) { return (data[k] != null && String(data[k]).length) ? String(data[k]) : "—"; };
    var ref    = f("Reference");
    var source = f("Source"); // "client-portal" or "website"
    var email  = data["Email"] ? String(data["Email"]) : "";

    var subject = "طلب عرض سعر جديد (" + (source === "client-portal" ? "بوابة العملاء" : "الموقع") + ") — " + ref;

    var body =
      "وصل طلب عرض سعر جديد — المصدر: " + source + "\n\n" +
      "رقم الطلب (Reference): " + ref + "\n" +
      "الاسم (Full Name): "    + f("Full Name") + "\n" +
      "الشركة (Company): "     + f("Company") + "\n" +
      "الجوال (Mobile): "      + f("Mobile") + "\n" +
      "البريد (Email): "       + f("Email") + "\n" +
      "المدينة (City): "       + f("City") + "\n" +
      "الخدمات (Services): "   + f("Service Type") + "\n" +
      "الميزانية (Budget): "   + f("Budget") + "\n" +
      "التاريخ المفضل (Delivery Date): " + f("Delivery Date") + "\n" +
      "اللغة (Language): "     + f("Language") + "\n\n" +
      "الوصف (Description):\n" + f("Description") + "\n";

    var options = {};
    if (email.indexOf("@") > -1) options.replyTo = email; // reply goes to the client

    MailApp.sendEmail(KIAN_NOTIFY_TO, subject, body, options);
  } catch (err) {
    // Never let an email error break the submission / sheet write.
  }
}

/* Alternative (HTML email): replace MailApp.sendEmail(...) with
   GmailApp.sendEmail(KIAN_NOTIFY_TO, subject, body, { htmlBody: "...", replyTo: email });
   ──────────────────────────────────────────────────────────────────────── */
