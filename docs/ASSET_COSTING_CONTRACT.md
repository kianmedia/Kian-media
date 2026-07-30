# عقد تكلفة الأصول

سطحان منفصلان **عمدًا**، ولا جسر بينهما:

| السطح | الدالّة | مَن يراه | يحمل مالًا؟ |
|---|---|---|---|
| تشغيليّ | `custody_inv_asset_utilization(asset, from, to)` | `civ_can_view_assets()` | ❌ **أبدًا** |
| مالكيّ | `custody_inv_asset_cost_summary(asset)` | `civ_can_view_asset_sensitive_costs()` | ✅ |

الفصل ليس تجميلًا: العمليات تحتاج أن تعرف أنّ الكاميرا مشغولة حتى الخميس؛ لا
تحتاج أن تعرف كم كلّفت. ودمج السطحين في دالّة واحدة «تُخفي الأعمدة حسب الدور» هو
كيف يتسرّب رقم في أوّل تعديل يغفل عن الشرط.

---

## ١) السطح التشغيليّ — بلا مال

يُرجع: `days_in_period` · `days_out` · `days_idle` · `downtime_days` ·
`times_issued` · `utilization_pct` · `availability_pct` · `state` — و
`contains_financials: false` **معلنة في الردّ نفسه** كي تستطيع الواجهة أن تؤكّد
ما تعرضه بدل أن تفترضه.

- `days_out` = تقاطع نافذة كلّ بند عهدة مع نافذة القياس. بند بلا `returned_at`
  يُحسب حتّى `expected_return_at` أو نهاية النافذة.
- `downtime_days` = من `sent_at` إلى `returned_at` لأوامر الصيانة المتقاطعة.
- `days_idle` = الباقي بعد الصرف والتعطّل، ولا ينزل تحت الصفر.

لا يظهر في جسم هذه الدالّة أيّ من: `purchase_price` · `current_value` ·
`book_value` · `salvage_value` · `cost`. هذا مفروض باختبار وبفحص في POSTCHECK.

---

## ٢) السطح المالكيّ — ما يحويه بالضبط

```
acquisition        purchase_price · purchase_date · supplier_name · current_value
                   book_value · salvage_value · useful_life_months
                   accumulated_depreciation
maintenance        maintenance_total · repair_total
rental_replacement total (أو null) · source_available
total_cost_of_ownership
usage              usage_hours · sessions        (من دفتر الاستخدام)
cost_per_hour · cost_per_session
utilization        (السطح التشغيليّ مضمَّنًا)
replacement_recommendation
sources            أيّ مصدر شارك فعلًا
```

### الإهلاك
خطّيّ: `(purchase_price − salvage_value) / useful_life_months × الأشهر المنقضية`،
**محدودًا** بـ`least(...)` حتّى لا يتجاوز المتراكمُ قيمةَ الأصل بعد انقضاء العمر
الافتراضيّ. `salvage_value` عمود جديد بقيد `>= 0`.

### توصية الاستبدال — قاعدة معلنة لا حكم
| الشرط | التوصية |
|---|---|
| تكلفة الصيانة ≥ ٥٠٪ من سعر الشراء | `replace_review` |
| الاستغلال < ١٠٪ | `underused` |
| الاستغلال > ٨٠٪ | `overused_consider_second_unit` |
| غير ذلك | `keep` |

---

## ٣) 🚫 لا استنتاج ربح

هذا هو القيد الأهمّ في الملفّ.

`custody_inv_asset_cost_summary` **لا تلمس أيّ جدول مالي**. الممنوع بالاسم:
`fin_*` · `invoices` · `quotes` · `opportunities` · `sq_*` · `crm_*` · `zoho*`
— أي لا فواتير ولا عروض أسعار ولا فرص بيع ولا مزامنة محاسبية. مصادرها الوحيدة:

1. أعمدة الأصل نفسه،
2. `custody_inventory_maintenance.cost` (وتقاربها `final_cost`/`approved_cost`
   إن وُجدت)،
3. `custody_inventory_meter_readings`،
4. `custody_rental_items.total_price` — **إن كانت حزمة الإيجار مطبَّقة**.

وتُرجع `sources.finance_tables: false` تصريحًا.

**لماذا:** ربط تكلفة أصل بإيراد مشروع يُنتج «ربح المشروع» من باب خلفيّ. الربح
سطح مالكيّ له عقده الخاصّ ومكانه الخاص، ولا يُستنتج من نافذة معدّات. أيّ تعديل
مستقبليّ يضيف `join` إلى جدول إيراد يخرق هذا العقد ويكسر الاختبار
`tests/asset_authz_and_costing.test.js`.

---

## ٤) 🚫 لا صفر يقف مقام «غير مفعّل»

مصدر غائب يُعلَن `null` مع `source_available: false` — **لا صفر**.

الصفر يكذب: «تكلفة استبدال بالإيجار = ٠» تعني «لم نستأجر بديلًا قطّ»، بينما
الحقيقة قد تكون «وحدة الإيجار غير مطبّقة أصلًا فلا نعرف». القرار الذي يُبنى على
الأوّل مختلف تمامًا.

المصادر الاختيارية المُعلَنة: `rental` · `meter_readings` · `maintenance`.

---

## ٥) مَن يرى، ومَن لا يرى

| | مالك | مالية | مدير عهدة | `assets.view` | موظّف |
|---|---|---|---|---|---|
| الاستغلال والتعطّل والتوافر | ✅ | ✅ | ✅ | ✅ | ⛔ |
| سعر الشراء والقيمة الدفترية | ✅ | ✅ | ⛔ | ⛔ | ⛔ |
| تكلفة الصيانة والإصلاح | ✅ | ✅ | ⛔ | ⛔ | ⛔ |
| تكلفة الساعة/الجلسة وتوصية الاستبدال | ✅ | ✅ | ⛔ | ⛔ | ⛔ |

`civ_can_view_asset_sensitive_costs()` = `is_owner()` أو `civ_can_finance()`،
**ولا يُمنَح بمفتاح صلاحية دقيق** — لا يُفتح هذا السطح بترقية مهنة. الرفض يخرج
بـ`42501` لا برسالة عامّة.

> ملاحظة تقنيّة: `civ_can_finance()` غير ملفوفة بـ`coalesce` في مصدرها وقد تعيد
> `NULL`. تُلَفّ **هنا** عند الاستهلاك، ولا يُعاد تعريفها هناك: إعادة تعريفها
> تكسر مواضع نداء خارج نطاق هذه الحزمة.

---

## ٦) ما لا يفعله هذا العقد

- لا يحسب استهلاكًا ضريبيًّا ولا يلتزم معيارًا محاسبيًّا — الإهلاك هنا **إداريّ**
  لدعم قرار الاستبدال، لا لإقفال دفاتر.
- لا يوزّع التكلفة على المشاريع. توزيعٌ كهذا يقود مباشرةً إلى ربح المشروع.
- لا يسعّر إيجارًا داخليًّا. `custody_rental_charges` القائم يفعل ذلك في نطاقه.
- لا يكتب شيئًا: الدالّتان `stable` وقراءة فقط.
