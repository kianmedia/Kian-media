# Custody Enterprise — Rollback

## المبدأ
لا hard delete لأي بيانات. الـ rollback = **إطفاء الأعلام** (إخفاء الوحدات) — لا حذف جداول.

## rollback سريع (بلا فقد بيانات)
1. الإعدادات ← «مزايا المنصّة المؤسسية» ← أطفئ العلم/الأعلام المطلوبة. الوحدة تختفي فورًا، بياناتها محفوظة.
2. أو عبر SQL: `update public.custody_enterprise_settings set <flag> = false where id = 1;`

## rollback الكود (Vercel)
أعِد النشر إلى commit سابق من لوحة Vercel (Deployments → Redeploy). القاعدة تبقى كما هي (الأعلام تحكم الظهور).

## إزالة وحدة كاملة (نادر — بعد نسخ احتياطي)
الجداول idempotent؛ لإزالة وحدة فعليًا استخدم `drop table if exists public.<table> cascade;` لجداول تلك الوحدة فقط
(مثلاً الحقائب: kits/kit_items/kit_versions/kit_movements). **راجع النسخ الاحتياطي أولًا** ولا تلمس جداول الوحدات الأخرى
ولا الأساس (assets/assignments/movements) ولا الأنظمة القديمة.

## ما لا يُعكَس تلقائيًا
توسيع `notifications_type_check` وأعمدة `alter add`: تركها غير ضار (أعمدة إضافية/أنواع إضافية). لا داعي لعكسها.
لعكس CHECK: أعِد إعلانه بالقائمة الأقدم (احتفظ بنسخة) — لكن لا يُنصح (قد تفشل على صفوف موجودة).
