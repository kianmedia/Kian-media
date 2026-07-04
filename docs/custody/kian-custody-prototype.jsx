import { useState, useRef } from "react";
import {
  Aperture, Camera, AlertTriangle, CheckCircle2, XCircle, Bell, Package,
  FileSignature, Clock, Plus, Trash2, Mail, MessageCircle, ShieldCheck,
  User, Send,
} from "lucide-react";

const EMPLOYEE = { name: "فهد المطيري — مصوّر", phone: "0501234567" };

const CUSTODY_CLAUSES = [
  "أستلم المعدات الموضحة بحالة سليمة وكاملة وفق الصور المرفقة لكل قطعة وإجمالي المعدات.",
  "أتحمل المسؤولية الكاملة عن العهدة من لحظة الاستلام حتى إعادتها واعتماد الإقفال من الإدارة.",
  "أي فقد أو تلف أو نقص يقع تحت مسؤوليتي، وألتزم بمعالجته وفق سياسة المؤسسة.",
];
const CUSTODY_AGREE = "أقر باستلام العهدة وأتعهد بالمسؤولية الكاملة عنها حتى إقفالها من الإدارة. (التأشير هنا بمثابة توقيع)";

const RENT_CLAUSES = [
  "يقر المستأجر باستلام المعدات الموضحة بحالة سليمة وكاملة وفق الصور المرفقة لكل قطعة وإجمالي المعدات.",
  "يتحمل المستأجر المسؤولية القانونية والمالية الكاملة عن المعدات من لحظة الاستلام حتى إعادتها واعتماد الإقفال من إدارة كيان.",
  "في حال أي فقد أو تلف أو سرقة أو نقص، يلتزم المستأجر بقيمة الإصلاح أو الاستبدال بالقيمة السوقية الكاملة دون اعتراض.",
  "تبقى جميع المعدات ملكاً خالصاً لمؤسسة كيان، ولا يحق للمستأجر تأجيرها من الباطن أو نقل حيازتها للغير.",
  "يلتزم المستأجر بإعادة المعدات في الموعد المتفق عليه، ويخضع أي تأخير لرسوم إضافية عن كل يوم.",
  "يحق لكيان المطالبة بقيمة التأمين واتخاذ الإجراءات النظامية اللازمة عند الإخلال بأي بند من هذا العقد.",
  "يُعد تأشير المستأجر بالموافقة الإلكترونية أدناه توقيعاً ملزماً وإقراراً بقراءة العقد كاملاً وفهم شروطه.",
];
const RENT_AGREE = "أقر بأني قرأت عقد الإيجار كاملاً، وأوافق على جميع شروطه، وأتعهد بالمسؤولية القانونية والمالية الكاملة عن المعدات. (التأشير هنا بمثابة توقيع ملزم)";

const STATUS = {
  out: { label: "في العهدة", cls: "bg-amber-950 text-amber-300 border-amber-800" },
  review_handover: { label: "بانتظار اعتماد التسليم", cls: "bg-sky-950 text-sky-300 border-sky-800" },
  rented: { label: "مُسلّمة للمستأجر", cls: "bg-amber-950 text-amber-300 border-amber-800" },
  review_return: { label: "بانتظار مراجعة الإرجاع", cls: "bg-sky-950 text-sky-300 border-sky-800" },
  closed: { label: "مقفلة", cls: "bg-emerald-950 text-emerald-300 border-emerald-800" },
  rejected: { label: "مرفوضة", cls: "bg-red-950 text-red-300 border-red-800" },
  flagged: { label: "مقفلة مع مطالبة", cls: "bg-red-950 text-red-300 border-red-800" },
};

const ROLES = [
  { id: "employee", label: "موظف", icon: User },
  { id: "renter", label: "مستأجر", icon: Package },
  { id: "admin", label: "الأدمن", icon: ShieldCheck },
];

