# KIAN PLATFORM — MASTER ORDER FINAL (Rev.2) — READ-ONLY AUDIT + RESTRUCTURE

> **طريقة الاستخدام:** ضع هذا الملف في جذر المشروع باسم `MASTER_ORDER_FINAL.md` (يستبدل أي نسخة سابقة من هذا الأمر مثل `MASTER_ORDER_v2.1_FINAL.md`). ثم أرسل لكلود كود:
> «اقرأ MASTER_ORDER_FINAL.md بالكامل ونفّذه حرفياً بدءاً من الخطوة صفر. المهمة READ-ONLY — تدقيق وإعادة هيكلة مستندات فقط: لا كود، لا SQL، لا اتصال بقاعدة Production، لا Push، لا Merge، لا Deploy. توقف عند GATE A وانتظر قراري.»
>
> **بروتوكول اللغة:** التقارير والأسئلة لخالد بالعربية. أسماء الملفات/الجداول/الكود بالإنجليزية.
> **مصدر المواصفات:** يبقى `MASTER_BRIEF.md` (v2.0) هو مصدر تفاصيل البنود (acceptance criteria، أرقام الأداء، نصوص UI). **لا تنقله ولا تؤرشفه ولا تعد تسميته ولا تستبدله ولا تعدّله خلال هذه المهمة إطلاقاً.** أنشئ `MASTER_BRIEF_v2.1_DRAFT.md` بجانبه. أرشفة v2.0 واعتماد v2.1 يتمان فقط بعد موافقة خالد في GATE A **وفي مهمة منفصلة**.

---

## الخطوة صفر — فحص Git قبل أي شيء

1. نفّذ أول أمر في المهمة: `git status --short --branch`.
2. إذا كانت الـ Working Tree غير نظيفة، أو كان فرع `docs/v2_1-audit` موجوداً بحالة متعارضة: **توقف فوراً وأبلغ خالد** بما وجدته، ولا تتقدم خطوة واحدة قبل رده.
3. ممنوع منعاً باتاً: `stash` أو `reset` أو `checkout` يتجاهل تغييرات، أو حذف أو نقل أي تغييرات قائمة — مهما كان السبب.
4. إذا كانت الشجرة نظيفة: أنشئ/انتقل إلى فرع `docs/v2_1-audit` وتابع المهمة.

## المهمة

اقرأ `MASTER_BRIEF.md` (v2.0) وجميع مستندات المشروع والـ migrations (بما فيها ملفات `*_RUNME.sql`) والكود وسجل Git والفروع غير المدمجة، ثم أنتج `MASTER_BRIEF_v2.1_DRAFT.md` مبنيًا على الواقع الفعلي للمستودع، وليس على افتراض البدء من الصفر.

الأهداف: اكتشاف المنفَّذ كليًا، والمنفَّذ جزئيًا، والبنود المكررة في v2.0، ودمج الجديد مع الأنظمة القائمة، ومنع أي جداول/خدمات/صلاحيات موازية، وإعادة ترتيب الـ Waves حسب الاعتماديات الحقيقية، وإخراج خطة تنفيذ جديدة **دون تنفيذ أي كود**.

## أولًا: قيود هذه المهمة (READ-ONLY)

ممنوع: تعديل كود الموقع أو البوابة • تعديل `MASTER_BRIEF.md` (v2.0) أو نقله أو أرشفته • إنشاء/تعديل migrations • تشغيل أي SQL • الاتصال بقاعدة Production أو تعديلها • إنشاء جداول أو RPCs • تغيير متغيرات البيئة • تعديل Zoho أو WhatsApp أو Apps Script أو n8n • Push أو Merge أو Deploy • تعديل `main` • بدء أي Wave تنفيذية • افتراض أن وجود migration يعني تطبيقها على Production • افتراض أن غياب ميزة من الواجهة يعني غياب قاعدتها • **عرض أو تسجيل أي Secrets أو Tokens أو DSN أو Passwords في أي ملف أو تقرير — يُذكر اسم المتغير وحالته فقط: `Configured` / `Missing` / `Unknown`** • أي stash/reset/تجاهل لتغييرات قائمة (الخطوة صفر).

مسموح فقط: قراءة الكود والـ migrations وملفات `docs` وسجل Git والفروع • إنشاء مستندات التدقيق المطلوبة • إنشاء `MASTER_BRIEF_v2.1_DRAFT.md` • **Local commits للمستندات فقط على فرع `docs/v2_1-audit`** (ليس على main، وبدون Push).

