# WAVE 3 · شرط الدخول الإلزامي — حسم الازدواجات D-1 · D-2 · D-3

> `MASTER_BRIEF_v2.1.md` §4 WAVE 3:
> «⛔ **شرط دخول إلزامي — حسم ثلاثة ازدواجات موروثة قبل أي كود.**»
>
> هذه الوثيقة هي ذلك الشرط. لا كود في Wave 3 قبلها.

**الأدلّة كلّها من المستودع** — قراءة DDL ودوال وواجهات ومسارات. **لا اتصال
بـProduction**، فما لا يمكن إثباته من المستودع مذكور أدناه بوصفه كذلك، لا مُخمَّنًا.

---

## ٠. الخلاصة قبل التفصيل

الازدواجات الثلاثة **ليست ثلاث مشكلات، بل نمط واحد يتكرّر**:

> نطاق `ops_*` هو **السجلّ المُطبَّع** لعمليات الإنتاج الميدانية.
> ونظائره داخل `project_*` هي **نسخ مُسطَّحة لكل مشروع** وُلدت داخل منصّة
> المشاريع.

| # | الازدواج | المصدر المعتمد | المصير |
|---|---|---|---|
| **D-1** | `ops_call_sheets` ⟷ `project_call_sheets` | 🟢 **`ops_call_sheets`** | الآخر يُجمَّد ولا يُوسَّع |
| **D-2** | `prodops_call_sheet*` ⟷ `project_core_call_sheet_*` | 🟢 **`prodops_call_sheet*`** | الآخر يبقى للقراءة |
| **D-3** | `ops_locations` ⟷ `project_locations` ⟷ `custody_inventory_locations` | 🟢 **`ops_locations`** | `custody_*` **ليس ازدواجًا** · `project_locations` يُجمَّد |

**وسبب الحسم واحد وحاسم:** كلّ هدف توسعة سمّاه الـBrief لـWave 3 هو `ops_*` —
`ops_job_crew` · `ops_job_equipment` · `ops_job_weather` · `ops_job_permits` ·
`ops_locations`. اعتماد `project_*` مصدرًا كان سيُيتّم هذه الخمسة جميعًا.

---

## ١. D-1 · أيّ جدول Call Sheet هو المصدر؟

### الأدلّة

| | `ops_call_sheets` | `project_call_sheets` |
|---|---|---|
| مُعرَّف في | `operations_center_RUNME.sql:546` | `project_core_OPERATIONAL_CLOSURE_FINAL_RUNME.sql:22` |
| مرتبط بـ | `ops_jobs` (أمر عمل ميداني) | `projects` + `project_shoot_sessions` |
| الطاقم | 🟢 `ops_job_crew` — **جدول مُطبَّع** | 🔴 `crew jsonb default '[]'` |
| المعدّات | 🟢 `ops_job_equipment` — مُطبَّع، **محروس بـ`23P01`** | 🔴 `equipment jsonb default '[]'` |
| الموقع | 🟢 `location_id` → `ops_locations` (FK) | 🔴 `location_name text` + `address text` |
| الطقس | 🟢 `ops_job_weather` — جدول قائم | 🔴 `weather_notes text` |
| التصاريح | 🟢 `ops_job_permits` — جدول قائم | 🔴 `permits text` |
| الحالة | `draft → published` (+`published_by`) | `draft → sent` (+`sent_by`) |
| واجهة | `OpsCenter` · `OpsJobPanel` · **`OpsCallSheetPrint`** | `projectcore/CallSheet.tsx` |
| مسار | `/client-portal/operations` | `/client-portal/project-core/[projectId]` |
| ملفات SQL | ٦ | ٣ |

**كلاهما حيّ.** كلاهما في `components/portal/nav.ts` (`operations` و`project_core`)،
وكلاهما يوزّع على موظّفين داخليين — لا على العملاء. فهذا **ازدواج فعليّ قائم في
الإنتاج**، لا اختلاف في المسمّى.

⚠️ **تصحيح لملاحظة قد تتكرّر:** غياب اسم `ops_call_sheets` من كود التطبيق **ليس**
دليل موت. الوصول كلّه عبر RPC (`prodops_call_sheet*`) في `lib/portal/opsCenter.ts`،
فالجدول لا يُسمّى في الكود أصلًا. الواجهة قائمة وتشمل عرض طباعة.