const nowLabel = () => new Date().toLocaleString("ar-SA", { hour: "2-digit", minute: "2-digit" });
const fmt = (s) => {
  if (!s) return "";
  if (("" + s).includes("T")) {
    try { return new Date(s).toLocaleString("ar-SA", { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return s; }
  }
  return s;
};

const SEED = [
  {
    id: "KM-001", kind: "rental", party: "شركة الواحة للفعاليات", partyRole: "renter",
    renterInfo: { name: "شركة الواحة للفعاليات", idNumber: "1•••••••••", phone: "05••••••••", email: "events@alwaha.sa", address: "الدمام — حي الشاطئ" },
    items: [
      { id: 1, name: "كاميرا Sony FX6", qty: 1, photoBefore: "SEED", photoAfter: null },
      { id: 2, name: "عدسة 24-70mm", qty: 1, photoBefore: "SEED", photoAfter: null },
    ],
    overallBefore: "SEED", overallAfter: null,
    ack: { signed: true, signature: "شركة الواحة للفعاليات", at: "2026-06-29T08:10:00", type: "rental_contract" },
    status: "review_handover", shortage: false, shortageNote: "", adminNote: "",
    events: [{ at: "08:10", text: "طلب تأجير + توقيع عقد الإيجار" }], createdAt: Date.now() - 3600000,
  },
  {
    id: "KM-002", kind: "custody", party: "سعد القحطاني — مصوّر", partyRole: "employee",
    items: [
      { id: 1, name: "درون DJI Mavic 3", qty: 1, photoBefore: "SEED", photoAfter: "SEED" },
      { id: 2, name: "بطاريات درون", qty: 3, photoBefore: "SEED", photoAfter: "SEED" },
      { id: 3, name: "حامل ثلاثي", qty: 1, photoBefore: "SEED", photoAfter: "SEED" },
    ],
    overallBefore: "SEED", overallAfter: "SEED",
    ack: { signed: true, signature: "سعد القحطاني", at: "2026-06-28T15:00:00", type: "custody" },
    status: "review_return", shortage: true, shortageNote: "بطارية درون مفقودة (٢ بدل ٣)", adminNote: "",
    events: [{ at: "أمس 15:00", text: "خروج العدة" }, { at: "09:40", text: "إرجاع — بلاغ نقص" }], createdAt: Date.now() - 7200000,
  },
];

const SEED_NOTIFS = [
  { id: 1, audience: "admin", text: "طلب تأجير جديد من شركة الواحة (KM-001) — بانتظار اعتماد التسليم", urgent: false, at: "08:10" },
  { id: 2, audience: "admin", text: "⚠ نقص في العهدة KM-002: بطارية درون مفقودة — يحتاج إجراء", urgent: true, at: "09:40" },
  { id: 3, audience: "employee", text: "تم تسجيل إرجاعك للعهدة KM-002 وبانتظار مراجعة الإدارة", urgent: false, at: "09:40" },
];

function Viewfinder({ children, active }) {
  const c = active ? "border-red-500" : "border-stone-600";
  return (
    <div className="relative">
      {children}
      <span className={`pointer-events-none absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 ${c}`} />
      <span className={`pointer-events-none absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 ${c}`} />
      <span className={`pointer-events-none absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 ${c}`} />
      <span className={`pointer-events-none absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 ${c}`} />
    </div>
  );
}

function ItemShot({ value, onCapture }) {
  const ref = useRef(null);
  const handle = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => onCapture(rd.result);
    rd.readAsDataURL(f);
  };
  return (
    <>
      <button type="button" onClick={() => ref.current && ref.current.click()}
        className={`w-14 h-12 border overflow-hidden flex items-center justify-center bg-stone-900 focus:outline-none focus:ring-2 focus:ring-red-500 ${value ? "border-red-500" : "border-stone-600 border-dashed"}`}>
        {value ? <img src={value} alt="" className="w-full h-full object-cover" /> : <Camera size={16} className="text-stone-500" />}
      </button>
      <input ref={ref} type="file" accept="image/*" capture="environment" onChange={handle} className="hidden" />
    </>
  );
}

function Thumb({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-xs text-stone-500 mb-0.5 font-mono">{label}</div>
      <div className="w-14 h-12 bg-stone-900 border border-stone-700 overflow-hidden flex items-center justify-center">
        {value && ("" + value).indexOf("data:") === 0
          ? <img src={value} alt="" className="w-full h-full object-cover" />
          : value === "SEED" ? <Aperture size={14} className="text-stone-600" /> : <span className="text-stone-700 text-xs">—</span>}
      </div>
    </div>
  );
}

function PhotoCapture({ label, value, onCapture }) {
  const ref = useRef(null);
  const handle = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => onCapture(rd.result);
    rd.readAsDataURL(f);
  };
  return (
    <div className="flex-1">
      <div className="text-xs text-stone-400 mb-1 font-mono">{label}</div>
      <Viewfinder active={!!value}>
        <button type="button" onClick={() => ref.current && ref.current.click()}
          className="w-full h-28 bg-stone-800 overflow-hidden flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-red-500">
          {value ? <img src={value} alt="" className="w-full h-full object-cover" />
            : <span className="flex flex-col items-center gap-1 text-stone-500 text-xs"><Camera size={22} />اضغط للتصوير</span>}
        </button>
      </Viewfinder>
      <input ref={ref} type="file" accept="image/*" capture="environment" onChange={handle} className="hidden" />
    </div>
  );
}

