"use client";
// إعدادات المنصّة المؤسسية — أعلام تشغيل/إيقاف كل وحدة. للمالك/الأدمن فقط (تُفرض في القاعدة).
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { custodyGetFlags, custodyUpdateFlags, DEFAULT_CUSTODY_FLAGS, type CustodyFlags } from "@/lib/portal/custodyEnterprise";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const GROUPS: { title: string; keys: { k: keyof CustodyFlags; ar: string; desc?: string }[] }[] = [
  { title: "التشغيل", keys: [
    { k: "qr_scanning_enabled", ar: "مسح QR" }, { k: "barcode_enabled", ar: "الباركود" },
    { k: "custody_kits_enabled", ar: "الحقائب/الأطقم" }, { k: "asset_components_enabled", ar: "الملحقات والأجزاء" },
    { k: "project_linking_enabled", ar: "ربط المشروع" }, { k: "employee_signature_enabled", ar: "التوقيع الإلكتروني" },
    { k: "detailed_conditions_enabled", ar: "الفحص الثلاثي للحالة" }, { k: "overdue_alerts_enabled", ar: "تنبيهات التأخير" },
    { k: "incident_reporting_enabled", ar: "بلاغات الحوادث" }, { k: "purchase_requests_enabled", ar: "طلبات الشراء" },
    { k: "maintenance_vendor_billing_enabled", ar: "فوترة صيانة المورد" },
  ]},
  { title: "تكاملات وخصوصية (للمالك)", keys: [
    { k: "gps_sessions_enabled", ar: "جلسات تتبّع الموقع", desc: "تتبّع جلسة المهمة فقط بموافقة — معطّل حتى اعتماد سياسة الخصوصية." },
    { k: "external_trackers_enabled", ar: "أجهزة تتبّع خارجية" },
    { k: "client_rental_portal_enabled", ar: "بوابة التأجير", desc: "معطّلة حتى اعتماد النص القانوني والتسعير." },
    { k: "depreciation_enabled", ar: "الإهلاك والقيمة الدفترية" }, { k: "zoho_asset_sync_enabled", ar: "مزامنة Zoho للأصول" },
    { k: "insurance_claims_enabled", ar: "التأمين والمطالبات" }, { k: "custody_offline_enabled", ar: "الوضع دون اتصال" },
    { k: "custody_mobile_app_enabled", ar: "تطبيق الجوال" },
  ]},
];

export default function CustodyEnterpriseSettings() {
  const { t } = useI18n();
  const [f, setF] = useState<CustodyFlags>(DEFAULT_CUSTODY_FLAGS);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3200); };
  useEffect(() => { void custodyGetFlags().then((r) => setF(r.ok ? { ...DEFAULT_CUSTODY_FLAGS, ...r.data } : DEFAULT_CUSTODY_FLAGS)); }, []);

  async function toggle(k: keyof CustodyFlags) {
    if (busy) return;
    setBusy(true);
    const r = await custodyUpdateFlags({ [k]: !(f[k] === true) } as Partial<CustodyFlags>);
    setBusy(false);
    if (!r.ok) { flash((/not authorized/.test(r.error) ? "غير مصرّح — للمالك/الأدمن فقط." : "تعذّر الحفظ: " + r.error)); return; }
    setF({ ...f, ...r.data }); flash("حُفظ الإعداد.");
  }
  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button disabled={busy} onClick={onClick} className={`w-11 h-6 rounded-full transition ${on ? "bg-red-600" : "bg-stone-700"} relative shrink-0`}>
      <span className={`absolute top-0.5 ${on ? "left-0.5" : "right-0.5"} w-5 h-5 bg-white rounded-full`} /></button>
  );

  return (
    <div className="space-y-4">
      {GROUPS.map((g) => (
        <section key={g.title} className={card}>
          <h3 className="text-sm font-medium text-white mb-3">{g.title}</h3>
          <div className="space-y-3">
            {g.keys.map((it) => (
              <div key={it.k} className="flex items-start gap-3">
                <Toggle on={f[it.k] === true} onClick={() => void toggle(it.k)} />
                <div><div className="text-sm text-stone-200">{it.ar}</div>{it.desc && <div className="text-[11px] text-stone-500">{it.desc}</div>}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="text-[11px] text-stone-500">{t({ ar: "الوحدات خلف أعلام مطفأة تبقى مخفية وآمنة حتى تشغيل SQL الخاص بها وتفعيل العلم.", en: "Flag-gated modules stay hidden until their SQL runs and the flag is on." })}</p>
      {toast && <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}
