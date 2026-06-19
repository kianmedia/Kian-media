# Kian — WhatsApp message templates (for Meta approval)

WhatsApp **requires an approved template** to message a number outside the 24-hour
customer-service window (i.e. any new number, and staff alert numbers). Submit each
template in **Meta Business Manager → WhatsApp Manager → Message templates** with the
exact **name**, **language = `ar`**, **category**, and **body** below. Variables are
positional (`{{1}}`, `{{2}}`, …) — keep the order.

> Nothing here sends anything. Real template sends stay gated behind
> `WHATSAPP_TEMPLATE_SEND_ENABLED` / `WHATSAPP_INTERNAL_ALERTS_ENABLED` + an allowlist.

---

## Start-new-conversation templates (Part 3)

### 1. `welcome_followup_ar`  — category: MARKETING
```
مرحبًا {{1}} 👋، شكرًا لتواصلك مع كيان ميديا.
يسعدنا خدمتك في {{2}}. هل ترغب أن نكمل معك التفاصيل ونجهّز لك عرضًا مناسبًا؟
```
Variables: 1 = customer name · 2 = service/topic.

### 2. `quote_followup_ar`  — category: MARKETING
```
مرحبًا {{1}}، بخصوص طلبك لعرض سعر {{2}} مع كيان ميديا —
لإكمال العرض نحتاج بعض التفاصيل. يمكنك تعبئتها من هنا: {{3}}
```
Variables: 1 = name · 2 = service · 3 = quote-request link.

### 3. `appointment_confirmation_ar`  — category: UTILITY
```
مرحبًا {{1}}، نؤكد موعد {{2}} يوم {{3}} الساعة {{4}}.
لأي تعديل يرجى الرد على هذه الرسالة. — كيان ميديا
```
Variables: 1 = name · 2 = service/event · 3 = date · 4 = time.

### 4. `invoice_followup_ar`  — category: UTILITY
```
مرحبًا {{1}}، بخصوص الفاتورة رقم {{2}} بمبلغ {{3}} —
لأي استفسار حول الدفع يسعدنا مساعدتك. — كيان ميديا (المالية)
```
Variables: 1 = name · 2 = invoice number · 3 = amount.

### 5. `hr_followup_ar`  — category: UTILITY
```
مرحبًا {{1}}، شكرًا لاهتمامك بالانضمام/التعاون مع كيان ميديا بخصوص {{2}}.
سنتواصل معك لاستكمال الإجراءات. يمكنك إرسال مستنداتك ردًا على هذه الرسالة.
```
Variables: 1 = name · 2 = role/opportunity.

---

## Internal staff alert template (Part 1)

### `internal_alert_ar`  — category: UTILITY
```
🔔 رسالة واتساب جديدة
العميل: {{1}}
الجوال: {{2}}
القسم: {{3}}
الرسالة: {{4}}
افتح المحادثة: {{5}}
```
Variables: 1 = customer name · 2 = customer phone · 3 = routed department · 4 = message preview · 5 = portal conversation link.

> Internal alerts go to **staff** numbers (no open session), so they MUST use this
> approved template. Configure each staff member's alert number + enable in the
> portal (WhatsApp Inbox header → ⚙️ alert settings).

---

## Customer quote-received confirmation template (Part 4)

### `quote_request_received_ar`  — category: UTILITY
```
تم استلام طلب عرض السعر بنجاح. رقم طلبك: {{1}}. سيقوم فريق كيان بمراجعة الطلب والتواصل معك قريبًا.
```
Variables: 1 = request number.

> Only needed when the customer is OUTSIDE the 24h session window. Right after a
> customer submits the form from a WhatsApp conversation the session is open, so the
> portal sends the same text as a free-form message (gated by
> `QUOTE_REQUEST_CUSTOMER_WHATSAPP_CONFIRM_ENABLED` + allowlist). Submit this template
> only if you later want to confirm to customers whose session has closed.

---

## Approval steps
1. Create each template above in WhatsApp Manager with the exact name/category/`ar` language.
2. Wait for Meta approval (usually minutes–hours; UTILITY is fastest).
3. Once approved, set the template name in the start-conversation form / internal-alert config.
4. Enable sending only when ready: `WHATSAPP_TEMPLATE_SEND_ENABLED=true` (+ allowlist) for
   start-conversation; `WHATSAPP_INTERNAL_ALERTS_ENABLED=true` (+ allowlist) for staff alerts.
5. Test against an allow-listed number first; never broadcast to real customers during testing.
