// ════════════════════════════════════════════════════════════════════════
// عقد تأجير معدّات — كيان ميديا (Kian Media / كيان الابتكار)
//
// نص عقد تشغيلي واضح يُعرض للمستأجر قبل التوقيع (رابط "عرض العقد كاملًا").
// يُبنى ديناميكيًا ببيانات الطلب عند توفّرها؛ وإلا يشير إلى "الطلب المرفق".
// يُقدَّم كنص افتراضي متين — وإن وفّرت الإدارة نصًّا معتمدًا في قاعدة البيانات
// (consent_text) فهو الذي يُعرض ويُخزَّن مع التوقيع.
// ملاحظة داخلية للإدارة (غير ظاهرة للعميل): يُنصح باعتماد الصياغة من مستشار
// قانوني قبل الاعتماد النهائي للاستخدام الخارجي واسع النطاق.
// ════════════════════════════════════════════════════════════════════════

export interface RentalContractDetails {
  request_number?: string | null;
  renter_name?: string | null;
  id_type?: string | null;
  id_number?: string | null;
  phone?: string | null;
  address?: string | null;
  rental_from?: string | null; // نص جاهز للعرض (بتوقيت الرياض)
  rental_to?: string | null;
  delivery_location?: string | null;
  return_location?: string | null;
  items?: { name: string; quantity?: number }[];
  deposit?: string | null;
}

const dash = "—";
const orDash = (v?: string | null) => (v && String(v).trim() ? String(v).trim() : dash);

/** يبني نص عقد التأجير بالعربية مع إدراج بيانات الطلب المتوفّرة. */
export function buildRentalContractAr(d: RentalContractDetails = {}): string {
  const itemsBlock =
    d.items && d.items.length > 0
      ? d.items.map((it, i) => `   ${i + 1}. ${it.name}${it.quantity ? ` — الكمية: ${it.quantity}` : ""}`).join("\n")
      : "   المعدّات الموضّحة في هذا الطلب/الفاتورة المرفقة.";

  return `عقد تأجير معدّات
مؤسسة كيان للإنتاج الإعلامي (كيان ميديا) — المملكة العربية السعودية

رقم الطلب: ${orDash(d.request_number)}
تاريخ الاستلام (بداية التأجير): ${orDash(d.rental_from)}
تاريخ الإرجاع (نهاية التأجير): ${orDash(d.rental_to)}   — التوقيت بتوقيت الرياض.

أولًا: أطراف العقد
الطرف الأول (المؤجِّر): كيان ميديا — المالك القانوني للمعدّات محل هذا العقد.
الطرف الثاني (المستأجِر):
   • الاسم: ${orDash(d.renter_name)}
   • الهوية: ${orDash(d.id_type)} — رقم: ${orDash(d.id_number)}
   • الجوال: ${orDash(d.phone)}
   • العنوان: ${orDash(d.address)}

ثانيًا: محل العقد (المعدّات المؤجَّرة)
${itemsBlock}
تُعدّ الصور الملتقطة عند الاستلام جزءًا لا يتجزأ من هذا العقد، وهي المرجع المعتمد لإثبات حالة المعدّات وقت التسليم.

ثالثًا: مدة التأجير
تبدأ من تاريخ الاستلام وتنتهي في تاريخ الإرجاع المذكورَين أعلاه. أي استخدام بعد موعد الإرجاع يُعدّ تأخيرًا يخضع لبند الغرامات.

رابعًا: قيمة الإيجار والوديعة التأمينية
1. يلتزم المستأجر بسداد قيمة الإيجار الموضّحة في الطلب/الفاتورة.
2. تُحصَّل وديعة تأمينية (${orDash(d.deposit)}) تُعاد بعد فحص المعدّات والتأكد من سلامتها، ويجوز الخصم منها لتغطية أي تلف أو نقص أو تأخير.

خامسًا: التزامات المستأجر
1. استخدام المعدّات في الغرض المخصّص لها وبطريقة فنية سليمة، وحفظها في بيئة آمنة.
2. عدم تأجير المعدّات من الباطن أو التنازل عنها للغير أو إخراجها من المملكة دون إذن كتابي مسبق من المؤجِّر.
3. عدم إجراء أي إصلاح أو تعديل أو فتح لأجهزة المعدّات، والرجوع للمؤجِّر عند أي خلل.
4. المحافظة على الملحقات والحقائب والكوابل المسلّمة مع كل جهاز وإعادتها كاملة.

سادسًا: المسؤولية عن التلف والفقد
1. يتحمّل المستأجر كامل المسؤولية عن أي تلف أو فقد أو سرقة تقع على المعدّات خلال مدة العقد.
2. في حال التلف: يتحمّل المستأجر تكلفة الإصلاح. وفي حال الفقد أو التلف الكلي: يتحمّل قيمة الاستبدال بالقيمة السوقية للجهاز.
3. تُوثَّق أي أضرار بالصور عند الإرجاع، وتُحتسب المستحقّات ويجوز خصمها من الوديعة، وما زاد يُطالَب به المستأجر عبر فاتورة.

سابعًا: الاستلام والإرجاع والفحص
1. يُقرّ المستأجر بأنه استلم المعدّات سليمة ومطابقة للوصف وقت التسليم (بحسب الصور المرفقة).
2. يلتزم بإرجاع المعدّات بذات الحالة، في الموعد والموقع المتفق عليهما.
3. لا يُعدّ الطلب مغلقًا إلا بعد فحص المؤجِّر واعتماده للإرجاع.

ثامنًا: غرامة التأخير
يخضع أي تأخير في الإرجاع عن الموعد المتفق عليه لرسوم تأخير وفق سياسة المؤجِّر المعلنة، دون الإخلال بحقّه في المطالبة بأي أضرار.

تاسعًا: الإلغاء والقوة القاهرة
1. يخضع إلغاء الطلب قبل الاستلام لسياسة الإلغاء المعتمدة لدى المؤجِّر.
2. لا يُسأل أي طرف عن الإخلال الناتج عن قوة قاهرة خارجة عن إرادته، على أن يُخطر الطرف الآخر فورًا.

عاشرًا: الاختصاص القضائي
يخضع هذا العقد ويُفسَّر وفق أنظمة المملكة العربية السعودية، وتختص الجهات القضائية المختصة بالمملكة بالفصل في أي نزاع ينشأ عنه.

حادي عشر: الإقرار
بالتوقيع أدناه يُقرّ المستأجر بأنه قرأ هذا العقد وفهم بنوده ووافق عليها، وأن البيانات التي أدخلها صحيحة، وأن الصور المرفقة تمثّل حالة المعدّات وقت الاستلام.`;
}

