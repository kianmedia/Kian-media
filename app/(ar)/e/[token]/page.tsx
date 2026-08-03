"use client";
// ════════════════════════════════════════════════════════════════════════════
// /e/<token> — صفحة حالة الأصل التي يقود إليها ملصق QR.
//
// Wave 6 · V2-6.1-A
//
// ★★ 🔴 هذه الصفحة **ليست عامّة**، وهذا مقصود ★★
// `docs/QR_SECURITY_CONTRACT.md` §٥ صريح: «لا بحث مجهول الهوية في V1. الاختيار
// متعمّد: بحث عامّ ولو بحمولة فقيرة يعطي مجهولًا القدرة على **تأكيد أنّ رمزًا
// ما حقيقيّ**». والـBrief نفسه يقول «تخضع لـQR_SECURITY_CONTRACT.md وتراعي
// صلاحية المشاهد» — فالعقد هو الحاكم.
//
// ولذلك الزائر بلا جلسة يرى رسالة **محايدة واحدة** لا تقول إن كان الرمز صحيحًا
// أو مختلَقًا. أيّ تمييز بين الحالتين يُحوّل الصفحة إلى أداة تحقّق من الرموز.
//
// ★ ولا تُنادى الحمولة مباشرةً ★
// `custody_inv_qr_public_payload` مسحوبة من الجميع. المدخل الوحيد
// `custody_inv_qr_scan`، وفيها يقع تحديد المعدّل (٦٠/دقيقة) والتسجيل والتدقيق
// وتدرّج الحمولة حسب الدور. تجاوزها يعني حدًّا قابلًا للتجاوز.
//
// ⛔ ولا يظهر هنا: سعر · قيمة دفترية · اسم موظّف · مسار تخزين · أيّ uuid.
//    المصفاة في القاعدة، وهذه الصفحة لا تضيف حقلًا لم يصلها.
// ════════════════════════════════════════════════════════════════════════════
import { use, useEffect, useState } from "react";
import { prpc } from "@/lib/portal/client";

type Phase =
  | { k: "loading" }
  | { k: "anon" }
  | { k: "denied" }
  | { k: "rate_limited" }
  | { k: "not_found" }
  | { k: "revoked" }
  | { k: "needs_migration" }
  | { k: "error" }
  | { k: "ok"; data: Record<string, unknown> };

/** ما يجوز عرضه — قائمة بيضاء مطابقة لعقد الأمان. */
const FIELDS: { key: string; ar: string }[] = [
  { key: "asset_code", ar: "رمز الأصل" },
  { key: "asset_name", ar: "الاسم" },
  { key: "brand", ar: "الماركة" },
  { key: "model", ar: "الطراز" },
  { key: "asset_type", ar: "النوع" },
  { key: "category", ar: "الفئة" },
  { key: "unit", ar: "الوحدة" },
  { key: "location", ar: "الموقع" },
  { key: "availability_status", ar: "التوفّر" },
  { key: "condition_status", ar: "الحالة" },
  { key: "condition_grade", ar: "التقدير" },
  { key: "owner_org", ar: "الجهة المالكة" },
  // تفصيل تشغيليّ يزيده الخادم لمن يملك الصلاحية — ولا تطلبه هذه الصفحة.
  { key: "serial_number", ar: "الرقم التسلسليّ" },
  { key: "warranty_expiry_date", ar: "انتهاء الضمان" },
  { key: "expected_return_at", ar: "العودة المتوقّعة" },
  { key: "open_maintenance", ar: "أوامر صيانة مفتوحة" },
  { key: "active_reservations", ar: "حجوزات نشطة" },
];

