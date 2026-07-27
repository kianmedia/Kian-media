# حالة خارطة التنفيذ الذاتي — Autonomous Roadmap State

> **هذا الملف هو مصدر الحقيقة الوحيد لاستئناف العمل.**
> عند بدء أي جلسة: اقرأ هذا الملف أولًا، قبل أي شيء آخر.
>
> آخر تحديث: **2026-07-27** · الفرع: `main` · آخر Commit مسجّل: `e592406`

---

## قواعد الاستئناف (اقرأها قبل التنفيذ)

1. ابدأ من **أول عنصر ليس `DONE`** في الجدول أدناه.
2. إذا وُجدت مرحلة `IN_PROGRESS` → **أكملها ولا تبدأ مرحلة جديدة**.
3. إذا وُجدت `BLOCKED_MANUAL` → نفّذ كل ما يمكن حولها، ثم انتقل إلى **أول عنصر مستقل** لا يعتمد عليها.
4. حدّث الحالة **قبل** كل Commit، وحدّث `next_action` **بعد** كل Commit.
5. لا تعتبر ميزة مكتملة لمجرد وجود SQL أو RPC أو Component — يجب أن تكون **مربوطة بصفحة حقيقية وتعمل**.
6. لا تدّعِ نشرًا على Production دون دليل (ترويسة حيّة، أو استجابة API، أو SHA منشور).

### مفتاح الحالات

| الحالة | المعنى |
|---|---|
| `TODO` | لم يبدأ |
| `IN_PROGRESS` | قيد التنفيذ — أكمله قبل أي شيء آخر |
| `BLOCKED_MANUAL` | يحتاج إجراءً لا أملك صلاحيته → انظر `MANUAL_ACTIONS_QUEUE.md` |
| `DONE` | مكتمل ومختبر ومدفوع |

---

## الجدول الرئيسي

| phase_id | phase_name | status | current_subtask | last_completed_action | next_action | last_commit | pushed | prod_verified | tests | blockers | updated_at |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **P0** | إغلاق Public Portal Hardening Phase 2 | `DONE` | — | إغلاق توثيقي + إصلاح `favicon.ico` 404؛ tsc نظيف · 767/767 · build exit 0 | — (مُغلقة) | `2ee18e1` | ⏸️ `M-000` | ✅ 13/15 | 767/767 | `M-001` حضور · `M-004` سجلات | 2026-07-27 |
| **P1** | العمود الفقري: البريد والإشعارات | `IN_PROGRESS` | P1.0 استطلاع | إطلاق استطلاع 8 محاور + تحقّق عدائي؛ تثبّتُ مستقلًّا أن Idempotency والعامل والمُرسِل الصادق موجودة فعلًا | استلام خطة الاستطلاع وتقسيمها إلى P1.1..P1.n | — | — | — | — | `M-002` نشر Apps Script | 2026-07-27 |
| **P2** | Privileged Account MFA (TOTP) | `TODO` | — | — | فحص مسارات Login/Session/Role Guards | — | — | — | — | تسجيل المالك يدوي | — |
| **P3** | Production Operations V1 | `TODO` | — | — | جرد ما هو موجود قبل إنشاء أي جدول | — | — | — | — | — | — |
| **P3.1** | Call Sheets | `TODO` | — | — | فحص `shoot_sessions` وأي بنية Call Sheet قائمة | — | — | — | — | — | — |
| **P3.2** | الجدولة والتعارضات | `TODO` | — | — | إعادة استخدام محرك تعارضات 4B الموجود | — | — | — | — | — | — |
| **P3.3** | Daily Production Reports | `TODO` | — | — | — | — | — | — | — | — | — |
| **P3.4** | Media Backup Tracking | `TODO` | — | — | — | — | — | — | — | — | — |
| **P3.5** | Equipment & Custody V2 | `TODO` | — | — | إكمال العهدة الموجودة — **ممنوع إعادة بنائها** | — | — | — | — | — | — |
| **P3.6** | Operations Command Dashboard | `TODO` | — | — | التركيب فوق 7B الموجود | — | — | — | — | — | — |
| **P4** | Financial & Commercial Operations V1 | `TODO` | — | — | جرد Zoho + العملاء + العروض قبل أي إنشاء | — | — | — | — | — | — |
| **P4.1** | CRM & Sales Pipeline | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.2** | Lead Scoring (قواعد صريحة) | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.3** | Smart Quotation Builder | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.4** | Project Profitability | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.5** | Vendors & Expenses | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.6** | Retainers & Production Credits | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.7** | Collection & Management Reports | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.8** | Zoho Integration Stabilization | `TODO` | — | — | — | — | — | — | — | Zoho creds | — |
| **P5** | External Excellence V1 | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.1** | Professional Case Studies | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.2** | Vendor & Compliance Center | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.3** | Talent / Freelancers / Vendors DB | `TODO` | — | — | تطوير مركز الفرص — **ممنوع نظام منفصل** | — | — | — | — | — | — |
| **P5.4** | Client Executive Reports | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.5** | Live Operations Dashboard | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.6** | PWA | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.7** | Kian AI Assistant | `TODO` | — | — | **لا يبدأ قبل استقرار كل ما قبله** · Flag = OFF | — | — | — | — | — | — |
| **P6** | Final System Audit & Acceptance | `TODO` | — | — | — | — | — | — | — | — | — |

---

## مراحل مغلقة سابقًا (لا تُعاد)

| المرحلة | الحالة | الوسم | ملاحظة |
|---|---|---|---|
| Project Platform V1 | ✅ **مجمّدة ومعتمدة** | `project-platform-v1.0.0` @ `75d16cd` | ممنوع إضافة مزايا؛ التعديل فقط لتكامل ضروري مثبت + Regression Tests |
| Public Portal Hardening Phase 2 | 🔄 قيد الإغلاق التوثيقي (P0) | — | لا ثغرة حرجة مفتوحة |

---

## قيود ثابتة عبر كل المراحل

- ❌ لا جداول أو أنظمة موازية لوظائف موجودة — افحص أولًا.
- ❌ لا عقد إشعارات جديد · لا طابور بريد ثانٍ · لا مزوّد موازٍ · لا Cron لكل وحدة.
- ❌ لا WhatsApp إرسالًا فعليًا في هذه الخارطة — أحداث جاهزة فقط.
- ❌ لا `DROP` ولا حذف بيانات Production · كل SQL إضافي و idempotent.
- ❌ لا `reset --hard` ولا `force push` ولا حذف عمل محلي.
- ✅ العربية والإنجليزية + RTL + الجوال والتابلت إلزامية في كل واجهة جديدة.
- ✅ الحماية على الخادم أو في قاعدة البيانات — **إخفاء الزر ليس حماية**.
- ✅ Audit Log للعمليات المهمة · Feature Flags لما لم يُفعّل بعد.
- ✅ لا تُعرض قيم DB الإنجليزية للمستخدم النهائي.
- ✅ لا تُسجَّل أسرار ولا رموز MFA ولا بيانات عملاء في السجلات.
