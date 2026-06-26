"use client";
// ════════════════════════════════════════════════════════════════════════
// Profile & Settings — lead / client / admin. Editable: full_name, company,
// mobile (validated). Read-only: email, account type/level. Plus preferred
// language + notification-channel preferences. All via column-granted updates
// (lib/portal/account.ts) — no schema change, no service-role key.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { Label, TextField } from "@/components/forms/Field";
import { updateMyProfile, getMyPrefs, updateMyPrefs } from "@/lib/portal/account";
import { isValidMobile } from "@/lib/submitForm";
import type { NotificationPreferences, PreferredLang } from "@/lib/portal/types";

const LEVEL_LABEL = {
  prospect: { ar: "عميل محتمل", en: "Prospect" },
  active:   { ar: "عميل نشط",   en: "Active Client" },
  vip:      { ar: "عميل VIP",   en: "VIP Client" },
} as const;

const TYPE_LABEL = {
  lead:   { ar: "حساب جديد", en: "Lead" },
  client: { ar: "عميل",      en: "Client" },
  admin:  { ar: "مدير",      en: "Admin" },
} as const;

export default function ProfileSettings() {
  const { t, isAr } = useI18n();
  const { profile, readOnly, reload } = usePortal();
  const isAdmin = profile.account_type === "admin";

  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [company, setCompany] = useState(profile.company ?? "");
  const [mobile, setMobile] = useState(profile.mobile ?? "");
  const [lang, setLang] = useState<PreferredLang>(profile.preferred_lang);
  const [marketing, setMarketing] = useState(profile.marketing_opt_in);

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getMyPrefs();
      if (alive && r.ok) setPrefs(r.data);
    })();
    return () => { alive = false; };
  }, []);

  async function saveProfile() {
    setMsg(null);
    if (!fullName.trim()) { setMsg({ kind: "err", text: t({ ar: "الاسم مطلوب", en: "Name is required" }) }); return; }
    if (!mobile.trim() || !isValidMobile(mobile)) { setMsg({ kind: "err", text: t({ ar: "رقم الجوال غير صحيح", en: "Invalid mobile number" }) }); return; }
    setSaving(true);
    const r = await updateMyProfile({
      full_name: fullName.trim(),
      company: company.trim() || null as unknown as string,
      mobile: mobile.trim(),
      preferred_lang: lang,
      marketing_opt_in: marketing,
    });
    setSaving(false);
    if (!r.ok) { setMsg({ kind: "err", text: t({ ar: "تعذّر الحفظ: ", en: "Couldn't save: " }) + r.error }); return; }
    setMsg({ kind: "ok", text: t({ ar: "تم حفظ التغييرات.", en: "Changes saved." }) });
    void reload(); // refresh name/badges in the shell + overview
  }

  async function togglePref(key: keyof Pick<NotificationPreferences, "portal_enabled" | "email_enabled" | "whatsapp_enabled">, value: boolean) {
    if (!prefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next); // optimistic
    const r = await updateMyPrefs({ [key]: value });
    if (!r.ok) { setPrefs(prefs); setMsg({ kind: "err", text: t({ ar: "تعذّر تحديث التفضيلات.", en: "Couldn't update preferences." }) }); }
  }

  return (
    <div style={{ maxWidth: "640px" }}>
      <div className="mb-8">
        <div className="eyebrow mb-4">{isAdmin ? t({ ar: "الإعدادات", en: "Settings" }) : t({ ar: "ملفي الشخصي", en: "My Profile" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "بياناتي وتفضيلاتي", en: "My Details & Preferences" })}
        </h1>
        <div className="flex flex-wrap gap-2 mt-4">
          <Badge>{t(TYPE_LABEL[profile.account_type])}</Badge>
          {profile.account_type === "client" && <Badge>{t(LEVEL_LABEL[profile.client_level])}</Badge>}
        </div>
      </div>

      {readOnly && (
        <div className="f-sans" style={{ padding: "13px 16px", fontSize: "13px", color: "#ffd28a", background: "rgba(255,166,0,0.08)", border: "1px solid rgba(255,166,0,0.3)", borderRadius: "3px", marginBottom: "24px" }}>
          {t({ ar: "حسابك في وضع القراءة فقط — لا يمكن حفظ التعديلات حالياً.", en: "Your account is read-only — changes can't be saved right now." })}
        </div>
      )}

      {/* ─── Profile fields ─── */}
      <Section title={t({ ar: "البيانات الأساسية", en: "Basic Details" })}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div><Label htmlFor="pf_name" required>{t({ ar: "الاسم الكامل", en: "Full Name" })}</Label>
            <TextField id="pf_name" value={fullName} onChange={setFullName} /></div>
          <div><Label htmlFor="pf_company">{t({ ar: "الشركة / الجهة", en: "Company" })}</Label>
            <TextField id="pf_company" value={company} onChange={setCompany} /></div>
          <div><Label htmlFor="pf_mobile" required>{t({ ar: "رقم الجوال", en: "Mobile" })}</Label>
            <TextField id="pf_mobile" type="tel" dir="ltr" value={mobile} onChange={setMobile} /></div>
          <div>
            <Label htmlFor="pf_email">{t({ ar: "البريد الإلكتروني", en: "Email" })}</Label>
            <div id="pf_email" className="f-sans" style={{ direction: "ltr", textAlign: isAr ? "right" : "left", padding: "13px 15px", borderRadius: "3px", background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)", fontSize: "14px" }}>
              {profile.email}
            </div>
            <p className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", marginTop: "6px" }}>
              {t({ ar: "لتغيير البريد الإلكتروني تواصل مع كيان ميديا.", en: "To change your email, contact Kian Media." })}
            </p>
          </div>
        </div>
      </Section>

      {/* ─── Language ─── */}
      <Section title={t({ ar: "اللغة المفضّلة", en: "Preferred Language" })}>
        <div className="flex gap-2">
          {(["ar", "en"] as PreferredLang[]).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} disabled={readOnly} className="f-sans"
              style={{ padding: "9px 18px", fontSize: "12px", letterSpacing: "1px", borderRadius: "3px", cursor: readOnly ? "default" : "pointer",
                background: lang === l ? "rgba(227,30,36,0.12)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${lang === l ? "rgba(227,30,36,0.45)" : "rgba(255,255,255,0.1)"}`,
                color: lang === l ? "#fff" : "rgba(255,255,255,0.55)" }}>
              {l === "ar" ? "العربية" : "English"}
            </button>
          ))}
        </div>
      </Section>

      {/* ─── Notification preferences ─── */}
      <Section title={t({ ar: "تفضيلات الإشعارات", en: "Notification Preferences" })}>
        {prefs ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <Toggle label={t({ ar: "إشعارات داخل البوابة", en: "In-portal notifications" })}
              checked={prefs.portal_enabled} disabled={readOnly}
              onChange={(v) => togglePref("portal_enabled", v)} />
            <Toggle label={t({ ar: "إشعارات البريد الإلكتروني", en: "Email notifications" })}
              checked={prefs.email_enabled} disabled={readOnly}
              onChange={(v) => togglePref("email_enabled", v)} />
            <Toggle label={t({ ar: "إشعارات واتساب", en: "WhatsApp notifications" })}
              checked={prefs.whatsapp_enabled} disabled={readOnly}
              onChange={(v) => togglePref("whatsapp_enabled", v)} />
            <p className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", lineHeight: 1.6, marginTop: "2px" }}>
              {t({ ar: "بتفعيل واتساب فإنك توافق على استلام رسائل المعاملات عبر واتساب على رقمك المسجّل.", en: "Enabling WhatsApp means you consent to receive transactional WhatsApp messages on your registered number." })}
            </p>
          </div>
        ) : (
          <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "جارٍ تحميل التفضيلات...", en: "Loading preferences..." })}</p>
        )}
        <div style={{ marginTop: "16px" }}>
          <Toggle label={t({ ar: "أوافق على استلام العروض التسويقية", en: "Receive marketing offers" })}
            checked={marketing} disabled={readOnly} onChange={setMarketing} />
        </div>
      </Section>

      {isAdmin && (
        <div className="f-sans" style={{ padding: "13px 16px", fontSize: "12.5px", color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "3px", marginBottom: "24px", lineHeight: 1.7 }}>
          {t({ ar: "إدارة الصلاحيات والفريق (مدير/مبيعات/دعم/إنتاج) — قادمة لاحقاً.", en: "Staff & permissions management (manager / sales / support / production) — coming later." })}
        </div>
      )}

      {msg && (
        <div className="f-sans" style={{ padding: "12px 14px", fontSize: "13px", borderRadius: "3px", marginBottom: "16px",
          color: msg.kind === "ok" ? "#7CFC9A" : "#ff8a8e",
          background: msg.kind === "ok" ? "rgba(124,252,154,0.08)" : "rgba(227,30,36,0.08)",
          border: `1px solid ${msg.kind === "ok" ? "rgba(124,252,154,0.3)" : "rgba(227,30,36,0.3)"}` }}>
          {msg.text}
        </div>
      )}

      <button onClick={saveProfile} disabled={saving || readOnly} className="btn-red"
        style={{ justifyContent: "center", opacity: saving || readOnly ? 0.6 : 1, cursor: saving || readOnly ? "default" : "pointer" }}>
        <span>{saving ? "..." : t({ ar: "حفظ التغييرات", en: "Save Changes" })}</span>
      </button>

      <p className="f-sans" style={{ marginTop: "22px", fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
        <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>{t({ ar: "سياسة الخصوصية", en: "Privacy Policy" })}</a>
        <span style={{ margin: "0 8px", color: "rgba(255,255,255,0.25)" }}>·</span>
        <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>{t({ ar: "شروط الاستخدام", en: "Terms" })}</a>
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "28px" }}>
      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600, marginBottom: "14px" }}>{title}</div>
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="f-sans" style={{ fontSize: "10.5px", letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 600, padding: "6px 12px", borderRadius: "3px", color: "#E31E24", background: "rgba(227,30,36,0.1)", border: "1px solid rgba(227,30,36,0.3)" }}>
      {children}
    </span>
  );
}

function Toggle({ label, checked, onChange, disabled, planned }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; planned?: boolean }) {
  const { t } = useI18n();
  return (
    <label className="f-sans" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", cursor: disabled ? "default" : "pointer", padding: "11px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "3px", fontSize: "13.5px", color: "rgba(255,255,255,0.8)" }}>
      <span className="inline-flex items-center gap-2">
        {label}
        {planned && <span style={{ fontSize: "8.5px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,210,138,0.85)", background: "rgba(255,166,0,0.08)", border: "1px solid rgba(255,166,0,0.3)", padding: "2px 6px", borderRadius: "2px" }}>{t({ ar: "قريباً", en: "planned" })}</span>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        style={{ width: "18px", height: "18px", accentColor: "#E31E24", cursor: disabled ? "default" : "pointer", flexShrink: 0 }} />
    </label>
  );
}
