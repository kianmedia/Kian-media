"use client";
// ════════════════════════════════════════════════════════════════════════════
// WarningGroups — Phase 4D §3. يعرض تحذيرات التخطيط مجمّعة حسب code (بدل عشرات التكرارات)
// مع عدّاد وقائمة قابلة للطي وزر فتح المهمة. لا يدمج أنواعًا مختلفة. لا يغطّي المخطط.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { groupWarnings, groupHeadline, type RawWarning } from "@/lib/portal/planningWarnings";

export default function WarningGroups({ warnings, onOpenTask }: {
  warnings: Array<RawWarning | string> | null | undefined;
  onOpenTask?: (taskId: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const groups = groupWarnings(warnings);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-1" dir="rtl">
      {groups.map((g) => {
        const isOpen = open.has(g.code);
        const withTasks = g.items.filter((i) => i.task_id);
        return (
          <div key={g.code} className="text-[10px]">
            <button
              onClick={() => setOpen((s) => { const n = new Set(s); n.has(g.code) ? n.delete(g.code) : n.add(g.code); return n; })}
              className="flex items-center gap-1 text-amber-400 hover:text-amber-300"
              aria-expanded={isOpen}>
              <span className="w-3">{withTasks.length > 0 ? (isOpen ? "▾" : "▸") : "·"}</span>
              <span>{groupHeadline(g)}</span>
              {withTasks.length > 0 && <span className="text-amber-500/70">({t({ ar: "عرض المهام", en: "view tasks" })})</span>}
            </button>
            {isOpen && withTasks.length > 0 && (
              <ul className="ms-4 mt-0.5 space-y-0.5">
                {withTasks.map((i, k) => (
                  <li key={i.task_id ?? k} className="flex items-center gap-2 text-stone-400">
                    <span className="truncate" dir="auto">{i.ar}</span>
                    {onOpenTask && i.task_id && <button onClick={() => onOpenTask(i.task_id!)} className="text-sky-400 hover:text-sky-300 shrink-0">{t({ ar: "فتح", en: "open" })}</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
