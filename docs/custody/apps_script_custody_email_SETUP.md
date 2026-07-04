# تفعيل إيميلات العهدة والتأجير — معالج Apps Script (لصق جاهز)

البوابة تُرسل الآن تلقائيًا حمولة `_type: "portal_notify"` إلى **نفس Google Apps Script
الموجود** (الذي يستقبل نماذج الموقع — `SHEETS_ENDPOINT` / `PORTAL_NOTIFY_ENDPOINT`).
حتى يصل الإيميل فعليًا، أضف المعالج التالي داخل سكربت Google Apps Script.

## الخطوات (٣ دقائق)
1. افتح [script.google.com](https://script.google.com) → مشروع السكربت المرتبط بنماذج كيان.
2. في دالة `doPost(e)` الموجودة، أضف هذا المقطع **في أول الدالة** (قبل معالجة النماذج):

```javascript
// ─── بوابة كيان: إشعارات العهدة والتأجير (والبوابة عموماً) بالإيميل ───
try {
  var _pn = JSON.parse(e.postData.contents);
  if (_pn && _pn._type === 'portal_notify') {
    var to = (_pn.To && String(_pn.To).indexOf('@') > -1)
      ? String(_pn.To)
      : 'kianalebtikar@gmail.com'; // البريد الاحتياطي إن لم تُمرَّر عناوين
    var subject = _pn.Subject || 'تنبيه بوابة كيان';
    var rows = '';
    var skip = { _type: true, To: true, Subject: true };
    for (var k in _pn) {
      if (skip[k] || !_pn[k]) continue;
      rows += '<tr><td style="padding:6px 10px;color:#666;white-space:nowrap">' + k +
              '</td><td style="padding:6px 10px;color:#111"><b>' + _pn[k] + '</b></td></tr>';
    }
    var html =
      '<div dir="rtl" style="font-family:Tahoma,Arial;max-width:560px;margin:auto;' +
      'border:1px solid #eee;border-radius:10px;overflow:hidden">' +
      '<div style="background:#A51419;color:#fff;padding:14px 18px;font-size:16px;font-weight:bold">' +
      subject + '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' + rows + '</table>' +
      (_pn.Link ? '<div style="padding:14px 18px"><a href="' + _pn.Link +
        '" style="background:#A51419;color:#fff;text-decoration:none;padding:10px 22px;' +
        'border-radius:8px;display:inline-block">فتح البوابة</a></div>' : '') +
      '<div style="padding:10px 18px;color:#999;font-size:11px">كيان ميديا — إشعار آلي</div></div>';
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: 'Kian Portal' });
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }
} catch (err) { /* ليست حمولة إشعار — أكمل لمعالجة النماذج كالمعتاد */ }
```

3. **Deploy → Manage deployments → Edit → New version → Deploy** (نفس الرابط يبقى كما هو).

## ماذا يصل بعدها؟
- **لكل حركة عهدة/تأجير** (خروج عدة، طلب تأجير، إرجاع، بلاغ نقص/تلف، اعتماد تسليم،
  إقفال، رفض، ملاحظة، مطالبة مالية، توقيع تعهد السداد):
  إيميل إلى **حسابات الأدمن + المالك + المدير + أمين العهدة + صاحب السجل** (المستلم/المستأجر).
- العنوان بالعربية حسب الحدث (مثل: «⚠ بلاغ نقص/تلف في إرجاع عهدة — كيان»).

## ملاحظات
- الإرسال من جهة البوابة **مفعّل افتراضيًا** — للإيقاف: أضف في Vercel
  `CUSTODY_EMAIL_ALERTS_ENABLED=false`.
- لتغيير نقطة الاستقبال بدون المساس بسكربت النماذج: أنشئ سكربت مستقلًا بنفس
  المعالج وضع رابطه في env: `PORTAL_NOTIFY_ENDPOINT`.
- إشعارات الواتساب تُفعَّل لاحقًا مع مرحلة الإشعارات (n8n) — بلا تغيير كود.
