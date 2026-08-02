-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — WAVE 0 · V2-0.1-F · تراجع تسجيل الموافقة
-- docs/consent_capture_EXTENSION_ROLLBACK.sql
--
-- ⚠️ لم يُشغَّل. مقابل consent_capture_EXTENSION_RUNME.sql.
--
-- ★ اقرأ قبل التشغيل ★
--   الخطوة (١) وحدها تكفي في ٩٩٪ من الحالات: إطفاء الراية يُعيد النماذج الأربعة
--   إلى سلوكها السابق **فورًا وبلا لمس القاعدة**. الأعمدة الخاملة لا تضرّ.
--
--   الخطوة (٣) **تُتلف بيانات موافقة حقيقية**. الموافقة سجلّ قانوني: حذفه يعني
--   فقدان القدرة على إثبات أن شخصًا وافق. لا تُشغَّل إلا باعتماد صريح من خالد.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── (١) التراجع الموصى به — بلا SQL إطلاقًا ────────────────────────────────
--   Vercel → Environment Variables → NEXT_PUBLIC_CONSENT_CHECKBOX_ENABLED = false
--   (أو احذف المتغيّر) ثم أعِد النشر.
--   الأثر: يختفي الـcheckbox · يعود نصّ الموافقة الضمنية · لا يُرسَل شقّ الموافقة.
--   البيانات المُسجَّلة تبقى محفوظة. **هذا هو التراجع الصحيح.**

-- ─── (٢) تراجع الدالّة فقط — يوقف الكتابة ويُبقي البيانات ───────────────────
begin;
drop function if exists public.public_intake_set_consent(uuid,boolean,text,text);
commit;
-- الأثر: المسار الخادمي يسجّل PUBLIC_INTAKE_CONSENT_NOT_RECORDED ويواصل عمله.
-- استقبال الطلبات **لا يتأثّر** — الشقّ إضافي بالتصميم.

-- ─── (٣) ⛔ تراجع كامل — يحذف بيانات موافقة حقيقية ⛔ ───────────────────────
--   لا تُشغَّل إلا باعتماد خالد الصريح. احتفظ بنسخة أولًا:
--     create table public_intake_consent_backup as
--       select id, consent_given, consent_at, consent_version
--         from public.public_intake where consent_given is not null;
--
-- begin;
-- alter table public.public_intake drop constraint if exists public_intake_consent_complete;
-- alter table public.public_intake drop column if exists consent_version;
-- alter table public.public_intake drop column if exists consent_at;
-- alter table public.public_intake drop column if exists consent_given;
-- commit;