### القرار: 🟢 `ops_call_sheets`

ثلاثة أسباب، الثالث وحده كافٍ:

1. **التطبيع.** `ops_call_sheets` يشير إلى خمسة جداول أبناء حقيقية.
   `project_call_sheets` يحتجز الطاقم والمعدّات والمركبات والجدول وقائمة اللقطات
   في ستّة أعمدة `jsonb`. ما بداخل `jsonb` لا يُستعلَم ولا يُقيَّد ولا يشارك في
   حارس تعارض. **ولا يمكن لحارس `23P01` أن يرى طاقمًا داخل مصفوفة JSON** — أي
   أنّ اعتماد `project_call_sheets` يُلغي حماية التعارض عمليًّا.

2. **أهداف التوسعة.** كل بند 🆕/🔧 في Wave 3 يستهدف `ops_*` صراحةً: الطقس
   (V2-3.1-E → `ops_job_weather`)، التصاريح (V2-3.2-A → `ops_job_permits`)،
   الطاقم والمعدّات (V2-3.1-B/C → `ops_job_crew` / `ops_job_equipment`).

3. **🔴 منصّة المشاريع مُجمَّدة النطاق.** `project_call_sheets` جزء من
   Project Platform V1 **المعتمدة والمُجمَّدة** (`project-platform-v1.0.0`).
   توسعتها تخالف التجميد. `ops_*` ليس مُجمَّدًا — وهو نطاق التشغيل الذي تخصّه
   Wave 3 أصلًا.

### ما لا تقرّره هذه الوثيقة

**مصير البيانات القائمة في `project_call_sheets`.** لا يمكن قراءة Production من
هنا، فعدد صفوفه **غير معلوم**. لذلك:

- ✅ ما تقرّره: **لا توسعة جديدة على `project_call_sheets`**، وكل بناء Wave 3 على
  `ops_*`.
- ⏸️ ما **لا** تقرّره: حذف أو ترحيل. أيّ ترحيل يحتاج (١) عدّ الصفوف على
  Production، (٢) قرار خالد. مسجَّل قرارًا: **W3-1 · PENDING ROW COUNT + OWNER
  DECISION**.
- 🔒 `project_call_sheets` يبقى **يعمل ويُقرأ** كما هو. لا كسر لواجهة قائمة.

---

## ٢. D-2 · أيّ عائلة دوال؟

تابعة لـD-1 بالضرورة — الدوال تخدم جداولها.

| العائلة | الدوال | الحكم |
|---|---|---|
| `prodops_call_sheet*` | `prodops_call_sheet` · `prodops_call_sheet_publish` | 🟢 **المعتمدة.** كل RPC جديد في Wave 3 ينضمّ إليها |
| `project_core_call_sheet_*` | `_save` · `_send` · `_send_to` | 🟡 **تبقى ولا تُوسَّع.** واجهة `projectcore/CallSheet.tsx` تستدعيها اليوم؛ حذفها كسر بلا مقابل |

⛔ **ولا تُنشأ عائلة ثالثة.** أيّ دالّة Call Sheet في Wave 3 تحمل البادئة
`prodops_`.

---

## ٣. D-3 · ثلاثة جداول مواقع — وأحدها ليس ازدواجًا

### 🔴 التصحيح الأهم: `custody_inventory_locations` ليس طرفًا في هذا الازدواج

| | ماذا يمثّل |
|---|---|
| `ops_locations` | **أين نصوّر** — استوديو · موقع خارجي · مقرّ عميل · قاعة |
| `project_locations` | **أين نصوّر**، لكن مُدخَلًا داخل مشروع واحد |
| `custody_inventory_locations` | 🔵 **أين تسكن المعدّات** — مستودع · مركبة · مركز صيانة، ومعها `responsible_user_id` |

الثالث ينتمي لنظام عهدة الأصول، ونوعه `warehouse`/`vehicle`/`maintenance_center`
وله مسؤول. **دمجه في سجلّ مواقع التصوير خطأ في النمذجة**: مستودع ليس موقع تصوير،
والمسؤول عن مخزن ليس مسؤول موقع. يبقى كما هو ولا يُمسّ.

