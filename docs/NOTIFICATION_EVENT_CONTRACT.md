# عقد أحداث الإشعارات — النسخة النهائية (Kian Project Platform)

> هذه الوثيقة هي **المرجع الوحيد** لأي إشعار في منصّة المشاريع. أي عمل مستقبليّ على
> الإشعارات — بما في ذلك ربط Google Apps Script — يلتزم بها ولا يُنشئ نظامًا موازيًا.
> Contract version: **v1** (الحقل `contract_version` في الحمولة).

---

## ١) البنية المعتمدة (لا يوجد غيرها)

```
حدث أعمال (صفّ يُكتب / قرار يُتخذ)
   │  ← الإجراء يُحفظ أولًا ويُثبَّت. الإشعار أثر جانبيّ بعده. فشله لا يُلغيه أبدًا.
   ▼
notification_resolve_recipients(event, entity_type, entity_id, project, actor, payload)
   │     → مستلِمون فعليّون: user_id · email · role · recipient_reason ·
   │       portal_allowed · email_allowed · action_url · locale · dedupe_key
   ├──────────► notification_dispatch_portal(...)  →  public.notifications        (صندوق البوابة)
   │                                                →  notification_delivery_log  (تتبّع: portal_created)
   └──────────► notify_emit_event(...)             →  public.email_deliveries     (الطابور الوحيد)
                                                        idempotency_key = dedupe_key
                                                        correlation_id  = معرّف الحدث
                          │
                          ▼
              processQueue({ deliveryIds })   ← فوريّ داخل نفس الطلب (مربوط بالحدث)
                          │                    ← cron = إعادة محاولة/تعافٍ فقط
                          ▼
              sendProjectEmail → مُرحِّل واحد (Apps Script)
                          │  يشترط إقرارًا موسومًا handler:"portal_notify" + عدد المُرسَل
                          ▼
              email_deliveries.status ∈ pending|processing|sent|failed|skipped|bounced
              notification_delivery_log (email_sent / email_failed + lifecycle)
```

**ممنوع:** جدول إشعارات ثالث · طابور بريد ثانٍ · مزوّد بريد موازٍ · cron لكلّ وحدة · إرسال جماعيّ.

| الغرض | الكائن المعتمد |
|---|---|
| صندوق البوابة | `public.notifications` |
| صندوق الأحداث | `public.notification_events` |
| طابور البريد (الوحيد) | `public.email_deliveries` |
| سجلّ التتبّع | `public.notification_delivery_log` |
| التفضيلات | `public.notification_preferences` |
| تشغيل الـcron | `public.notification_cron_runs` |
| مُحلِّل المستلِمين (الوحيد) | `notification_resolve_recipients(...)` |
| الإدراج المركزيّ | `notify_emit_event(...)` |
| مُرسِل الطبقة TS | `lib/server/notifyEvent.ts` → `emitEventEmail()` |
| العامل | `lib/server/notifyWorker.ts` → `processQueue()` |
| المزوّد | `lib/server/projectNotify.ts` → `sendProjectEmail()` |

---

## ٢) قانون عزل الإجراء عن الإشعار (إلزاميّ في كلّ وحدة)

1. تحقّق من الصلاحية.
2. احفظ صفّ الأعمال في **خطوة مثبَّتة مستقلّة**.
3. بعد التثبيت فقط، حاول الإشعار **best-effort**.
4. أي فشل (تحليل/إدراج/مزوّد/عامل) يُلتقط ويُسجَّل ويُعرض للإدارة — **ولا يُلغي الإجراء**.
5. HTTP ناجح (200/207) متى حُفظ الإجراء؛ 4xx/5xx **فقط** إذا فشل الإجراء نفسه.

المرجع التنفيذيّ: `app/api/integrations/project/review/route.ts` (STEP A حفظ → STEP B إشعار).

---

## ٣) تسمية الأحداث

الصيغة: `<domain>.<action>` بحروف صغيرة و`snake_case`. الميدان لمنصّة المشاريع:
`project` · `deliverable` · `task` · `session` · `change_request` · `risk` · `issue`.

### كتالوج أحداث منصّة المشاريع

