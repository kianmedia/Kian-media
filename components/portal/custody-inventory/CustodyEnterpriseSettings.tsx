"use client";
// إعدادات المنصّة المؤسسية — أعلام تشغيل/إيقاف كل وحدة. للمالك/الأدمن فقط (تُفرض في القاعدة).
// تُعرض الشاشة دائمًا (لا شرط دائري): إن لم يُشغَّل SQL تظهر رسالة واضحة + اسم الملف.
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { custodyGetFlags, custodyUpdateFlags, DEFAULT_CUSTODY_FLAGS, type CustodyFlags } from "@/lib/portal/custodyEnterprise";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const GROUPS: { title: string; en: string; keys: { k: keyof CustodyFlags; ar: string; en: string; desc?: string; ext?: boolean }[] }[] = [
  { title: "التشغيل", en: "Operational", keys: [
    { k: "qr_scanning_enabled", ar: "مسح QR", en: "QR scanning" }, { k: "barcode_enabled", ar: "الباركود", en: "Barcode" },
    { k: "custody_kits_enabled", ar: "الحقائب/الأطقم", en: "Kits" }, { k: "asset_components_enabled", ar: "الملحقات والأجزاء", en: "Components" },
    { k: "project_linking_enabled", ar: "ربط المشروع", en: "Project linking" }, { k: "employee_signature_enabled", ar: "التوقيع الإلكتروني", en: "E-signature" },
    { k: "detailed_conditions_enabled", ar: "الفحص الثلاثي للحالة", en: "3-stage conditions" }, { k: "overdue_alerts_enabled", ar: "تنبيهات التأخير", en: "Overdue alerts" },
    { k: "incident_reporting_enabled", ar: "بلاغات الحوادث", en: "Incident reports" }, { k: "purchase_requests_enabled", ar: "طلبات الشراء", en: "Purchase requests" },
    { k: "maintenance_vendor_billing_enabled", ar: "فوترة صيانة المورد", en: "Maintenance billing" },
  ]},
  { title: "تكاملات وخصوصية (للمالك)", en: "Integrations & privacy (owner)", keys: [
    { k: "gps_sessions_enabled", ar: "جلسات تتبّع الموقع", en: "GPS sessions", ext: true, desc: "تتبّع جلسة المهمة فقط بموافقة — معطّل حتى اعتماد سياسة الخصوصية." },
    { k: "external_trackers_enabled", ar: "أجهزة تتبّع خارجية", en: "External trackers", ext: true },
    { k: "client_rental_portal_enabled", ar: "بوابة التأجير", en: "Rental portal", ext: true, desc: "معطّلة حتى اعتماد النص القانوني والتسعير." },
    { k: "depreciation_enabled", ar: "الإهلاك والقيمة الدفترية", en: "Depreciation" }, { k: "zoho_asset_sync_enabled", ar: "مزامنة Zoho للأصول", en: "Zoho sync", ext: true },
    { k: "insurance_claims_enabled", ar: "التأمين والمطالبات", en: "Insurance & claims" }, { k: "custody_offline_enabled", ar: "الوضع دون اتصال", en: "Offline mode", ext: true },
    { k: "custody_mobile_app_enabled", ar: "تطبيق الجوال", en: "Mobile app", ext: true },
  ]},
];
const SQL_FILE = "docs/custody_enterprise_00_feature_flags_PATCH.sql";