فالازدواج الحقيقي **ثنائي**: `ops_locations` ⟷ `project_locations`.

### الأدلّة

| | `ops_locations` | `project_locations` |
|---|---|---|
| النطاق | 🟢 **سجلّ عام قابل لإعادة الاستخدام** | 🔴 `project_id` — لكلّ مشروع نسخته |
| التصنيف | 🟢 `kind` بستّ قيم مُقيَّدة | ❌ لا يوجد |
| التواصل | 🟢 اسم · هاتف · صفة · ملاحظة | ❌ لا يوجد |
| الوصول والمواقف | 🟢 `access_notes` · `parking_notes` | ❌ `note` واحد |
| الحالة | 🟢 `is_active` | ❌ لا يوجد |
| مرتبط به | 🟢 `ops_call_sheets.location_id` (FK) | لا شيء |

`ops_locations` **مُجمَّع أعمدة `project_locations` كلّها وزيادة**. والأهم أنّ
موقعًا كُتب في مشروع لا يوجد للمشروع التالي — وهو نقيض الغرض من سجلّ مواقع.

### القرار: 🟢 `ops_locations`

`project_locations` يُجمَّد كما `project_call_sheets`: يعمل، ويُقرأ، ولا يُوسَّع.
`location_media` (V2-3.4-B) يُبنى امتدادًا على `ops_locations`.
`custody_inventory_locations` **خارج النقاش** ولا يُمسّ.

---

## ٤. ما فتحه هذا الحسم وما أبقاه مغلقًا

| البند | الحالة بعد الحسم |
|---|---|
| V2-3.1-D الساعة الذهبية · V2-3.1-H `backup_date` | ✅ **مفتوح** — امتداد على `ops_call_sheets` |
| V2-3.1-E الطقس · V2-3.1-F تحذير الرياح | ✅ **مفتوح** — `ops_job_weather` يُعبَّأ |
| V2-3.1-G عرض عربي للطباعة | ✅ **مفتوح** — `OpsCallSheetPrint` قائم، يُقوَّم |
| V2-3.2-A سجلّ التصاريح | ✅ **مفتوح** — Extension Table على `ops_job_permits` |
| V2-3.2-C تنبيهات 30/7 يومًا | ✅ **مفتوح** — حدث في الـOutbox القائم، ❌ لا مجدول رابع (G8) |
| V2-3.4-B `location_media` | ✅ **مفتوح** — على `ops_locations` |
| V2-3.5-B البذرتان · V2-3.5-C البودكاست | ✅ **مفتوح** — بذور وتسلسل قائم، لا جدول حلقات |
| V2-3.6-A/B `calendar_tokens` + ICS | ✅ **مفتوح** — 🆕 حقيقيّ |
| ترحيل بيانات `project_call_sheets` / `project_locations` | ⏸️ **مغلق** — W3-1، يحتاج عدّ صفوف على Production + قرار خالد |

⛔ البنود المشطوبة في الـBrief (V2-3.1-B/C · V2-3.2-B/D · V2-3.3-A/B/C ·
V2-3.4-A/C · V2-3.5-A) تبقى مشطوبة. **لا تُبنى.**

---

## ٥. قرار ينتظر خالد

| # | القرار | التصنيف |
|---|---|---|
| **W3-1** | مصير الصفوف القائمة في `project_call_sheets` و`project_locations` بعد اعتماد `ops_*` مصدرًا | **PENDING ROW COUNT + OWNER DECISION** |

**كيف يُحسم بأمان** (لا تُشغَّل من هنا — للتنفيذ اليدويّ عند الحاجة):

```sql
select count(*) from public.project_call_sheets where is_deleted = false;
select count(*) from public.project_locations   where is_deleted = false;
```

- **صفر في الاثنين** ⇒ الازدواج ورقيّ فقط، ويكفي تجميدهما.
- **صفوف موجودة** ⇒ ترحيل مقصود بحزمة `PREFLIGHT/RUNME/POSTCHECK/ROLLBACK`
  مستقلّة، بقرار خالد. **لا حذف قبل ذلك.**