export default function AssetStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [phase, setPhase] = useState<Phase>({ k: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      // شكل الرمز يُفحص قبل أيّ نداء — لا طلب على مدخل فاسد.
      if (!/^[0-9a-f-]{36}$/i.test(token)) { if (alive) setPhase({ k: "anon" }); return; }
      const r = await prpc<Record<string, unknown>>("custody_inv_qr_scan", {
        p_token: token, p_context: "public_page",
      });
      if (!alive) return;
      if (r.ok) { setPhase({ k: "ok", data: (r.data ?? {}) as Record<string, unknown> }); return; }

      const e = String(r.error ?? "");
      // 🔴 غير المسجَّل يُعامَل كالمجهول تمامًا: نفس الرسالة المحايدة.
      if (r.status === 401 || /not_authenticated/i.test(e)) { setPhase({ k: "anon" }); return; }
      if (/42501|not authorized/i.test(e)) { setPhase({ k: "denied" }); return; }
      if (/54000|rate/i.test(e)) { setPhase({ k: "rate_limited" }); return; }
      if (/qr_revoked/i.test(e)) { setPhase({ k: "revoked" }); return; }
      if (/qr_not_found/i.test(e)) { setPhase({ k: "not_found" }); return; }
      if (/PGRST202|42883|does not exist/i.test(e)) { setPhase({ k: "needs_migration" }); return; }
      setPhase({ k: "error" });
    })();
    return () => { alive = false; };
  }, [token]);

  return (
    <main id="main" dir="rtl" lang="ar"
      style={{ background: "#050505", color: "#fff", minHeight: "70vh" }}>
      <div style={{ maxWidth: "560px", margin: "0 auto", padding: "clamp(70px,10vw,120px) 22px 70px" }}>
        <div className="eyebrow" style={{ marginBottom: "10px" }}>كيان ميديا</div>
        <h1 className="editorial" style={{ fontSize: "clamp(22px,4vw,32px)", marginBottom: "18px" }}>
          حالة الأصل
        </h1>
        <Body phase={phase} />
      </div>
    </main>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: "14px", lineHeight: 2, color: "rgba(255,255,255,0.65)" }}>{children}</p>;
}

function Body({ phase }: { phase: Phase }) {
  switch (phase.k) {
    case "loading":
      return <Note>جارٍ التحقّق…</Note>;

    // 🔴 الرسالة المحايدة. لا تقول «رمز غير صحيح» ولا «سجّل الدخول لترى الأصل»:
    //    كلاهما يؤكّد أو ينفي وجود الرمز لمن لا يملك حسابًا.
    case "anon":
      return (
        <Note>
          هذه الصفحة مخصّصة لفريق كيان ميديا. إن كنت من الفريق فسجّل الدخول ثمّ
          أعد فتح الرابط. وإن وجدت هذا الملصق على معدّة، فيرجى التواصل معنا عبر
          موقعنا.
        </Note>
      );

    case "denied":
      return <Note>حسابك لا يملك صلاحية عرض بيانات الأصول.</Note>;

    case "rate_limited":
      return <Note>عدد كبير من عمليات المسح خلال وقت قصير. انتظر دقيقة ثمّ أعد المحاولة.</Note>;

    // ⛔ «غير موجود» و«ملغى» يُعرضان لموظّف فقط — الخادم لا يصل بهما إلى مجهول.
    case "not_found":
      return <Note>هذا الرمز غير معروف في السجلّ.</Note>;
    case "revoked":
      return <Note>هذا الملصق أُلغي. اطلب ملصقًا جديدًا من مسؤول العهدة.</Note>;

    case "needs_migration":
      return <Note>هذه الميزة بانتظار تفعيل قاعدة البيانات. ليست مشكلة في حسابك.</Note>;

    case "error":
      return <Note>تعذّر التحقّق الآن. أعد المحاولة بعد قليل.</Note>;

    case "ok": {
      const shown = FIELDS.filter((f) => {
        const v = phase.data[f.key];
        return v !== null && v !== undefined && v !== "";
      });
      if (shown.length === 0) return <Note>لا تفاصيل متاحة لهذا الأصل.</Note>;
      return (
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", fontSize: "14px" }}>
          {shown.map((f) => (
            <div key={f.key} style={{ display: "contents" }}>
              <dt style={{ color: "rgba(255,255,255,0.45)" }}>{f.ar}</dt>
              <dd style={{ margin: 0, color: "rgba(255,255,255,0.9)" }}>{String(phase.data[f.key])}</dd>
            </div>
          ))}
        </dl>
      );
    }
  }
}