export default function CustodyEnterpriseSettings() {
  const { t, isAr } = useI18n();
  const [f, setF] = useState<CustodyFlags>(DEFAULT_CUSTODY_FLAGS);
  const [db, setDb] = useState<"loading" | "ready" | "not_prepared" | "forbidden">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3200); };

  async function load() {
    const r = await custodyGetFlags();
    if (r.ok) { setF({ ...DEFAULT_CUSTODY_FLAGS, ...r.data }); setDb("ready"); return; }
    // تمييز سبب الفشل ليظهر للإدارة بوضوح (لا شاشة فارغة).
    if (/staff only|not authorized|permission|forbidden/i.test(r.error)) setDb("forbidden");
    else setDb("not_prepared");   // الدالة غير موجودة ⇒ لم يُشغَّل SQL بعد
  }
  useEffect(() => { void load(); }, []);

  async function toggle(k: keyof CustodyFlags) {
    if (busy) return;
    setBusy(k);
    const r = await custodyUpdateFlags({ [k]: !(f[k] === true) } as Partial<CustodyFlags>);
    setBusy(null);
    if (!r.ok) {
      if (/not authorized/i.test(r.error)) { flash(t({ ar: "غير مصرّح — للمالك/الأدمن فقط.", en: "Owner/admin only." })); return; }
      if (/does not exist|not found|schema cache|PGRST/i.test(r.error)) { setDb("not_prepared"); flash(t({ ar: "لم تُجهّز قاعدة المزايا بعد.", en: "Enterprise DB not prepared." })); return; }
      flash(t({ ar: "تعذّر الحفظ: ", en: "Save failed: " }) + r.error); return;
    }
    setF({ ...DEFAULT_CUSTODY_FLAGS, ...r.data }); flash(t({ ar: "حُفظ الإعداد.", en: "Saved." }));
  }
  const Toggle = ({ on, k }: { on: boolean; k: keyof CustodyFlags }) => (
    <button disabled={!!busy || db !== "ready"} onClick={() => void toggle(k)}
      className={`w-11 h-6 rounded-full transition ${on ? "bg-red-600" : "bg-stone-700"} relative shrink-0 disabled:opacity-40`}>
      {busy === k ? <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white">…</span>
        : <span className={`absolute top-0.5 ${on ? "left-0.5" : "right-0.5"} w-5 h-5 bg-white rounded-full`} />}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* شارة الحالة — دائمًا ظاهرة */}
      {db === "loading" && <div className={`${card} text-xs text-stone-500`}>{t({ ar: "جارٍ تحميل حالة المزايا…", en: "Loading modules…" })}</div>}
      {db === "not_prepared" && (
        <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4">
          <div className="text-sm text-amber-300 font-medium">{t({ ar: "قاعدة بيانات مزايا المنصّة لم تُجهَّز بعد.", en: "Enterprise modules DB is not prepared yet." })}</div>
          <div className="text-[11px] text-amber-400/80 mt-1">{t({ ar: "شغّل ملف SQL التالي في Supabase (ثم 01→07 بالترتيب):", en: "Run this SQL in Supabase (then 01→07 in order):" })}</div>
          <code className="block text-[11px] text-amber-200 mt-1 font-mono" dir="ltr">{SQL_FILE}</code>
          <div className="text-[11px] text-amber-400/70 mt-1">{t({ ar: "الترتيب الكامل في docs/CUSTODY_ENTERPRISE_SQL_RUN_ORDER.md — الشاشة تعمل وتظهر القيم الافتراضية أدناه.", en: "Full order in docs/CUSTODY_ENTERPRISE_SQL_RUN_ORDER.md — defaults shown below." })}</div>
        </div>
      )}
      {db === "forbidden" && <div className={`${card} text-xs text-stone-400`}>{t({ ar: "هذه الإعدادات للمالك/الأدمن فقط.", en: "Owner/admin only." })}</div>}

      {db !== "forbidden" && GROUPS.map((g) => (
        <section key={g.title} className={card}>
          <h3 className="text-sm font-medium text-white mb-3">{isAr ? g.title : g.en}</h3>
          <div className="space-y-3">
            {g.keys.map((it) => (
              <div key={it.k} className="flex items-start gap-3">
                <Toggle on={f[it.k] === true} k={it.k} />
                <div className="min-w-0">
                  <div className="text-sm text-stone-200">{isAr ? it.ar : it.en} <span className="text-stone-600 text-[10px]">{isAr ? it.en : it.ar}</span>
                    {it.ext && <span className="text-[9px] text-amber-500/80 border border-amber-800/50 rounded px-1 mr-1">{t({ ar: "يحتاج إعدادًا", en: "needs setup" })}</span>}
                  </div>
                  {it.desc && <div className="text-[11px] text-stone-500">{it.desc}</div>}
                </div>
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