بعد إنهاء المستندات: توقف عند GATE A وانتظر اعتماد خالد.

## ثانيًا: قاعدة الواقع الفعلي

> Reality wins. The current repository, migrations, types, RPCs, RLS policies, services, flags and verified production notes are the source of truth.

فرّق بوضوح بين الحالات: مطبّق على Production • موجود في `main` وغير مؤكد تطبيق SQL الخاص به • موجود في Branch غير مدمج • migration موجودة وغير مؤكدة التطبيق • واجهة بلا Backend مكتمل • Backend بلا واجهة • ميزة جزئية • غير موجود.

إذا تعذّر إثبات حالة Production من المستندات اكتب: `APPLICATION STATUS REQUIRES KHALED CONFIRMATION` — ولا تفترض. وإذا تجاوز جمع الدليل لبندٍ ما جهدًا معقولًا، صنّفه `BLOCKED BY PRODUCTION CONFIRMATION` وانتقل — لا تحفر بلا نهاية.

**أدلة إنتاج جاهزة (فحص خارجي مؤرخ 2026-08-02 — اعتمدها كـ Production verification notes لبنود الموقع العام):**
- LIVE ✅: ~10 أوصاف أعمال فريدة (قسم الشركات)؛ رقم جوال ثانٍ (+966543553038)؛ جملة موافقة ضمنية بالنموذج الرئيسي؛ نموذج /quote-request غني ويتضمن حقل «كيف تعرفت علينا».
- NOT LIVE ❌: العدادات تُعرض `0+` في HTML الأولي؛ قسم تقييمات فارغ ظاهر؛ title/canonical موحّد لكل المسارات (canonical = https://kianmedia.com حتى في /quote-request)؛ لا consent checkbox بأي نموذج؛ مجموع فلاتر الفئات 54 مقابل 46 معروضًا؛ ~36 وصفًا مكررًا و3 أعمال باسم «إعلان قصير»؛ النموذج الرئيسي → واتساب فقط بلا حفظ؛ OG image = شعار مربّع؛ الفوتر info@ فقط.
- بنود الموقع العام تدخل ضمن المصفوفات والتدقيق مثلها مثل بنود البوابة.

## ثالثًا: قاعدة منع الازدواج — G13 EXISTING DOMAIN FIRST

قبل اقتراح أي جدول/RPC/Service/Role جديد: (1) ابحث عن النظام القائم الذي يغطي المجال. (2) وثّق جداوله وخدماته وواجهاته. (3) إذا غطّى ≥60% من المتطلبات وجب توسيعه. (4) الحقول شديدة التخصص → Extension Table مرتبط بالسجل الحالي. (5) يُمنع إنشاء مصدر بيانات موازٍ لنفس الحقيقة. (6) يُمنع إنشاء محرك ثانٍ لحساب حالة المشروع أو التقدم أو المالية أو الصلاحيات. (7) أي جدول جديد يتضمن فقرة «لماذا لا يمكن توسيع الموجود». (8) لا حذف/إعادة تسمية/ترحيل بيانات قائمة دون خطة توافق وتراجع واعتماد خالد.

## رابعًا: تفكيك البنود وتصنيفها

**التفكيك أولاً:** قسّم كل بند مركّب في v2.0 إلى متطلبات صغيرة ذرّية بـ **IDs ثابتة** بصيغة `V2-<wave>.<item>-<letter>` (مثال: V2-1.9-A فيديو الهيرو، V2-1.9-B صور الأعمال، V2-1.9-C الخطوط). صنّف كل متطلب على حدة عندما تختلف حالته عن بقية البند، واستخدم **نفس الـ IDs** في جميع المصفوفات والتقارير والمسودة.

**ثم التصنيف — حالة واحدة فقط لكل متطلب + دليل:**
`KEEP — NEW` • `VERIFY & EXTEND` • `MERGE INTO EXISTING` • `REMOVE — DUPLICATE` • `DEFER` • `NEEDS KHALED CONFIRMATION` • `BLOCKED BY PRODUCTION CONFIRMATION`

الدليل = File path / Component / Migration / Table / RPC / RLS policy / Service / Flag / Commit / Production note. لا يكفي «الميزة موجودة».

## خامسًا: مناطق التداخل الواجب تدقيقها

### A. إصدارات المخرجات والتعليقات والتسليم
مؤشرات قائمة: `deliverable_comments_resolution_RUNME.sql`، `deliverable_versions_RUNME.sql`، `project_delivery_release_policy_RUNME.sql`، تعليقات عميل مرتبطة بالتوقيت، دورة اعتماد، حالات مراجعة/تعديل/تسليم نهائي، سياسات إتاحة الملفات، Preview links.
المطلوب: لا تنشئ `deliverable_versions` من جديد • افحص الجداول والعلاقات وRLS الحالية • حوّل Wave 5.1 إلى VERIFY & EXTEND • ادمج Branded Delivery Pages مع نظام روابط التسليم/المعاينة القائم • أضف `showreel_allowed`/`confidential` كامتداد لا كنظام جديد • افحص وجود عدّاد التحميلات والانتهاء والإلغاء جزئيًا • لا Workflow اعتماد موازٍ • حافظ على كل الإصدارات والتعليقات والاعتمادات السابقة.

### B. مركز ما قبل الإنتاج وCall Sheets والتصاريح والمواقع
مؤشرات قائمة: `preproduction_center_RUNME.sql`، Project Timeline، أقسام Pre-production، Shooting schedules، Crew plans، Locations، Permits، Approvals.
المطلوب: لا مركز ما قبل إنتاج جديد • Call Sheets وحدة داخل المركز الحالي • استخدم المشروع والمراحل وجلسات التصوير القائمة • لا Shooting Schedule ثانٍ • افحص locations/permits قبل اقتراح جداول • المواقع داخل المشروع فقط؟ → Library Extension مرتبطة • التصاريح كمستندات عامة؟ → حقول أو Extension Table • اربط Call Sheet بالمعدات والموظفين والمهن وجلسات التصوير الحالية • لا تكرر بيانات الطاقم داخل Call Sheet إذا كانت في assignments. (تفاصيل golden hour/الطقس/تنبيه الرياح للدرون/التاريخ البديل من v2.0 §3.1 تبقى كمواصفات للتوسعة.)

### C. الموظفون والطاقم والمهن والتكليفات
مؤشرات قائمة: موظفون داخليون، أدوار وصلاحيات، `employee_professions_RUNME.sql`، تكليفات مشاريع/مهام، فصل المهنة عن الصلاحية، قواعد خصوصية تمنع الموظف العادي من رؤية كامل المشروع والمالية.
المطلوب: لا `crew_members` موازيًا للموظفين • لا `roles[]` داخل سجل الطاقم • حافظ على الفصل: Auth Role / System Permission / Profession / Project Assignment / Production Role • الموظف الداخلي يستمر بالنظام الحالي • المستقلون الخارجيون → `crew_contractors` أو امتداد واضح للمستقلين فقط • جدول ربط للمهن بدل Array • الأجر المتفق عليه في Assignment (يختلف بين المشاريع) • لا تكرار لبيانات الموظف/جواله/مدينته في أكثر من مصدر • افحص تكليفات المشاريع قبل اقتراح `crew_assignments`.

### D. تضارب المواعيد والحجز المزدوج
قائم: منع فعلي في القاعدة عبر BEFORE triggers وخطأ `23P01` (وليس تحذيرًا فقط).
المطلوب: لا محرك Conflict Detection جديدًا • القاعدة هي مصدر الحماية • الواجهة تعرض سبب التعارض قبل الحفظ وتحوّل خطأ `23P01` إلى رسالة عربية واضحة • افحص نطاق المنع الحالي (موظفون/طاقم/معدات/مواقع/جلسات) واقترح التوسعة فقط لما لا يغطيه • لا تكتفِ بتحذير UI حيث يجب أن تمنع القاعدة.

### E. حالة المشروع والتقدم والمخطط الزمني
قائم: `project_operational_snapshot(project)` المصدر المعتمد لـ Overall progress / Current phase / Lifecycle / Shooting status، مع `project_timeline_RUNME.sql` وParent–Child projects وProject Core.
المطلوب: يُمنع منطق مستقل لحساب التقدم • كل Dashboard/App/Report يستهلك المصدر المعتمد • افحص أي استخدام مباشر لـ `projects.status` يتعارض مع Project Core • حافظ على Parent–Child • **قالب بودكاست 25 حلقة = مشاريع فرعية/مراحل بالبنية الحالية، لا جدول حلقات مستقل** • لا تكرار Timeline/Gantt/Shooting status في جداول جديدة.

### F. CRM والمناقصات والعملاء والمتابعات
قائم: CRM V1 (عملاء، جهات اتصال، Leads/Quote Requests، فرص، متابعات، عروض أسعار، تقارير، Finance/reporting finalization).
المطلوب: لا Tender Pipeline منفصلًا عن CRM دون إثبات حاجة • المناقصة = Opportunity Type أو Extension للفرصة أو Pipeline Stage متخصص • لا تكرار بيانات الجهة داخل `tenders` • اربط المناقصة بالعميل والفرصة وعرض السعر والمشروع عند الفوز • `client_health` يُشتق من CRM والمشاريع • `follow_ups` تستخدم نظام المهام/المتابعات الحالي • معدل الفوز والقيم عبر محرك التقارير الحالي • افحص مركز الفرص المؤجل قبل أي واجهة جديدة • لا Rate Card جديدًا إذا وُجد نظام خدمات/بنود عروض قائم.

### G. نماذج الموقع وLead Persistence
قائم: نموذج التواصل، `/quote-request`، حجز المواعيد، Apps Script، CRM V1، إشعارات، مسار فتح واتساب، إصلاح anonymous email relay.
التدفق المطلوب في المسودة: (1) النموذج → API خادمي موحد. (2) الحفظ أولًا في Supabase/CRM كمصدر رئيسي. (3) حفظ Source/UTM/Attribution/الموافقة. (4) بعد نجاح الحفظ → Webhook اختياري إلى Apps Script أو n8n. (5) ثم يمكن فتح واتساب. (6) فشل Apps Script/واتساب لا يُفقد الطلب. (7) Apps Script ليس قاعدة البيانات الأساسية للـ Leads. (8) استخدم نظام Quote Requests الحالي بدل Leads مكررة إن غطّى الحالة. (9) لا تعِد فتح مسار إرسال عام غير محمي، واحمِ إصلاح الـ relay باختبارات Regression.

### H. المالية وZoho Books
قائم: `project_core_financials_phaseA_RUNME.sql` (Phase A مطبّقة وفق تأكيدات سابقة — تحقّق)، Phase B غير مؤكدة، Finance hardening، Profit inference protections، Quotes/Invoices، Zoho Books مصدر الفواتير الرسمي، صلاحيات تمنع غير المخولين من رؤية المالية، Flags خاصة بـ Zoho.
المطلوب: لا `project_costs` أو `payment_milestones` قبل فحص النموذج المالي الحالي • لا فواتير رسمية داخلية تنافس Zoho • **G7 المصحّحة:** «Do not add, replace, disable or alter the existing Zoho integration. Preserve existing code paths and flags. Any Zoho expansion requires a separate approved brief.» • افحص تغطية Phase A • افصل بين: Operational budget / Actual costs / Payment milestones / Official invoices / Zoho payment status / Forecast cash flow • Executive Dashboard يستهلك هذه المصادر ولا يعيد حسابها • حافظ على قيود منع استنتاج الأرباح • لا تفترض تطبيق Phase B دون دليل أو تأكيد خالد.

### I. المعدات والعهد والأصول
قائم: نظام أصول وعهدة (صرف/استرجاع، صور تسليم/استلام، موافقات إغلاق، صلاحيات تعديل/حذف، سجل أسباب حذف، إصلاحات صور، RPCs خادمية، تنبيهات).
المطلوب: لا Equipment System جديدًا • QR/الصيانة/الاستخدام/التأمين = Extensions للنظام الحالي • `equipment_usage_log` يُشتق من Call Sheets والتكليفات والعهد قدر الإمكان • لا تكرار سجل الصرف والاسترجاع • QR يفتح صفحة آمنة تراعي صلاحية المشاهد • لا عرض بيانات العهدة/الأسعار/الموظفين للعامة • افحص جداول maintenance/asset history قبل إنشاء غيرها • حافظ على الصور والسجلات القديمة.

### J. الإشعارات والبريد وWhatsApp
قائم: خدمة إشعارات بقنوات Portal/Email/WhatsApp وتفضيلات، إصلاحات أمنية لمسار البريد، خصائص WhatsApp خلف Flags أو غير مفعلة، Apps Script وn8n بأجزاء من التشغيل.
المطلوب: لا Notification Service ثانية • Notifications Center واجهة فوق الخدمة الحالية • Weekly Digest وPermit/Maintenance alerts وPush عبر نفس الـ Outbox/Pipeline • أضف Idempotency ضد الإرسال المزدوج • Retry status وسجل فشل واضح • Push = Channel جديد لا نظامًا منفصلًا • لا WhatsApp automation جديدة • لا تعطيل أي مسار قائم دون اعتماد مستقل • احمِ إصلاح anonymous email relay باختبارات Regression.

### K. الصلاحيات وRLS وAudit Log
قائم: أدوار Owner/Super Admin/Admin/Finance/Manager-Staff/Client، صلاحيات على مستوى المشروع، RLS، Audit log (أو أجزاؤه)، فصل رؤية المالية والملاحظات الداخلية، Soft delete بسجل أسباب.
المطلوب: لا Role System موازية • `client_viewer`/`client_approver` = Project Membership capabilities أو امتداد للنظام الحالي • صلاحية الاعتماد تُفرض في RLS/RPC لا في UI فقط • MFA على Supabase Auth الحالي • Audit Log Viewer يستخدم السجل القائم ولا يُنشئ سجلًا ثانيًا • كل جدول جديد RLS deny-by-default • اختبار كل دور إيجابيًا وسلبيًا • حافظ على سياسات Soft Delete.

### L. التقارير واللوحة التنفيذية وCSV
قائم: Reporting، تقارير مشاريع ومالية، CSV (أو أجزاؤه)، Gantt summary، Operational snapshot، CRM reports.
المطلوب: لا Reports Engine جديدًا • Inventory لجميع التقارير الحالية • Executive Dashboard يستهلك المصادر القائمة • Seasonality من جلسات التصوير والمشاريع • Cash Flow من المالية الحالية • Equipment utilization من العهد وCall Sheets • CSV Export = Utility موحدة • حافظ على: Arabic encoding، Riyadh timezone، Role-based column visibility، عدم تسريب الهوامش والأرباح.

### M. Testimonials وCase Studies وPortfolio — Pipeline واحدة فقط
التسلسل: إغلاق المشروع → التحقق من حق النشر → طلب تقييم العميل → Pending → اعتماد/رفض الإدارة → الظهور في الموقع • المشروع المسموح نشره يولّد Portfolio Draft → مراجعة الإدارة → لا نشر تلقائيًا دون اعتماد.
ممنوع: Testimonials ثابتة + نظام تقييم منفصل معًا • مولّدان مختلفان للـ Portfolio وCase Studies • **تعديل `content/portfolio.ts` تلقائيًا وقت التشغيل على Vercel** (نظام الملفات للقراءة أصلًا).
الحل: Draft في القاعدة أو Export Queue → معاينة وموافقة → Script أو Pull Request لتحديث ملفات المحتوى → النشر بعد اعتماد خالد. وأضف Publication Consent للشعار والتقييم ودراسة الحالة.

### N. Demo Tenant
لا `DEMO_MODE` داخل Production ببيانات وهمية. الحل: بيئة Demo/Preview Supabase منفصلة، بيانات وهمية فقط، بلا أي بيانات أو مفاتيح إنتاج، بنفس الكود مع Environment منفصل. صنّف Demo داخل Production كخطر محذوف من v2.0.

### O. الاختبارات — تُنقل للبداية
الحد الأدنى ينتقل إلى Wave 0 (ويُنفَّذ على Preview/Local حصراً — **أبدًا ليس على Production**): Login • Project visibility by role • Client project view • Deliverable version view • Client comment • Approve/Reject • Double-booking rejection (`23P01`) • Financial visibility restrictions • Operational snapshot consistency • Quote request persistence • Anonymous email relay rejection • Equipment custody permissions.
كل Wave لاحقة تضيف اختبارات ميزاتها قبل اعتمادها. Wave 7 = توسيع الاختبارات لا بدايتها.

### P. Feature Flags — G6 المعاد صياغتها
(1) الميزات الكبيرة وتغييرات الـ Workflow خلف Flags. (2) التغييرات الخطرة تُفعَّل تدريجيًا. (3) إصلاحات الأمان الحرجة لا تبقى معطلة بعد اعتمادها. (4) Bug fixes المُعيدة للسلوك الصحيح لا تحتاج دائمًا Flag. (5) Wave-level flags بدل عشرات الأعلام الصغيرة. (6) لكل Flag: Owner، Default state، Activation steps، Rollback steps، Removal date. (7) يبقى المبدأ: مع إطفاء أعلام الميزات الكبيرة، تجربة الموقع/البوابة الحالية لا تتغير.

### Q. تطبيق الجوال
يعيد استخدام: Supabase Auth الحالي، RLS الحالي، `project_operational_snapshot`، خدمة الإشعارات، RPCs القائمة، Approval workflow القائم، Equipment custody workflow القائم. يبقى مفهوم التطبيق ثنائي الدور من v2.0 (عميل + طاقم، شامل مسح QR للعهد) — **بوصفه تعزيزاً للقيمة الأصلية للتطبيق في سياق Apple Guideline 4.2، وليس ضماناً لقبول Apple.**
يُضاف للخطة: Offline Call Sheet • Offline permit/document metadata • Sync queue عند عودة الإنترنت • Secure token storage • Biometric unlock اختياري • Universal Links (iOS) وApp Links (Android) • Crash reporting • Push preferences • Session revocation • منع تخزين ملفات حساسة غير مشفرة • اختبار صلاحيات العميل والموظف داخل التطبيق.
لا Mobile API يعيد منطق الأعمال؛ المطلوب RPC/API facade آمن فوق المنطق الحالي.

## سادسًا: الترتيب الجديد للـ Waves في المسودة

**DELTA-AUDIT:** فحص الواقع، خريطة التداخل، حصر SQL غير مؤكد التطبيق، حصر الفروع غير المدمجة — لا تنفيذ.
**WAVE 0 — Safety, Regression & Environment:** بيئة Preview منفصلة • Secrets audit (بأسماء المتغيرات وحالاتها الثلاث فقط) • Backups + Restore drill • Observability • Rate limiting • Security headers • Consent • Email deliverability (SPF/DKIM/DMARC) • الاختبارات الأساسية (§O) • RLS regression tests.
**WAVE 1 — Public Website Foundation:** i18n • Metadata/canonicals/OG • Counters • Portfolio cleanup (الأوصاف والفئات) • Lead persistence (§G) • Sitemap/robots/404/500 • Performance (بموازنات v2.0) • Accessibility AA.
**WAVE 2 — Website Credibility:** Case studies • Logos (بموافقات النشر) • Trust page • Testimonials pipeline foundation (§M) • توحيد NAP والبريد.
**WAVE 3 — Existing Portal Operations Extension:** توسيع Pre-production • Call Sheets داخل المركز • Locations • Permits • `crew_contractors` فقط إن لزم • إعادة استخدام الموظفين/المهن/التكليفات • Project templates • قالب البودكاست بـ Parent–Child • Calendar feeds.
**WAVE 4 — Existing CRM & Business Extension:** Tenders داخل CRM • Client health مشتق • Follow-ups بالنظام الحالي • Reviews • Weekly digest • Seasonality reports.
**WAVE 5 — Existing Delivery & Finance Extension:** استكمال Versioning الموجود • Delivery links • Rights (`showreel_allowed`/`confidential`) • التوسعات المالية بعد تدقيق Phase A/B • Cash flow • Late-payment drafts (مسودة فقط، الإرسال قرار بشري) • Client approval capabilities (§K) • **Deemed Approval: تصنيفه `NEEDS KHALED CONFIRMATION` وتظل الـ Flag OFF. لا يُفترض ثبوت الأساس التعاقدي إلا بعد تحديد نسخة العقد النهائية الموقّعة ونص البند الخاص بكل مشروع — عقد بناء لا يُطبّق تلقائياً على مسبار ١٠.**
**WAVE 6 — Existing Assets & Compliance Extension:** Equipment QR • Maintenance • Archive registry • Music licenses • HSE • Model releases • SOP • Post-mortems • Portfolio draft pipeline (§M).
**WAVE 7 — UX, Search & Enterprise Polish:** Search (Cmd+K عبر Postgres FTS) • Notifications UI • Audit viewer • Executive dashboard (يستهلك المصادر القائمة) • CSV consolidation • MFA • States audit • توسيع E2E.
**STABILIZATION:** أسبوعان بلا ميزات — إصلاحات فقط • Pilot حقيقي (مسبار ١٠ مرشح) • تقرير استخدام • **قرار Mobile Go/No-Go.**
**WAVE 8–9 — Mobile:** PWA • Mobile API documentation (facade) • Push • Deep links • التطبيق الأصلي (§Q) • Store readiness.

## سابعًا: الملفات المطلوب إخراجها

1. **`docs/EXISTING_CAPABILITIES.md`** — كل Module قائم: الجداول، RPCs، RLS، الخدمات، الواجهات، Flags، Migrations، حالة Git، حالة Production إن ثبتت.
2. **`docs/OVERLAP_DEDUP_MATRIX.md`** — جدول: | Requirement ID | v2 Item | Existing Capability | Evidence | Overlap Level (None/Low/Medium/High/Exact Duplicate) | Decision | Required Change | Risk |. يشمل بنود الموقع العام والبوابة معًا، بالـ IDs الثابتة من §رابعًا.
3. **`docs/DATABASE_APPLICATION_STATUS.md`** — لكل migration/RUNME: File، Purpose، Exists in repo، Committed، Merged، Production application confirmed، Confirmation source، Dependent code، Risk if reapplied، خالد confirmation required. **وجود الملف ليس دليل تطبيقه.**
4. **`docs/PROTECTED_ARCHITECTURE.md`** — الأنظمة الممنوع تجاوزها (بعد التحقق): Project operational snapshot • Project lifecycle • Deliverable workflow • Notification service • CRM source of truth • Finance source of truth • Zoho official invoice boundary • Employee/Profession/Assignment model • Equipment custody model • Audit log • Parent–Child projects • Double-booking DB enforcement.
5. **`MASTER_BRIEF_v2.1_DRAFT.md`** — مسودة بديلة كاملة لـ v2.0 (دون المساس بـ v2.0 نفسه): البنود غير المكررة فقط • الجزئية بصيغة VERIFY & EXTEND • الاعتماديات • Gates • أسئلة خالد • Migrations المحتملة (وصفًا، دون إنشائها) • Acceptance criteria (منقولة من v2.0) • Rollback requirements • عدم المساس بالأنظمة المحمية • **وتُدمج قواعد هذا الأمر (خطوة Git الصفرية، سياسة الأسرار الثلاثية، تصنيف Deemed Approval، صياغة Apple 4.2، الـ IDs الثابتة) نصياً داخل أقسامها المناسبة بحيث تكون المسودة مرجعاً واحداً مكتفياً بذاته لا يعتمد على هذا الأمر.**
6. **`docs/V2_1_CHANGELOG.md`** — المحذوف كتكرار • المدموج • المحوَّل إلى VERIFY & EXTEND • المؤجل • ما يحتاج قرار خالد • تغييرات ترتيب الـ Waves • سبب ضرورة كل تغيير.
7. **`docs/V2_1_EXECUTIVE_SUMMARY_AR.md`** — ملخص عربي مبسّط لخالد: الموجود فعلًا • الجديد فعليًا • المكرر المحذوف • المخاطر الممنوعة • المدة الجديدة المقدرة • ترتيب التنفيذ • أول Wave تنتظر الاعتماد.

## ثامنًا: التقرير النهائي (بالعربية)

يتضمن: (1) نتيجة `git status --short --branch` وحالة الشجرة (2) Current HEAD (3) الفروع ذات الصلة (4) عدد بنود v2.0 وعدد المتطلبات بعد التفكيك (5–9) أعداد كل تصنيف (10) SQL/migrations التي تحتاج تأكيد خالد (11) أكبر 10 تعارضات مُنعت (12) فرق وقت التنفيذ المتوقع بين v2.0 والمسودة (13) قائمة أسئلة Gate A (14) حالة متغيرات البيئة بأسمائها فقط: Configured/Missing/Unknown (15) أسماء الملفات المُنشأة (16) تأكيد صريح بعدم تنفيذ كود أو SQL أو Push أو Deploy، وبعدم المساس بـ `MASTER_BRIEF.md` (v2.0).

**قائمة أسئلة Gate A تتضمن كحد أدنى (مع أي أسئلة يكشفها التدقيق):**
هل أُنشئت بيئة Supabase المنفصلة للـ Preview (شرط رفع تجميد الـ Push)؟ • هل Phase B المالية مطبّقة على Production؟ • **ما نسخة العقد النهائية الموقّعة لمشروع مسبار ١٠، وهل تتضمن بند الموافقة الحكمية، وإن وُجد فما نصه الحرفي؟** • حسم Cloudflare Stream vs Mux • بدء تسجيل Apple Developer Program باسم المؤسسة الآن (D-U-N-S يستغرق أسابيع) • ترقية Vercel Pro: نعم/لا • رقم سنوات الخبرة للعدادات • أسماء عملاء «إعلان قصير» الثلاثة • قرار توحيد البريد (info@/sales@/contact@) • حالة `SENTRY_DSN` وأسرار النسخ الاحتياطي (Configured/Missing/Unknown فقط).

## تاسعًا: معايير القبول

المهمة غير مكتملة إلا إذا: نُفّذت الخطوة صفر وأُبلغت نتيجتها • `MASTER_BRIEF.md` (v2.0) لم يُمس إطلاقاً • كل بند مركّب فُكّك إلى متطلبات بـ IDs ثابتة • صُنّف كل متطلب بدليل • لا جدول مقترح دون مقارنة بالموجود • لا نظام مالي يوازي Zoho أو Project Core • لا CRM موازٍ • لا Crew System يكرر الموظفين • لا Equipment System يكرر العهد • لا Timeline/Progress Engine جديد • لا Notification Service جديدة • لا Deliverable Workflow جديد • الاختبارات الأساسية في Wave 0 • Demo Data مفصولة عن Production • Parent–Child محفوظ • RLS والبيانات القائمة محفوظة • لا أسرار في أي مستند (أسماء المتغيرات وحالاتها الثلاث فقط) • `MASTER_BRIEF_v2.1_DRAFT.md` كامل ومكتفٍ بذاته • التوقف عند Gate A.

## GATE A

بعد إنهاء التدقيق وإعادة الهيكلة: لا تبدأ Wave 0 • لا migrations • لا Push • لا Merge • لا Deploy • اعرض التقرير والملفات السبعة • توقف وانتظر رسالة خالد: **«أعتمد MASTER BRIEF v2.1 وابدأ Wave 0»**.
**ملاحظة:** ترقية `MASTER_BRIEF_v2.1_DRAFT.md` إلى `MASTER_BRIEF_v2.1.md` وأرشفة v2.0 إلى `docs/archive/` تتمان **في مهمة منفصلة بعد الاعتماد** — لا تنفذهما ضمن هذه المهمة إطلاقاً.
إذا وجدت تعارضًا كبيرًا لا تحسمه من الكود أو المستندات — لا تخمّن؛ سجّله في أسئلة Gate A وانتظر قرار خالد.

---

## ملحق: سجل المراجعات (للشفافية)

**Rev.1** — دمج مسودة تدقيق خالد (G13، التصنيفات، مناطق التداخل A–Q، المخرجات السبعة) مع 10 تعديلات من كلود: v2.0 مصدر المواصفات، إدراج بنود الموقع العام بالأدلة المؤرخة، اختبارات Wave 0 على Preview/Local حصراً، أسئلة Gate A التجارية، فرع `docs/v2_1-audit` للتوثيق، التطبيق ثنائي الدور، حماية Double-booking enforcement، قاعدة «لا تحفر بلا نهاية»، مبدأ «الأعلام مطفأة = تجربة بلا تغيير».

**Rev.2 (هذه النسخة — تَحكم عند أي تعارض مع Rev.1)** — دمج تصحيحات خالد الستة نصياً: (1) عدم المساس بـ v2.0 والمخرج مسودة `_DRAFT` جانبية، والترقية والأرشفة مهمة منفصلة بعد الاعتماد. (2) Deemed Approval = `NEEDS KHALED CONFIRMATION` + Flag OFF بلا افتراض أساس تعاقدي قبل تحديد العقد الموقّع ونص البند لكل مشروع (يلغي صياغة Rev.1). (3) الخطوة صفر: `git status` والتوقف عند شجرة غير نظيفة، ومنع stash/reset. (4) تفكيك البنود المركبة بـ IDs ثابتة عبر كل المصفوفات. (5) سياسة الأسرار الثلاثية Configured/Missing/Unknown. (6) صياغة Apple 4.2 كتعزيز قيمة لا ضمان قبول. + إضافتان: دمج هذه القواعد داخل المسودة نفسها، وسؤال Gate A عن عقد مسبار ١٠ الموقّع.

---
*عند الشك: diff أصغر، تغيير إضافي لا استبدالي، واسأل خالد. نبني على ما نملك — لا نوازيه.* 🎬