| اسم الحدث | entity_type | الجمهور الافتراضيّ | إلزاميّ للإدارة |
|---|---|---|---|
| `project.created` | project | إدارة + مدير المشروع | نعم |
| `project.status_changed` | project | إدارة + مدير المشروع (+ العميل عند المراحل المواجِهة له) | نعم |
| `project.on_hold` | project | إدارة + مدير المشروع | نعم |
| `project.resumed` | project | إدارة + مدير المشروع | نعم |
| `project.closed` | project | إدارة + مدير المشروع | نعم |
| `project.member_assigned` | project | المكلَّف + إدارة + مدير المشروع | نعم |
| `project.member_removed` | project | المُزال + إدارة + مدير المشروع | نعم |
| `project.delivery_recorded` | project | إدارة + مدير المشروع + **العميل** | نعم |
| `session.created` | session | فريق الجلسة + مدير المشروع | لا |
| `session.updated` | session | فريق الجلسة + مدير المشروع | لا |
| `session.cancelled` | session | فريق الجلسة + مدير المشروع + إدارة | نعم |
| `task.due_soon` | task | المكلَّف (+ مدير المشروع) | لا |
| `task.overdue` | task | المكلَّف + مدير المشروع + إدارة | نعم |
| `deliverable.uploaded` | deliverable | إدارة + مدير المشروع | لا |
| `deliverable.internal_review_requested` | deliverable | المراجع الداخليّ + مدير المشروع | لا |
| `deliverable.preview_sent` | deliverable | إدارة + مدير المشروع + **العميل** | نعم |
| `deliverable.client_commented` | deliverable | إدارة + مدير المشروع + المكلَّف | نعم |
| `deliverable.revision_requested` | deliverable | إدارة + مدير المشروع + المكلَّف | نعم |
| `deliverable.comment_resolved` | deliverable | مدير المشروع (+ العميل صاحب التعليق) | لا |
| `deliverable.version_created` | deliverable | إدارة + مدير المشروع | لا |
| `deliverable.approved` | deliverable | إدارة + مدير المشروع + المكلَّف | نعم |
| `deliverable.rejected` | deliverable | إدارة + مدير المشروع + المكلَّف | نعم |
| `deliverable.final_ready` | deliverable | إدارة + مدير المشروع + **العميل** | نعم |
| `deliverable.download_recorded` | deliverable | إدارة + مدير المشروع (**لا العميل**) | نعم |
| `change_request.created` | change_request | إدارة + مدير المشروع | نعم |
| `change_request.client_pending` | change_request | **العميل** + مدير المشروع | نعم |
| `change_request.approved` | change_request | إدارة + مدير المشروع (+ العميل) | نعم |
| `change_request.rejected` | change_request | إدارة + مدير المشروع (+ العميل) | نعم |
| `risk.critical_raised` | risk | إدارة + مدير المشروع (**داخليّ فقط**) | نعم |
| `issue.critical_raised` | issue | إدارة + مدير المشروع (**داخليّ فقط**) | نعم |

**قاعدة الرؤية:** العميل يستقبل فقط الأحداث المعلَّمة أعلاه صراحةً بـ«العميل».
المخاطر والمشكلات والتكاليف وسجلّ التدقيق **لا تصل العميل إطلاقًا**.

---

## ٤) مخطّط الحمولة (Payload Schema)

```jsonc
{
  "contract_version": 1,
  "event": "deliverable.approved",          // من الكتالوج أعلاه — مغلق، لا قيم حرّة
  "entity_type": "deliverable",
  "entity_id": "<uuid>",
  "project_id": "<uuid|null>",
  "actor_id": "<uuid|null>",                // من نفّذ الإجراء
  "correlation_id": "<uuid>",               // يربط كلّ مستلِمي الحدث الواحد
  "occurred_at": "<ISO-8601>",
  "subject": "<نصّ عنوان البريد>",
  "body": "<نصّ عربيّ بلا أرقام ماليّة للعميل>",
  "action_url": "/client-portal/project-core/<projectId>?tab=deliverables",
  "audience": "staff | client | all",
  "severity": "info | warning | critical",
  "recipients": [                            // ناتج المُحلِّل المركزيّ — لا يُبنى يدويًّا
    {
      "user_id": "<uuid>",
      "email": "<resolved from auth.users, fallback profiles>",
      "role": "management | project_manager | client | assignee | finance",
      "recipient_reason": "<لماذا استحقّ الإشعار>",
      "portal_allowed": true,
      "email_allowed": true,
      "locale": "ar",
      "dedupe_key": "<event>:<entity_id>:<user_id>"
    }
  ]
}
```

