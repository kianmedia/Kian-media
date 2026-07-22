"use client";
// ════════════════════════════════════════════════════════════════════════════
// ResourceLabel — Phase 4D §2. هوية بصرية للمورد تميّز الحسابات المتشابهة الاسم
// (٣ موظفين باسم «خالد» ليسوا تكرارًا): الاسم + المهنة/الدور + Badge النوع + الأحرف
// الأولى بلون النوع. لا يُستخدم الاسم كمفتاح React — المفاتيح دائمًا resource_id/user_id.
// ════════════════════════════════════════════════════════════════════════════
import { type ResourceCard } from "@/lib/portal/projectResources";

const TYPE_BADGE: Record<string, { ar: string; color: string }> = {
  employee: { ar: "موظف", color: "#0284c7" }, contractor: { ar: "متعاون", color: "#7c3aed" },
  equipment: { ar: "معدة", color: "#d97706" }, studio: { ar: "استوديو", color: "#16a34a" },
  vehicle: { ar: "مركبة", color: "#dc2626" }, location: { ar: "موقع", color: "#0891b2" },
  vendor_resource: { ar: "مورد خارجي", color: "#78716c" },
};

function initials(name: string): string {
  const p = (name || "?").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}

/** identity subtitle: المهنة/القسم للموظف، أو كود الأصل للمعدة — يميّز المتشابهين. */
export function resourceRole(r: ResourceCard): string | null {
  if (r.employee) return r.employee.job_title || r.employee.department || null;
  if (r.asset) return r.asset.asset_code || null;
  return null;
}

export default function ResourceLabel({ r, sub, size = "sm" }: { r: ResourceCard; sub?: string; size?: "sm" | "xs" }) {
  const badge = TYPE_BADGE[r.resource_type] ?? TYPE_BADGE.vendor_resource;
  const role = resourceRole(r);
  const d = size === "xs" ? 16 : 20;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" title={`${r.display_name}${role ? " — " + role : ""} (${badge.ar})`}>
      <span aria-hidden className="shrink-0 rounded-full flex items-center justify-center font-bold text-white" style={{ width: d, height: d, fontSize: size === "xs" ? 7 : 8, background: badge.color }}>{initials(r.display_name)}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-1">
          <span className="truncate text-stone-200" dir="auto">{r.display_name}</span>
          <span className="shrink-0 text-[8px] px-1 rounded" style={{ background: badge.color + "22", color: badge.color }}>{badge.ar}</span>
        </span>
        {(role || sub) && <span className="block truncate text-[9px] text-stone-500" dir="auto">{[role, sub].filter(Boolean).join(" · ")}</span>}
      </span>
    </span>
  );
}