function PhotoView({ label, value }) {
  return (
    <div className="flex-1">
      <div className="text-xs text-stone-500 mb-1 font-mono">{label}</div>
      <Viewfinder active={false}>
        <div className="h-20 bg-stone-800 overflow-hidden flex items-center justify-center">
          {value && ("" + value).indexOf("data:") === 0
            ? <img src={value} alt="" className="w-full h-full object-cover" />
            : value === "SEED" ? <Aperture size={20} className="text-stone-600" /> : <span className="text-stone-600 text-xs">لا توجد صورة</span>}
        </div>
      </Viewfinder>
    </div>
  );
}

function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, cls: "bg-stone-800 text-stone-300 border-stone-700" };
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>;
}

function SectionTitle({ icon: Icon, title, hint }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={18} className="text-red-400" />
      <h2 className="text-base font-medium">{title}</h2>
      {hint != null && <span className="text-xs text-stone-500 font-mono">{hint}</span>}
    </div>
  );
}

function Empty({ text }) {
  return <div className="text-sm text-stone-500 text-center bg-stone-900 border border-dashed border-stone-800 rounded-xl py-6 px-4">{text}</div>;
}

function NotifList({ items }) {
  if (items.length === 0) return <div className="text-sm text-stone-500 text-center py-4">لا توجد إشعارات.</div>;
  return (
    <div className="space-y-2">
      {items.map((n) => (
        <div key={n.id} className={`rounded-lg px-3 py-2 text-sm border ${n.urgent ? "bg-red-950 border-red-800 text-red-200" : "bg-stone-800 border-stone-700 text-stone-200"}`}>
          <div className="flex items-start gap-2">
            {n.urgent ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" /> : <Bell size={15} className="mt-0.5 shrink-0 text-stone-400" />}
            <div className="flex-1">
              <div>{n.text}</div>
              <div className="flex items-center gap-2 mt-1 flex-wrap text-stone-500">
                <span className="font-mono text-xs">{n.at}</span>
                <span className="text-xs text-stone-600">أُرسل عبر:</span>
                <span className="inline-flex items-center gap-1 text-xs"><Bell size={11} />بوابة</span>
                <span className="inline-flex items-center gap-1 text-xs"><Mail size={11} />إيميل</span>
                <span className="inline-flex items-center gap-1 text-xs text-stone-600"><MessageCircle size={11} />واتساب</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ItemPhotoEditor({ items, setItems }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const add = () => {
    if (!name.trim()) return;
    setItems([...items, { id: Date.now() + Math.random(), name: name.trim(), qty: Number(qty) || 1, photo: null }]);
    setName(""); setQty(1);
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="اسم المعدة (مثال: كاميرا Sony FX6)"
          className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:ring-2 focus:ring-red-500" />
        <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)}
          className="w-16 bg-stone-800 border border-stone-700 rounded-lg px-2 py-2 text-sm text-stone-100 text-center focus:outline-none focus:ring-2 focus:ring-red-500" />
        <button type="button" onClick={add} className="bg-stone-700 hover:bg-stone-600 text-white rounded-lg px-3 flex items-center focus:outline-none focus:ring-2 focus:ring-red-500"><Plus size={18} /></button>
      </div>
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-2 bg-stone-800 rounded-lg p-2">
          <div className="flex-1 min-w-0"><div className="text-sm truncate">{it.name}</div><div className="font-mono text-xs text-stone-400">×{it.qty}</div></div>
          <ItemShot value={it.photo} onCapture={(d) => setItems(items.map((x) => x.id === it.id ? { ...x, photo: d } : x))} />
          <button type="button" onClick={() => setItems(items.filter((x) => x.id !== it.id))} className="text-stone-500 hover:text-red-400"><Trash2 size={15} /></button>
        </div>
      ))}
      {items.length === 0 && <div className="text-xs text-stone-500">أضف المعدات، وصوّر كل قطعة (📷 بجانبها).</div>}
    </div>
  );
}

function SignBlock({ title, clauses, signerName, accepted, setAccepted, agreeText }) {
  return (
    <div className="bg-stone-800 border border-stone-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-stone-200"><FileSignature size={15} className="text-red-400" />{title}</div>
      <div className="max-h-40 overflow-y-auto bg-stone-900 border border-stone-700 rounded-lg p-3 text-xs text-stone-400 leading-relaxed space-y-1">
        {clauses.map((c, i) => (<div key={i} className="flex gap-2"><span className="font-mono text-stone-600 shrink-0">{i + 1}.</span><span>{c}</span></div>))}
      </div>
      <label className="flex items-start gap-2 text-sm text-stone-200">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="w-4 h-4 mt-0.5 accent-red-600" />
        <span>{agreeText}</span>
      </label>
      {accepted && <div className="text-xs text-emerald-400 font-mono flex items-center gap-1"><CheckCircle2 size={13} />وُقّع إلكترونياً باسم: {signerName} • {nowLabel()}</div>}
    </div>
  );
}

function CheckoutForm({ onSubmit }) {
  const [items, setItems] = useState([]);
  const [overall, setOverall] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [err, setErr] = useState("");
  const submit = () => {
    if (items.length === 0) return setErr("أضف صنفاً واحداً على الأقل.");
    if (items.some((it) => !it.photo)) return setErr("صوّر كل قطعة قبل الإرسال.");
    if (!overall) return setErr("صوّر إجمالي المعدات قبل الإرسال.");
    if (!accepted) return setErr("أشّر على الإقرار قبل الإرسال.");
    setErr("");
    onSubmit({ items, overall });
    setItems([]); setOverall(null); setAccepted(false);
  };
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-4">
      <div className="bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-400 font-mono">العهدة باسم (من حسابك): {EMPLOYEE.name} • {EMPLOYEE.phone}</div>
      <div><div className="text-xs text-stone-400 mb-2 font-mono">المعدات الخارجة — صوّر كل قطعة</div><ItemPhotoEditor items={items} setItems={setItems} /></div>
      <div className="flex gap-3"><PhotoCapture label="صورة إجمالي المعدات (بعد تصوير القطع)" value={overall} onCapture={setOverall} /></div>
      <SignBlock title="إقرار استلام عهدة" clauses={CUSTODY_CLAUSES} signerName={EMPLOYEE.name} accepted={accepted} setAccepted={setAccepted} agreeText={CUSTODY_AGREE} />
      {err && <div className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle size={15} />{err}</div>}
      <button onClick={submit} className="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-500"><Send size={16} />إرسال خروج العدة</button>
    </div>
  );
}