**قواعد ثابتة**
- `recipient_id` لا يكون `NULL` أبدًا لصفّ بريد (كان سببًا تاريخيًّا لسقوط الرسائل).
- البريد يُقرأ من `auth.users` أوّلًا ثمّ `profiles.email` (بريد الإدارة كثيرًا ما يكون فارغًا في `profiles`).
- `subject` إلزاميّ وغير فارغ (`notify_emit_event` يرفض الفارغ بـ`subject_required`).
- **مرّر `entity_id` مميِّزًا دائمًا**: حدث بلا كيان يتقاسم مفتاح إزالة التكرار نفسه فيُكبَح بعد المرّة الأولى.

---

## ٥) إزالة التكرار والـIdempotency

- `dedupe_key = "<event>:<entity_id>:<user_id>"` ← يُكتب في `email_deliveries.idempotency_key`.
- فهرس فريد **جزئيّ**: `uq_edel_idem on email_deliveries(idempotency_key) where idempotency_key is not null`.
- الإدراج يستخدم:
  ```sql
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  ```
  ⚠️ **إعادة ذكر شرط الفهرس الجزئيّ إلزاميّة** — بدونها يقع الخطأ `42P10` ويُجهض الإجراء كلّه.
- الأثر: إعادة تنفيذ الحدث نفسه (Retry / ضغط مزدوج) **لا تُنشئ رسالة ثانية**؛ الصفّ المُرسَل
  سابقًا يُعاد بنتيجة `already_sent` وتُحتسب نجاحًا لا إرسالًا جديدًا.

---

## ٦) إعادة المحاولة والفشل

| الحالة | المعنى | إعادة المحاولة |
|---|---|---|
| `pending` | في الطابور، مستحقّ عند `next_attempt_at` | نعم |
| `processing` | مُلتقط بعقد إيجار (lease) — يمنع الإرسال المزدوج | يستعيده الـreaper عند انتهاء الإيجار |
| `sent` | تأكيد إيجابيّ من المُرحِّل | نهائيّ |
| `failed` | استُنفدت المحاولات (dead-letter) | يدويّ فقط |
| `skipped` | لا بريد / مكرّر مكبوح / متراكم منتهٍ | لا |
| `bounced` | ارتداد (محجوز لـwebhook مستقبليّ) | لا |

- التراجع الأسّي: `5 × 2^attempts` دقيقة. `MAX_ATTEMPTS = 5` ثمّ dead-letter.
- **أعطال القناة** (`disabled` / `no_endpoint` / `relay_handler_missing`) تُعامَل على مستوى
  القناة: الصفّ يبقى `pending`، **لا تُستهلك محاولة ولا يُدفن** — فلا تُفقد رسالة ولا تتكرّر،
  ويتعافى الطابور تلقائيًّا بعد إصلاح القناة.
- كلّ محاولة تُسجَّل: `attempts` · `last_error` · `next_attempt_at` · `provider_message_id`.

---

## ٧) التفضيلات والصلاحية

- **الصلاحية ≠ التفضيل.** المُحلِّل يُقرّر *مَن يستحقّ*؛ التفضيلات تُقرّر *كيف يُبلَّغ*.
- الأحداث المعلَّمة «إلزاميّ للإدارة» **لا تُحجب** بتفضيل مستخدم.
- التفضيلات تُطبَّق على غير الإلزاميّ عبر `portal_allowed` / `email_allowed`.
- العميل لا يُضاف أبدًا لحدث غير معلَّم بـ«العميل» مهما كانت تفضيلاته.

---

## ٨) الروابط العميقة (Deep Links)

| الكيان | الرابط |
|---|---|
| مشروع | `/client-portal/project-core/<projectId>` |
| مخرَج | `/client-portal/project-core/<projectId>?tab=deliverables` |
| مهمّة | `/client-portal/project-core/<projectId>?tab=tasks` |
| جلسة | `/client-portal/project-core/<projectId>?tab=shoots` |
| طلب تغيير | `/client-portal/project-core/<projectId>?tab=governance` |
| عرض العميل | `/client-portal/projects/<projectId>` |

