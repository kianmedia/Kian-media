-- ════════════════════════════════════════════════════════════════════════════
-- wave8_push_tokens_PREFLIGHT.sql — يُقرأ ولا يكتب. ⛔ لا يُشغَّل RUNME قبله.
--
-- Wave 8 · V2-8.3-A
--
-- الغرض: إثبات أنّ نطاق الإشعارات القائم **موجود فعلًا**، لأنّ هذه الحزمة
-- **توسّعه ولا تبني بديلًا عنه**. لو غاب أيّ ركن منه فالتوسعة تبني نظامًا
-- موازيًا من حيث لا تدري — وهو ما يحظره «لا أنظمة موازية» صراحةً.
-- ════════════════════════════════════════════════════════════════════════════
\echo '=== WAVE 8 · PUSH TOKENS · PREFLIGHT ==='

-- ─── ١ · أركان نطاق الإشعارات القائم ────────────────────────────────────────
select 'notification domain' as check_group, t.tbl,
       to_regclass('public.' || t.tbl) is not null as present
from (values ('notifications'), ('notification_preferences'),
             ('notification_events'), ('notification_delivery_log')) as t(tbl);

-- 🔴 توقُّف: أيّ صفّ present=false يعني أنّ الأساس غائب.
--    عندئذ **لا تُشغّل RUNME** — طبّق حزم الإشعارات أوّلًا (batch 9C/9D).

-- ─── ٢ · هل الجدول الجديد موجود سلفًا؟ (تشغيل ثانٍ) ─────────────────────────
select 'target' as check_group, 'push_tokens' as obj,
       to_regclass('public.push_tokens') is not null as already_exists;
-- الحزمة idempotent، فوجوده ليس خطأً — لكنّه يعني أنّ التشغيل تكرار.

-- ─── ٣ · قيد القناة الحاليّ في سجلّ التسليم ─────────────────────────────────
-- 🔴 الأهمّ هنا: `channel` مقيَّد بـ check، وإضافة 'push' **تتطلّب تعديل القيد**.
--    وإدراج قيمة خارج القيد يفشل بـ23514 صامتًا داخل مُحفِّز، فيضيع التسليم.
select 'constraint' as check_group, con.conname,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname = 'notification_delivery_log'
  and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%channel%';

-- ─── ٤ · تفضيلات المستخدم — هل يوجد عمود دفع؟ ──────────────────────────────
select 'preferences' as check_group, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'notification_preferences'
order by ordinal_position;

-- ─── ٥ · دوالّ الصلاحية التي تعتمد عليها السياسات ──────────────────────────
select 'authz helper' as check_group, p.proname,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ','), '(none)') as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('is_staff', 'is_admin')
order by p.proname;
-- 🔴 توقُّف: لو غابت `is_staff` فسياسة قراءة الموظّفين أدناه لن تُنشأ.

-- ─── ٦ · pgcrypto — تُستعمل للبصمة (digest) ────────────────────────────────
select 'extension' as check_group, extname,
       true as present
from pg_extension where extname = 'pgcrypto';
-- 🔴 توقُّف: صفر صفوف ⇒ `digest()` غير متاحة ⇒ البصمة لا تُحسب.
--    لا تُنشئ الامتداد من هذه الحزمة: تفعيل امتداد قرار مشغِّل، لا أثر جانبيّ.

\echo '=== انتهى الفحص. راجع كل توقُّف أعلاه قبل RUNME. ==='