function RenterRegister({ onRegister }) {
  const [f, setF] = useState({ name: "", idNumber: "", phone: "", email: "", address: "" });
  const [err, setErr] = useState("");
  const up = (k, v) => setF({ ...f, [k]: v });
  const submit = () => {
    if (!f.name.trim() || !f.idNumber.trim() || !f.phone.trim() || !f.email.trim() || !f.address.trim()) return setErr("كل الحقول مطلوبة لفتح الحساب.");
    setErr("");
    onRegister({ name: f.name.trim(), idNumber: f.idNumber.trim(), phone: f.phone.trim(), email: f.email.trim(), address: f.address.trim() });
  };
  const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:ring-2 focus:ring-red-500";
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-3">
      <p className="text-sm text-stone-400">فتح الحساب شرط أساسي قبل التسليم. عبّئ بياناتك:</p>
      <input className={inp} placeholder="الاسم الكامل / الجهة" value={f.name} onChange={(e) => up("name", e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input className={inp} placeholder="رقم الهوية / الإقامة" value={f.idNumber} onChange={(e) => up("idNumber", e.target.value)} />
        <input className={inp} placeholder="رقم الجوال" value={f.phone} onChange={(e) => up("phone", e.target.value)} />
      </div>
      <input className={inp} placeholder="البريد الإلكتروني" value={f.email} onChange={(e) => up("email", e.target.value)} />
      <input className={inp} placeholder="العنوان" value={f.address} onChange={(e) => up("address", e.target.value)} />
      {err && <div className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle size={15} />{err}</div>}
      <button onClick={submit} className="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-500"><User size={16} />فتح حساب مستأجر</button>
    </div>
  );
}

function RentalForm({ profile, onSubmit }) {
  const [items, setItems] = useState([]);
  const [overall, setOverall] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [err, setErr] = useState("");
  const submit = () => {
    if (items.length === 0) return setErr("أضف صنفاً واحداً على الأقل.");
    if (items.some((it) => !it.photo)) return setErr("صوّر كل قطعة قبل الإرسال.");
    if (!overall) return setErr("صوّر إجمالي المعدات قبل الإرسال.");
    if (!accepted) return setErr("أشّر على عقد الإيجار قبل الإرسال.");
    setErr("");
    onSubmit({ items, overall });
    setItems([]); setOverall(null); setAccepted(false);
  };
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-4">
      <div className="bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-400 font-mono">المستأجر (من حسابك): {profile.name} • {profile.phone}</div>
      <div><div className="text-xs text-stone-400 mb-2 font-mono">المعدات المستأجرة — صوّر كل قطعة</div><ItemPhotoEditor items={items} setItems={setItems} /></div>
      <div className="flex gap-3"><PhotoCapture label="صورة إجمالي المعدات (بعد تصوير القطع)" value={overall} onCapture={setOverall} /></div>
      <SignBlock title="عقد إيجار معدات — كيان" clauses={RENT_CLAUSES} signerName={profile.name} accepted={accepted} setAccepted={setAccepted} agreeText={RENT_AGREE} />
      {err && <div className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle size={15} />{err}</div>}
      <button onClick={submit} className="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-500"><Send size={16} />إرسال طلب التسليم</button>
    </div>
  );
}