الأساس المطلق من `PORTAL_PUBLIC_URL` (افتراضيًّا `https://www.kianmedia.com`).

---

## ٩) مواصفات ربط Google Apps Script (للتنفيذ لاحقًا — ليست تبعيّة)

الحالة الحاليّة: مشروع أُنشئ ونُسخ فيه كود أوّليّ فقط — **لم يُنشر كـWeb App، ولا Triggers،
ولا هو في الإنتاج**. المنصّة **لا تعتمد عليه**: البنية الداخليّة (صندوق البوابة + الطابور +
التتبّع + إعادة المحاولة) مكتملة، والبريد وحده هو ما ينتظر هذا الربط.

**الدالّة المطلوبة داخله**
- `kianHandlePortalNotify_(data)` — تُعيد `null` لأي `_type` غير `portal_notify` (فلا تمسّ
  مسار `quote`/`meeting`/`upload` العامل)، وتُرسل رسالة منفصلة لكلّ مستلِم من الحقل `To`.
- `kianJson_(obj)` — تُعيد الردّ بصيغة JSON.
- المصدر الجاهز للّصق: `docs/apps_script_portal_notify_HANDLER.gs`.

**شكل الطلب الوارد**
```jsonc
{ "_type": "portal_notify", "To": "a@x.com,b@y.com", "Subject": "...",
  "Event": "deliverable.approved", "Body": "...", "Link": "https://..." }
```

**شكل الردّ المطلوب (إلزاميّ — وإلّا يُعتبر غير مُسلَّم)**
```json
{ "ok": true, "handler": "portal_notify", "sent": 2, "failed": 0, "recipients": 2 }
```
الموقع **يرفض** أي ردّ غير موسوم: الردّ المبهم أو `{"ok":true}` العامّ يُسجَّل
`relay_handler_missing` ولا يُعتبر تسليمًا. هذا ما يمنع تكرار عطل «نجاح كاذب».

**التحقّق من الطلب** — الحاليّ: رابط `/exec` سرّيّ + `Execute as: Me` + `Who has access: Anyone`.
للتقوية لاحقًا (اختياريّ): حقل `Token` في الحمولة يُقارَن بـScript Property.

**Script Properties المطلوبة (أسماء فقط — لا قيم)**
- `KIAN_PORTAL_FALLBACK_TO` — المستلِم الاحتياطيّ حين يكون `To` فارغًا.
- `KIAN_PORTAL_SHARED_TOKEN` — اختياريّ، للتحقّق المشدَّد لاحقًا.

**النشر**: Deploy → Manage deployments → **New version** (بدون نسخة جديدة يبقى القديم يعمل).
**Triggers**: **غير مطلوبة** — الاستدعاء بالطلب (request-driven)؛ لا وظائف زمنيّة في السكربت.
**متغيّرات Vercel**: `PORTAL_NOTIFY_ENDPOINT` (اختياريّ — يتفوّق على الرابط الثابت)،
`PROJECT_EMAIL_ALERTS_ENABLED` (يجب ألّا تساوي `"false"`)، `SUPABASE_SERVICE_ROLE_KEY`، `CRON_SECRET`.

**اختبار الاتصال**: لوحة مراقبة الإشعارات ← «اختبار إشعار لحسابي» — تُسمّي العائق نصًّا.
**اختبار الفشل**: انشر نسخة بلا المعالج ⇒ يجب أن تظهر `relay_handler_missing` وتبقى الرسائل
`pending` بلا استهلاك محاولات. **اختبار عدم التكرار**: نفّذ الإجراء نفسه مرّتين ⇒ صفّ بريد واحد
و`already_sent` في الثانية.

**حصّة الإرسال**: ١٠٠ رسالة/يوم لحساب Gmail عاديّ · ١٥٠٠ لحساب Workspace.

---

## ١٠) ما يجب ألّا يحدث أبدًا

- تشغيل مصدرَين يرسلان الإشعار نفسه (Apps Script + مزوّد آخر + cron).
- اعتبار HTTP 200 دليل تسليم.
- إرسال جماعيّ للمتراكم القديم.
- تعطيل إجراء أعمال بسبب فشل بريد.
- إظهار `correlation_id` أو أي معرّف داخليّ للعميل.
- إدراج صفّ بريد بلا `recipient_id`.
