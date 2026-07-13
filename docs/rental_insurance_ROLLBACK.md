# Rental & Insurance Portal V1 — Rollback / تعطيل آمن

**المبدأ: لا تحذف بيانات.** التراجع = إخفاء النظام بإطفاء الأعلام، لا إسقاط جداول.

## 1) التعطيل الفوري (الأكثر أمانًا)
أطفئ العلم الرئيسي — يختفي النظام من الواجهة وتُرفض كل دوال الكتابة بـ`rental_disabled`، وتبقى البيانات سليمة:
```sql
update public.custody_enterprise_settings
  set rental_insurance_enabled = false,
      rental_customer_portal_enabled = false,
      rental_whatsapp_enabled = false,
      rental_finance_enabled = false
  where id = 1;
```
أو من واجهة الإعدادات (CustodyEnterpriseSettings) — أطفئ «التأجير والتأمين».

## 2) بوابة المستأجر فقط
لإبقاء الأدوات الداخلية وإخفاء واجهة العميل:
```sql
update public.custody_enterprise_settings set rental_customer_portal_enabled = false where id = 1;
```

## 3) ما لا يجب فعله
- ❌ لا `drop table custody_rental_*` — تحذف عقودًا/أدلة/تدقيقًا.
- ❌ لا `drop constraint` على `notifications_type_check` بدون إعادة تعريف القائمة الكاملة (تكسر إشعارات أنظمة أخرى).
- ❌ لا حذف buckets `rental-*` (تحذف الأدلة والعقود).
- ❌ لا `reset`/`force`.

## 4) تراجع جزئي عن أعمدة (نادرًا — غير مُوصى به)
الأعمدة المُضافة عبر `add column if not exists` غير هدّامة وآمنة تركها. إن لزم إخفاء عمود جديد فاتركه (default غير مؤثّر) بدل حذفه لتفادي فقد بيانات.

## 5) التحقق بعد التعطيل
```sql
select rental_insurance_enabled, rental_customer_portal_enabled from public.custody_enterprise_settings where id=1;  -- يجب false
-- البيانات باقية:
select count(*) from public.custody_rental_requests;
select count(*) from public.custody_rental_events;
```

## 6) إعادة التفعيل
بعد إصلاح أي مشكلة، أعد `rental_insurance_enabled = true` (وللعملاء `rental_customer_portal_enabled = true`) — لا حاجة لإعادة تشغيل أي SQL؛ الدوال والجداول idempotent وباقية.

## ملاحظة
`rental_insurance_production_RUNME.sql` كله idempotent وغير هدّام: يمكن إعادة تشغيله بأمان دون فقد بيانات.
