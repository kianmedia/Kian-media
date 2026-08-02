"use client";
// ════════════════════════════════════════════════════════════════════════════
// ConsentField — the ONE privacy-consent control, shared by all four public forms.
//
// Wave 0 · V2-0.1-A…D, G
//
// Used by: components/Contact.tsx · app/quote-request · app/book-meeting ·
//          app/upload-files
//
// Renders NOTHING when the capability is off (lib/consent.ts → consentEnabled()),
// so with the flag unset every form is byte-identical to its pre-Wave-0 behaviour.
//
// Styling deliberately mirrors CheckField in ./Field.tsx (same accent, same
// border treatment, same 17px box) so it does not read as a bolted-on control —
// but it is a separate component because the label must contain a LINK, and a
// link inside CheckField's <label> would make the whole row a click target that
// navigates away instead of ticking the box. The <a> below stops propagation for
// exactly that reason.
// ════════════════════════════════════════════════════════════════════════════
import {
  CONSENT_LABEL,
  CONSENT_LINK_TEXT,
  PRIVACY_PATH,
  consentEnabled,
} from "@/lib/consent";

export default function ConsentField({
  id = "privacy-consent",
  checked,
  onChange,
  isAr,
}: {
  id?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  isAr: boolean;
}) {
  if (!consentEnabled()) return null;

  const label = isAr ? CONSENT_LABEL.ar : CONSENT_LABEL.en;
  const linkText = isAr ? CONSENT_LINK_TEXT.ar : CONSENT_LINK_TEXT.en;

  // Split the label on the link phrase so the policy link sits inline in the
  // sentence rather than dangling after it. If the phrase is ever absent from
  // the label the whole sentence still renders — the link is then appended.
  const idx = label.indexOf(linkText);
  const before = idx >= 0 ? label.slice(0, idx) : label + " — ";
  const after = idx >= 0 ? label.slice(idx + linkText.length) : "";

  return (
    <label
      htmlFor={id}
      className="f-sans"
      data-consent-field
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        cursor: "pointer",
        padding: "12px 14px",
        marginTop: "18px",
        background: checked ? "rgba(227,30,36,0.08)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${checked ? "rgba(227,30,36,0.4)" : "rgba(255,255,255,0.1)"}`,
        borderRadius: "3px",
        transition: "all 0.3s",
        fontSize: "13.5px",
        lineHeight: 1.7,
        color: checked ? "#fff" : "rgba(255,255,255,0.65)",
      }}
    >
      <input
        id={id}
        name="privacy_consent"
        type="checkbox"
        required
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          width: "17px",
          height: "17px",
          accentColor: "#E31E24",
          cursor: "pointer",
          flexShrink: 0,
          marginTop: "3px",
        }}
      />
      <span>
        {before}
        <a
          href={PRIVACY_PATH}
          target="_blank"
          rel="noopener noreferrer"
          // Without this, clicking the link also toggles the checkbox (the <a> is
          // inside the <label>), so the visitor opens the policy AND silently
          // flips their own consent state.
          onClick={(e) => e.stopPropagation()}
          style={{ color: "#E31E24", textDecoration: "underline", textUnderlineOffset: "3px" }}
        >
          {linkText}
        </a>
        {after}
        <span style={{ color: "#E31E24", marginInlineStart: "4px" }}>*</span>
      </span>
    </label>
  );
}