/** نص إنجليزي مختصر مكافئ (احتياطي عند اختيار الإنجليزية). */
export function buildRentalContractEn(d: RentalContractDetails = {}): string {
  const items =
    d.items && d.items.length > 0
      ? d.items.map((it, i) => `   ${i + 1}. ${it.name}${it.quantity ? ` — Qty: ${it.quantity}` : ""}`).join("\n")
      : "   The equipment listed in the attached request/invoice.";
  return `Equipment Rental Agreement
Kian Media Production — Kingdom of Saudi Arabia

Request No.: ${orDash(d.request_number)}
Pickup (start): ${orDash(d.rental_from)}
Return (end): ${orDash(d.rental_to)}   (Asia/Riyadh time)

1. Parties
Lessor: Kian Media — legal owner of the equipment.
Lessee: ${orDash(d.renter_name)} — ID ${orDash(d.id_type)} ${orDash(d.id_number)}, phone ${orDash(d.phone)}, address ${orDash(d.address)}.

2. Equipment
${items}
Photos taken at handover are an integral part of this agreement and are the reference for the equipment's condition at delivery.

3. Term — from pickup to return above. Use beyond the return date is a delay subject to Clause 8.

4. Rent & Security Deposit — the Lessee pays the rent shown in the request/invoice; a refundable security deposit (${orDash(d.deposit)}) may be used to cover damage, loss, or delay.

5. Lessee's Obligations — proper professional use; no sub-letting, assignment, or taking the equipment outside KSA without prior written consent; no repairs/modifications; return all accessories.

6. Damage & Loss — the Lessee bears full liability for any damage, loss, or theft during the term: repair cost for damage; market replacement value for loss/total damage. Amounts are documented by return photos and may be deducted from the deposit; any excess is invoiced.

7. Handover, Return & Inspection — the Lessee acknowledges receiving the equipment sound and as described; must return it in the same condition, on time and at the agreed location; the request is closed only after the Lessor's inspection and approval.

8. Late Fee — late return incurs late fees per the Lessor's policy, without prejudice to any damages claim.

9. Cancellation & Force Majeure — cancellation before pickup follows the Lessor's policy; neither party is liable for breach due to force majeure, with prompt notice.

10. Governing Law — this agreement is governed by the laws of the Kingdom of Saudi Arabia; the competent Saudi courts have jurisdiction over disputes.

11. Acknowledgement — by signing, the Lessee confirms reading and accepting this agreement, that the entered data is correct, and that the attached photos represent the equipment's condition at pickup.`;
}