function ReturnPanel({ items, onSubmit }) {
  const [afters, setAfters] = useState({});
  const [overall, setOverall] = useState(null);
  const [shortage, setShortage] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const submit = () => {
    if (items.some((it) => !afters[it.id])) return setErr("صوّر كل قطعة عند الإرجاع.");
    if (!overall) return setErr("صوّر إجمالي المعدات عند الإرجاع.");
    if (shortage && !note.trim()) return setErr("اكتب وصف النقص أو التلف.");
    setErr("");
    onSubmit({ afters, overall, shortage, note: note.trim() });
  };
  return (
    <div className="border-t border-stone-800 pt-3 space-y-3">
      <div className="text-xs text-stone-400 font-mono">الإرجاع — صوّر كل قطعة + الإجمالي</div>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 bg-stone-800 rounded-lg p-2">
            <div className="flex-1 min-w-0"><div className="text-sm truncate">{it.name}</div><div className="font-mono text-xs text-stone-400">×{it.qty}</div></div>
            <ItemShot value={afters[it.id]} onCapture={(d) => setAfters({ ...afters, [it.id]: d })} />
          </div>
        ))}
      </div>
      <div className="flex gap-3"><PhotoCapture label="صورة إجمالي المعدات عند الإرجاع" value={overall} onCapture={setOverall} /></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setShortage(false)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${!shortage ? "bg-emerald-950 border-emerald-700 text-emerald-300" : "bg-stone-800 border-stone-700 text-stone-300"}`}><CheckCircle2 size={16} />الكل سليم وكامل</button>
        <button type="button" onClick={() => setShortage(true)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${shortage ? "bg-red-950 border-red-700 text-red-300" : "bg-stone-800 border-stone-700 text-stone-300"}`}><AlertTriangle size={16} />يوجد نقص/تلف</button>
      </div>
      {shortage && <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="صف النقص أو التلف (مثال: عدسة بها خدش / بطارية مفقودة)"
        className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:ring-2 focus:ring-red-500" />}
      {err && <div className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle size={15} />{err}</div>}
      <button onClick={submit} className="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-500"><Send size={16} />إرسال الإرجاع للإدارة</button>
      <p className="text-xs text-stone-500 text-center">الإقفال النهائي من الأدمن فقط.</p>
    </div>
  );
}

function AdminActions({ r, onApprove, onClose, onReject, onNote }) {
  const [note, setNote] = useState("");
  const primary = r.status === "review_handover" ? { label: "اعتماد التسليم", fn: onApprove } : { label: "إقفال العهدة", fn: onClose };
  return (
    <div className="border-t border-stone-800 pt-3 space-y-2">
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة للمستلِم (اختياري)"
        className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:ring-2 focus:ring-red-500" />
      <div className="flex flex-wrap gap-2">
        <button onClick={primary.fn} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-500"><CheckCircle2 size={16} />{primary.label}</button>
        <button onClick={() => { if (note.trim()) { onNote(note.trim()); setNote(""); } }} className="bg-stone-800 border border-stone-700 text-stone-200 rounded-lg px-4 py-2 text-sm">إضافة ملاحظة</button>
        <button onClick={() => onReject(note.trim() || "بدون سبب محدد")} className="bg-stone-800 border border-stone-700 text-red-300 rounded-lg px-4 py-2 text-sm flex items-center gap-2"><XCircle size={16} />رفض</button>
      </div>
    </div>
  );
}

