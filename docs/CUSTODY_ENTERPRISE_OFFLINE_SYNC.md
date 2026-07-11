# Custody Enterprise — Offline Sync

## المبدأ
Outbox محلي على الجهاز + idempotency في القاعدة تمنع تكرار نفس العملية.

## التدفق
1. أثناء عدم الاتصال: يُنشئ الجهاز عملية بـ `client_operation_id` (UUID) + `payload_hash` + `device_id` + `sync_status=pending`.
2. عند المزامنة: يستدعي `custody_offline_claim(p_client_op, p_type, p_hash, p_device)`:
   - يعيد `{new:true}` ⇒ نفّذ العملية الفعلية (صرف/إرجاع/بلاغ) عبر الـ RPC المناسب.
   - يعيد `{new:false, status, result_ref}` ⇒ سبق تطبيقها؛ **لا تُنفّذ مجددًا** (منع التكرار).
3. بعد التنفيذ: `custody_offline_finalize(p_client_op, 'applied'|'conflict'|'failed', result_ref, error)`.
4. **إعادة تحقق التوفّر** عند المزامنة: الـ RPCs الفعلية (self_issue/issue_kit) تقفل الأصول وتتحقق؛ إن أصبح
   الأصل غير متاح ⇒ لا صرف وهمي، بل حالة `conflict` تُعرض للمستخدم لحلّها.

## القواعد
- الصور تبقى «Pending Upload» حتى نجاح رفعها (للـ evidence bucket بمسار يبدأ بـ uid الموظف).
- لا تُغلق العهدة محليًا قبل تأكيد الخادم.
- شاشة العمليات المعلّقة/التعارضات/إعادة المحاولة/إلغاء المسودة.
- خلف علم `custody_offline_enabled` (معطّل حتى الاعتماد). ويب PWA + جوال يشتركان نفس منطق القاعدة.

## الويب (PWA)
service worker + IndexedDB outbox (يُستكمل). الجوال: SecureStore/SQLite outbox.
