"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/registers — سجلّ السلامة والحوادث · الإجراءات · ملخّص الحقوق.
//
// Wave 6 · V2-6.3-B · V2-6.4-A · V2-6.6
//
// مسار مستقلّ عن منصّة المشاريع المجمَّدة (W5-4 باقٍ: لا يُرفَع التجميد).
// ⛔ العلم مطفأ ⇒ الصفحة تقول «غير مُفعَّلة»، والتبويب غائب أصلًا.
// ════════════════════════════════════════════════════════════════════════════
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { wave6Enabled } from "@/lib/portal/custodyInventory";
import { caseStudyDraftsEnabled } from "@/lib/portal/caseStudies";
import { auditViewerEnabled } from "@/lib/portal/client";
import Wave6Registers, { ProjectRights } from "@/components/portal/registers/Wave6Registers";
import CaseStudyDrafts from "@/components/portal/registers/CaseStudyDrafts";
import AuditViewer from "@/components/portal/AuditViewer";

function Inner() {
  const projectId = useSearchParams().get("p");
  if (!wave6Enabled()) {
    return <p className="text-[12.5px] text-stone-400">هذه الميزة غير مُفعَّلة.</p>;
  }
  return (
    <div className="space-y-3">
      <Wave6Registers />
      {/* V2-6.8 — علم مستقلّ: مسوّدات دراسات الحالة قد تُفعَّل وحدها. */}
      {caseStudyDraftsEnabled() && <CaseStudyDrafts />}
      {/* V2-7.3 — عارض قراءة فقط، بعلم مستقلّ. */}
      {auditViewerEnabled() && <AuditViewer />}
      {/* ملخّص الحقوق يخصّ مشروعًا بعينه — يظهر حين يُمرَّر معرّفه. */}
      {projectId
        ? <ProjectRights projectId={projectId} />
        : <p className="text-[11.5px] text-stone-500">
            لعرض ملخّص حقوق مشروع، افتح الصفحة بمعرّفه (<span dir="ltr">?p=…</span>).
          </p>}
    </div>
  );
}

export default function RegistersPage() {
  return (
    <div>
      <div className="mb-5">
        <div className="eyebrow mb-2">السجلّات</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(20px,3.5vw,28px)", lineHeight: 1.25 }}>
          السلامة والإجراءات والحقوق
        </h1>
      </div>
      <Suspense fallback={<p className="text-[12px] text-stone-500">جارٍ التحميل…</p>}>
        <Inner />
      </Suspense>
    </div>
  );
}
