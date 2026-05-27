import Image from "next/image";
const SOCIALS=[
  {l:"IG",h:"https://www.instagram.com/kian.alebtikar"},
  {l:"YT",h:"https://www.youtube.com/@kianalebtikar"},
  {l:"TK",h:"https://www.tiktok.com/@kianmedia1"},
  {l:"X", h:"https://www.x.com/kianalebtikar"},
  {l:"LI",h:"https://www.linkedin.com/company/kian-media-production/"},
];
const COLS=[
  {title:"الصفحات",links:[{t:"الرئيسية",h:"#"},{t:"من نحن",h:"#about"},{t:"خدماتنا",h:"#services"},{t:"أعمالنا",h:"#portfolio"}]},
  {title:"الخدمات",links:[{t:"الإنتاج السينمائي",h:"#"},{t:"التصوير الجوي",h:"#"},{t:"البث المباشر",h:"#"},{t:"الأعراس",h:"#"},{t:"الفعاليات",h:"#"}]},
  {title:"تواصل",links:[{t:"+966 503 422 999",h:"tel:+966503422999"},{t:"+966 543 553 038",h:"tel:+966543553038"},{t:"info@kianmedia.com",h:"mailto:info@kianmedia.com"},{t:"المملكة العربية السعودية",h:"#"}]},
];
export default function Footer(){
  return (
    <footer style={{background:"#030303",borderTop:"1px solid rgba(227,30,36,.14)",paddingTop:"56px",paddingBottom:"28px"}}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div className="relative" style={{width:"52px",height:"52px",border:"1px solid rgba(227,30,36,.28)"}}>
                <Image src="/logo.png" alt="Kian" fill className="object-contain p-1"/>
              </div>
              <div className="f-bebas text-white" style={{fontSize:"20px",letterSpacing:"5px"}}>KIAN MEDIA</div>
            </div>
            <p className="text-white/30 text-sm leading-relaxed mb-6" style={{maxWidth:"230px"}}>
              كيان الابتكار للإنتاج الفني — محتوى بصري استثنائي في جميع مناطق المملكة.
            </p>
            <div className="flex gap-2">
              {SOCIALS.map(s=>(
                <a key={s.l} href={s.h} target="_blank" rel="noopener noreferrer"
                  className="f-mont flex items-center justify-center text-white/30 transition-all"
                  style={{width:"34px",height:"34px",border:"1px solid rgba(227,30,36,.2)",fontSize:"9px",fontWeight:700,textDecoration:"none"}}
                  onMouseEnter={e=>{(e.currentTarget as HTMLAnchorElement).style.borderColor="#E31E24";(e.currentTarget as HTMLAnchorElement).style.color="#E31E24"}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLAnchorElement).style.borderColor="rgba(227,30,36,.2)";(e.currentTarget as HTMLAnchorElement).style.color="rgba(255,255,255,.3)"}}>
                  {s.l}
                </a>
              ))}
            </div>
          </div>
          {COLS.map(col=>(
            <div key={col.title}>
              <h4 className="f-mont mb-5" style={{fontSize:"8px",letterSpacing:"4px",color:"#E31E24",textTransform:"uppercase"}}>
                {col.title}
              </h4>
              <ul style={{listStyle:"none",display:"flex",flexDirection:"column",gap:"10px"}}>
                {col.links.map(l=>(
                  <li key={l.t}>
                    <a href={l.h} className="text-white/35 text-sm transition-colors"
                      style={{textDecoration:"none"}}
                      onMouseEnter={e=>(e.currentTarget.style.color="#E31E24")}
                      onMouseLeave={e=>(e.currentTarget.style.color="rgba(255,255,255,.35)")}>
                      {l.t}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-6"
          style={{borderTop:"1px solid rgba(255,255,255,.04)"}}>
          <p className="f-mont text-white/18" style={{fontSize:"10px",letterSpacing:"1px"}}>
            © 2026 Kian Al Ebtikar For Art Production — جميع الحقوق محفوظة
          </p>
          <a href="mailto:info@kianmedia.com"
            className="f-mont transition-colors" style={{fontSize:"10px",letterSpacing:"1px",color:"rgba(163,20,25,.45)",textDecoration:"none"}}
            onMouseEnter={e=>(e.currentTarget.style.color="#E31E24")}
            onMouseLeave={e=>(e.currentTarget.style.color="rgba(163,20,25,.45)")}>
            info@kianmedia.com
          </a>
        </div>
      </div>
    </footer>
  );
}
