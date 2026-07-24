// ════════════════════════════════════════════════════════════════════════
// /api/integrations/hr/my-tasks   (SERVER-ONLY)
//
// إصلاح جذري لعطل "الموظف لا يرى تفاصيل مهمته": يقرأ مهام الموظف المسندة له عبر
// مفتاح الخدمة (يتجاوز أي عائق في طبقة القراءة/RLS/grant الذي كان يُخفي صف المهمة)
// — مقيّدًا بصرامة بهوية الموظف المُتحقّق منها (لا يرى مهمة موظف آخر). يعمل بنشر
// الكود وحده دون انتظار أي SQL. يُرجع كل التفاصيل + زملاء الفريق + المشرف + المرفقات
// + أدلة التسليم. يسجّل TASK_DETAILS_QUERY للإثبات (بلا بيانات حساسة).
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, selectAsService, adminConfigured } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const enc = (v: string) => encodeURIComponent(v);

type Assignee = { id: string; task_id: string; user_id: string; employee_id: string; status: string;
  started_at: string | null; ended_at: string | null; employee_note: string | null; admin_note: string | null;
  created_at: string; updated_at: string };

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // هوية المُرسِل من الـ JWT نفسه (GoTrue) — لا من profiles (سياستها تتّسع للأدمن)،
  // فلا يُحلّ uid إلى صف موظف آخر. كل القراءات لاحقًا مقيّدة بهذا الـ uid حصرًا.
  if (!adminConfigured()) {
    return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });
  }
  const uid = await authGetUserId(bearer);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // يجب أن يكون موظفًا/أدمن (صفّه هو تحديدًا).
  const me = await selectAsService<{ staff_role: string | null; account_type: string }[]>(
    `profiles?id=eq.${enc(uid)}&select=staff_role,account_type&limit=1`);
  if (!me.ok || !me.data[0]) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!me.data[0].staff_role && me.data[0].account_type !== "admin") {
    return NextResponse.json({ ok: false, error: "staff_only" }, { status: 403 });
  }

  // 1) مهام الموظف المسندة له (بمفتاح الخدمة — مقيّد بـ user_id = هويته).
  //    فشل هذه القراءة ⇒ نُعيد ok:false ليعود العميل لمساره الاحتياطي (لا نُظهر "لا مهام" زورًا).
  const asg = await selectAsService<Assignee[]>(
    `hr_field_task_assignees?user_id=eq.${enc(uid)}&select=*&order=created_at.desc&limit=100`);
  if (!asg.ok) {
    log("TASK_DETAILS_QUERY", { employee_user_id: uid, assignment_found: -1, task_found: 0, returned_fields_count: 0, reason: "assignees_read_failed" });
    return NextResponse.json({ ok: false, error: "assignees_read_failed" }, { status: 502 });
  }
  const assignments = asg.data;
  const taskIds = Array.from(new Set(assignments.map((a) => a.task_id))).filter(Boolean);

  // 2) تفاصيل المهام الكاملة (غير المحذوفة).
  let tasks: Record<string, unknown>[] = [];
  if (taskIds.length) {
    const inList = taskIds.map(enc).join(",");
    const tk = await selectAsService<Record<string, unknown>[]>(
      `hr_field_tasks?id=in.(${inList})&is_deleted=eq.false&select=*`);
    if (tk.ok) tasks = tk.data;
  }

  // 3) زملاء الفريق (بقية المسندين) لكل مهمة — أسماء فقط.
  const teammates: Record<string, string[]> = {};
  if (taskIds.length) {
    const inList = taskIds.map(enc).join(",");
    const all = await selectAsService<{ task_id: string; employee_id: string }[]>(
      `hr_field_task_assignees?task_id=in.(${inList})&select=task_id,employee_id`);
    if (all.ok) {
      const empIds = Array.from(new Set(all.data.map((x) => x.employee_id))).filter(Boolean);
      const names: Record<string, string> = {};
      if (empIds.length) {
        const pr = await selectAsService<{ id: string; full_name: string | null; user_id: string | null }[]>(
          `hr_employee_profiles?id=in.(${empIds.map(enc).join(",")})&select=id,full_name,user_id`);
        if (pr.ok) pr.data.forEach((p) => { if (p.full_name) names[p.id] = p.full_name; });
        // اسم عضو الفريق يُعرض لكل مهمة عدا الموظف نفسه.
        const myEmpIds = new Set(assignments.map((a) => a.employee_id));
        all.data.forEach((x) => {
          if (myEmpIds.has(x.employee_id)) return; // نفسه
          const nm = names[x.employee_id];
          if (nm) { (teammates[x.task_id] ??= []); if (!teammates[x.task_id].includes(nm)) teammates[x.task_id].push(nm); }
        });
      }
    }
  }

  // 4) المشرف الميداني للموظف (إن وُجد جدول الروابط).
  let supervisorName: string | null = null;
  const myEmpLookup = assignments[0]?.employee_id
    ? null
    : await selectAsService<{ id: string }[]>(`hr_employee_profiles?user_id=eq.${enc(uid)}&is_deleted=eq.false&select=id&limit=1`);
  const myEmp = assignments[0]?.employee_id
    ?? (myEmpLookup?.ok ? myEmpLookup.data[0]?.id : undefined);
  if (myEmp) {
    const links = await selectAsService<{ supervisor_employee_id: string }[]>(
      `hr_employee_supervisor_links?employee_id=eq.${enc(myEmp)}&is_active=eq.true&select=supervisor_employee_id&limit=1`);
    if (links.ok && links.data[0]) {
      const sup = await selectAsService<{ full_name: string | null }[]>(
        `hr_employee_profiles?id=eq.${enc(links.data[0].supervisor_employee_id)}&select=full_name&limit=1`);
      if (sup.ok && sup.data[0]?.full_name) supervisorName = sup.data[0].full_name;
    }
  }

  // 5) مرفقات الموظف نفسه فقط (uploaded_by = هويته) — لا مرفقات الزملاء.
  const attachments: Record<string, { file_path: string; file_type: string | null }[]> = {};
  if (taskIds.length) {
    const at = await selectAsService<{ task_id: string; file_path: string; file_type: string | null }[]>(
      `hr_attachments?task_id=in.(${taskIds.map(enc).join(",")})&uploaded_by=eq.${enc(uid)}&select=task_id,file_path,file_type&limit=200`);
    if (at.ok) at.data.forEach((x) => { (attachments[x.task_id] ??= []).push({ file_path: x.file_path, file_type: x.file_type }); });
  }

  // 6) أدلة التسليم (ملف/رابط) الخاصة بالموظف.
  const evidence: Record<string, { id: string; kind: string; file_path: string | null; link_url: string | null; file_name: string | null }[]> = {};
  if (taskIds.length) {
    const ev = await selectAsService<{ id: string; task_id: string; kind: string; file_path: string | null; link_url: string | null; file_name: string | null }[]>(
      `hr_task_evidence?user_id=eq.${enc(uid)}&task_id=in.(${taskIds.map(enc).join(",")})&is_deleted=eq.false&select=id,task_id,kind,file_path,link_url,file_name&limit=200`);
    if (ev.ok) ev.data.forEach((x) => { (evidence[x.task_id] ??= []).push({ id: x.id, kind: x.kind, file_path: x.file_path, link_url: x.link_url, file_name: x.file_name }); });
  }

  // إثبات في السجلات (بلا بيانات حساسة).
  log("TASK_DETAILS_QUERY", {
    employee_user_id: uid,
    assignment_found: assignments.length,
    task_found: tasks.length,
    returned_fields_count: tasks[0] ? Object.keys(tasks[0]).length : 0,
    teammates_tasks: Object.keys(teammates).length,
    has_supervisor: !!supervisorName,
    attachments_tasks: Object.keys(attachments).length,
  });

  return NextResponse.json({ ok: true, assignments, tasks, teammates, supervisorName, attachments, evidence }, { status: 200 });
}