function RecordCard({ r, children }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {r.kind === "rental" ? <Package size={16} className="text-red-400" /> : <User size={16} className="text-red-400" />}
          <span className="font-medium">{r.party}</span>
        </div>
        <span className="font-mono text-xs text-stone-500">{r.id}</span>
      </div>
      {r.renterInfo && (
        <div className="text-xs text-stone-500 font-mono space-y-0.5">
          <div>هوية: {r.renterInfo.idNumber} • جوال: {r.renterInfo.phone}</div>
          <div>بريد: {r.renterInfo.email} • عنوان: {r.renterInfo.address}</div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <StatusBadge status={r.status} />
        <span className="text-xs text-stone-500">{r.kind === "rental" ? "تأجير خارجي" : "عهدة داخلية"}</span>
      </div>
      {r.shortage && (
        <div className="flex items-start gap-2 bg-red-950 border border-red-800 text-red-300 rounded-lg px-3 py-2 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{r.shortageNote || "يوجد نقص/تلف"}</span>
        </div>
      )}
      <div className="space-y-2">
        <div className="text-xs text-stone-500 font-mono">المعدات — صورة لكل قطعة</div>
        {r.items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 bg-stone-800 rounded-lg p-2">
            <div className="flex-1 min-w-0"><div className="text-sm truncate">{it.name}</div><div className="font-mono text-xs text-stone-400">×{it.qty}</div></div>
            <Thumb label="قبل" value={it.photoBefore} />
            <Thumb label="بعد" value={it.photoAfter} />
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <PhotoView label="إجمالي — قبل" value={r.overallBefore} />
        <PhotoView label="إجمالي — بعد" value={r.overallAfter} />
      </div>
      {r.ack && r.ack.signed && (
        <div className="flex items-center gap-2 text-xs text-stone-400 flex-wrap">
          <FileSignature size={14} /><span>وُقّع: {r.ack.signature}</span>
          <span className="font-mono text-stone-600">{fmt(r.ack.at)}</span>
          <span className="text-stone-600">— {r.ack.type === "rental_contract" ? "عقد إيجار" : "إقرار عهدة"}</span>
        </div>
      )}
      {r.adminNote && <div className="text-sm bg-stone-800 border-r-2 border-red-600 px-3 py-2 text-stone-300">ملاحظة الإدارة: {r.adminNote}</div>}
      {r.events && r.events.length > 0 && (
        <div className="text-xs text-stone-500 space-y-0.5 border-t border-stone-800 pt-2">
          {r.events.map((e, i) => (<div key={i} className="flex items-center gap-2"><Clock size={11} /><span className="font-mono">{e.at}</span><span>{e.text}</span></div>))}
        </div>
      )}
      {children}
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState("employee");
  const [records, setRecords] = useState(SEED);
  const [notifications, setNotifications] = useState(SEED_NOTIFS);
  const [renterProfile, setRenterProfile] = useState(null);
  const [showNotif, setShowNotif] = useState(false);
  const [seq, setSeq] = useState(3);

  const nextId = () => { const id = `KM-${String(seq).padStart(3, "0")}`; setSeq(seq + 1); return id; };
  const pushNotif = (audience, text, urgent = false) =>
    setNotifications((prev) => [{ id: Date.now() + Math.random(), audience, text, urgent, at: nowLabel() }, ...prev]);

  const addCustody = (form) => {
    const id = nextId();
    const rec = {
      id, kind: "custody", party: EMPLOYEE.name, partyRole: "employee",
      items: form.items.map((it) => ({ id: it.id, name: it.name, qty: it.qty, photoBefore: it.photo, photoAfter: null })),
      overallBefore: form.overall, overallAfter: null,
      ack: { signed: true, signature: EMPLOYEE.name, at: new Date().toISOString(), type: "custody" },
      status: "out", shortage: false, shortageNote: "", adminNote: "",
      events: [{ at: nowLabel(), text: "خروج العدة + توقيع الإقرار" }], createdAt: Date.now(),
    };
    setRecords((prev) => [rec, ...prev]);
    pushNotif("admin", `استلم الموظف ${EMPLOYEE.name} عهدة جديدة (${id})`, false);
    pushNotif("employee", `تم تسجيل استلامك للعهدة (${id}) — أنت مسؤول عنها حتى الإقفال من الإدارة`, false);
  };

  const addRental = (form) => {
    const id = nextId();
    const rec = {
      id, kind: "rental", party: renterProfile.name, partyRole: "renter", renterInfo: { ...renterProfile },
      items: form.items.map((it) => ({ id: it.id, name: it.name, qty: it.qty, photoBefore: it.photo, photoAfter: null })),
      overallBefore: form.overall, overallAfter: null,
      ack: { signed: true, signature: renterProfile.name, at: new Date().toISOString(), type: "rental_contract" },
      status: "review_handover", shortage: false, shortageNote: "", adminNote: "",
      events: [{ at: nowLabel(), text: "طلب تأجير + توقيع عقد الإيجار" }], createdAt: Date.now(),
    };
    setRecords((prev) => [rec, ...prev]);
    pushNotif("admin", `طلب تأجير جديد من ${renterProfile.name} (${id}) — بانتظار اعتماد التسليم`, false);
    pushNotif("renter", `تم استلام طلب التأجير (${id}) وبانتظار اعتماد الإدارة للتسليم`, false);
  };

  const submitReturn = (id, d) => {
    const r = records.find((x) => x.id === id);
    const aud = (r && r.partyRole) || "employee";
    setRecords((prev) => prev.map((x) => x.id === id ? {
      ...x,
      items: x.items.map((it) => ({ ...it, photoAfter: d.afters[it.id] || it.photoAfter || null })),
      overallAfter: d.overall, status: "review_return", shortage: d.shortage, shortageNote: d.note,
      events: [...x.events, { at: nowLabel(), text: d.shortage ? "إرجاع — بلاغ نقص/تلف" : "إرجاع العدة" }],
    } : x));
    if (d.shortage) pushNotif("admin", `⚠ نقص/تلف في ${id}: ${d.note} — يحتاج إجراء`, true);
    else pushNotif("admin", `إرجاع ${id} بانتظار مراجعتك`, false);
    pushNotif(aud, `تم تسجيل إرجاعك (${id}) وبانتظار مراجعة الإدارة`, false);
  };

  const adminApprove = (id) => {
    const r = records.find((x) => x.id === id);
    setRecords((prev) => prev.map((x) => x.id === id ? { ...x, status: "rented", events: [...x.events, { at: nowLabel(), text: "اعتماد التسليم من الإدارة" }] } : x));
    pushNotif((r && r.partyRole) || "renter", `تم اعتماد تسليم ${id} — المعدات بعهدتك الآن`, false);
  };

  const adminClose = (id) => {
    const r = records.find((x) => x.id === id);
    const flagged = r && r.shortage;
    setRecords((prev) => prev.map((x) => x.id === id ? { ...x, status: flagged ? "flagged" : "closed", events: [...x.events, { at: nowLabel(), text: flagged ? "إقفال مع تسجيل مطالبة بالنقص" : "إقفال العهدة" }] } : x));
    pushNotif((r && r.partyRole) || "employee", flagged ? `تم إقفال ${id} مع تسجيل مطالبة بالنقص` : `تم إقفال العهدة ${id} بنجاح`, false);
  };

  const adminReject = (id, note) => {
    const r = records.find((x) => x.id === id);
    setRecords((prev) => prev.map((x) => x.id === id ? { ...x, status: "rejected", adminNote: note, events: [...x.events, { at: nowLabel(), text: "رفض الطلب" }] } : x));
    pushNotif((r && r.partyRole) || "employee", `تم رفض ${id}: ${note}`, false);
  };

  const adminNote = (id, note) => {
    const r = records.find((x) => x.id === id);
    setRecords((prev) => prev.map((x) => x.id === id ? { ...x, adminNote: note, events: [...x.events, { at: nowLabel(), text: "ملاحظة من الإدارة" }] } : x));
    pushNotif((r && r.partyRole) || "employee", `ملاحظة من الإدارة على ${id}: ${note}`, false);
  };

  const myNotifs = notifications.filter((n) => n.audience === role);
  const custodyRecords = records.filter((r) => r.kind === "custody");
  const rentalRecords = records.filter((r) => r.kind === "rental");
  const pending = records
    .filter((r) => r.status === "review_handover" || r.status === "review_return")
    .sort((a, b) => (b.shortage ? 1 : 0) - (a.shortage ? 1 : 0));
  const urgent = records.filter((r) => r.shortage && r.status === "review_return");

  return (
    <div dir="rtl" className="min-h-screen bg-stone-950 text-stone-200 font-sans">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-5">
        <header className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Aperture size={24} className="text-red-500" />
              <div>
                <div className="text-lg font-medium leading-tight">كيان <span className="text-stone-500 text-sm">| العهدة والتأجير</span></div>
                <div className="text-xs text-stone-500">استلام وتسليم المعدات بأدلة موثّقة</div>
              </div>
            </div>
            <button onClick={() => setShowNotif(!showNotif)} className="relative bg-stone-900 border border-stone-800 rounded-lg p-2 text-stone-300 hover:border-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500">
              <Bell size={18} />
              {myNotifs.length > 0 && <span className="absolute -top-1 -left-1 bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{myNotifs.length}</span>}
            </button>
          </div>

          <div className="text-xs text-stone-500 bg-stone-900 border border-stone-800 rounded-lg px-3 py-2">
            نسخة تجريبية — البيانات داخل متصفحك فقط. الإقفال من الأدمن فقط. الإشعارات: بوابة وإيميل فعّالة، والواتساب يُفعّل بعد توثيق Meta.
          </div>

          <div>
            <div className="text-xs text-stone-500 mb-1">اعرض كـ (للتجربة):</div>
            <div className="grid grid-cols-3 gap-2">
              {ROLES.map((R) => {
                const Icon = R.icon; const a = role === R.id;
                return (
                  <button key={R.id} onClick={() => setRole(R.id)} className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${a ? "bg-red-600 border-red-600 text-white" : "bg-stone-900 border-stone-800 text-stone-300 hover:border-stone-600"}`}>
                    <Icon size={16} />{R.label}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {showNotif && (
          <section className="bg-stone-900 border border-stone-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3"><Bell size={16} className="text-red-400" /><h2 className="font-medium">إشعاراتك</h2></div>
            <NotifList items={myNotifs} />
          </section>
        )}

        {role === "employee" && (
          <>
            <section>
              <SectionTitle icon={Package} title="عهدي الحالية" />
              <div className="space-y-3">
                {custodyRecords.length === 0 && <Empty text="لا توجد عهد حالياً. ابدأ بطلب خروج عدة بالأسفل." />}
                {custodyRecords.map((r) => (
                  <RecordCard key={r.id} r={r}>
                    {r.status === "out" && <ReturnPanel items={r.items} onSubmit={(d) => submitReturn(r.id, d)} />}
                  </RecordCard>
                ))}
              </div>
            </section>
            <section>
              <SectionTitle icon={Plus} title="طلب خروج عدة" />
              <CheckoutForm onSubmit={addCustody} />
            </section>
          </>
        )}

        {role === "renter" && (
          !renterProfile ? (
            <section>
              <SectionTitle icon={User} title="فتح حساب مستأجر" />
              <RenterRegister onRegister={setRenterProfile} />
            </section>
          ) : (
            <>
              <section className="bg-stone-900 border border-stone-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2"><ShieldCheck size={16} className="text-emerald-400" /><span className="text-sm font-medium">حسابك مفعّل كمستأجر</span></div>
                <div className="text-xs text-stone-400 font-mono space-y-0.5">
                  <div>{renterProfile.name}</div>
                  <div>هوية: {renterProfile.idNumber} • جوال: {renterProfile.phone}</div>
                  <div>بريد: {renterProfile.email}</div>
                  <div>عنوان: {renterProfile.address}</div>
                </div>
              </section>
              <section><SectionTitle icon={Package} title="تأجير المعدات" /><RentalForm profile={renterProfile} onSubmit={addRental} /></section>
              <section>
                <SectionTitle icon={FileSignature} title="تأجيراتي" />
                <div className="space-y-3">
                  {rentalRecords.length === 0 && <Empty text="لا توجد تأجيرات بعد." />}
                  {rentalRecords.map((r) => (
                    <RecordCard key={r.id} r={r}>
                      {r.status === "rented" && <ReturnPanel items={r.items} onSubmit={(d) => submitReturn(r.id, d)} />}
                    </RecordCard>
                  ))}
                </div>
              </section>
            </>
          )
        )}

        {role === "admin" && (
          <>
            {urgent.length > 0 && (
              <section className="bg-red-950 border border-red-700 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2 text-red-300"><AlertTriangle size={18} /><h2 className="font-medium">تنبيهات عاجلة</h2></div>
                <div className="space-y-2">
                  {urgent.map((r) => (
                    <div key={r.id} className="text-sm text-red-200 flex items-center justify-between gap-2">
                      <span>{r.id} — {r.shortageNote}</span><span className="font-mono text-xs text-red-400">{r.party}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section>
              <SectionTitle icon={Clock} title="بانتظار إجرائك" hint={pending.length} />
              <div className="space-y-3">
                {pending.length === 0 && <Empty text="لا توجد طلبات تنتظر إجراءً." />}
                {pending.map((r) => (
                  <RecordCard key={r.id} r={r}>
                    <AdminActions r={r} onApprove={() => adminApprove(r.id)} onClose={() => adminClose(r.id)} onReject={(note) => adminReject(r.id, note)} onNote={(note) => adminNote(r.id, note)} />
                  </RecordCard>
                ))}
              </div>
            </section>
            <section>
              <SectionTitle icon={ShieldCheck} title="كل السجلات" hint={records.length} />
              <div className="space-y-3">
                {records.map((r) => (<RecordCard key={r.id} r={r} />))}
              </div>
            </section>
          </>
        )}

        <footer className="text-xs text-stone-600 text-center pt-2">كيان الابتكار للإنتاج الفني — بروتوتايب نظام العهدة والتأجير</footer>
      </div>
    </div>
  );
}
