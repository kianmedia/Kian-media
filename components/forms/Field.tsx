"use client";
import { ReactNode } from "react";

const baseInput: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "3px",
  padding: "13px 15px",
  color: "#fff",
  fontSize: "15px",
  fontFamily: "var(--sans)",
  outline: "none",
  transition: "border-color 0.3s, background 0.3s",
  // Dark-mode native controls (date/time pickers, select dropdowns) so the
  // selected value + calendar icon are visible instead of dark-on-dark.
  colorScheme: "dark",
};

function focusOn(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "rgba(227,30,36,0.55)";
  e.currentTarget.style.background = "rgba(227,30,36,0.04)";
}
function focusOff(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
}

export function Label({ children, htmlFor, required }: { children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="f-sans" style={{ display: "block", marginBottom: "7px", fontSize: "12.5px", fontWeight: 600, color: "rgba(255,255,255,0.7)", letterSpacing: "0.3px" }}>
      {children}{required && <span style={{ color: "#E31E24", marginInlineStart: "4px" }}>*</span>}
    </label>
  );
}

export function TextField({ id, value, onChange, type = "text", placeholder, required, dir }:
  { id: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean; dir?: "ltr" | "rtl" }) {
  return (
    <input id={id} type={type} value={value} placeholder={placeholder} required={required} dir={dir}
      onChange={(e) => onChange(e.target.value)} onFocus={focusOn} onBlur={focusOff} style={baseInput} />
  );
}

export function TextArea({ id, value, onChange, placeholder, rows = 4, required }:
  { id: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; required?: boolean }) {
  return (
    <textarea id={id} value={value} placeholder={placeholder} rows={rows} required={required}
      onChange={(e) => onChange(e.target.value)} onFocus={focusOn} onBlur={focusOff}
      style={{ ...baseInput, resize: "vertical", lineHeight: 1.6 }} />
  );
}

export function SelectField({ id, value, onChange, options, required }:
  { id: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; required?: boolean }) {
  return (
    <select id={id} value={value} required={required}
      onChange={(e) => onChange(e.target.value)} onFocus={focusOn} onBlur={focusOff}
      style={{ ...baseInput, cursor: "pointer", appearance: "none" }}>
      <option value="" style={{ background: "#0a0a0a" }}></option>
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: "#0a0a0a" }}>{o.label}</option>
      ))}
    </select>
  );
}

export function CheckField({ id, checked, onChange, label }:
  { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label htmlFor={id} className="f-sans" style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", padding: "11px 14px", background: checked ? "rgba(227,30,36,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${checked ? "rgba(227,30,36,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: "3px", transition: "all 0.3s", fontSize: "14px", color: checked ? "#fff" : "rgba(255,255,255,0.65)" }}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: "17px", height: "17px", accentColor: "#E31E24", cursor: "pointer" }} />
      {label}
    </label>
  );
}
