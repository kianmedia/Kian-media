"use client";
import { motion } from "framer-motion";
const T=[
  {q:"فريق كيان قدّم لنا تغطية استثنائية للمهرجان — احتراف في كل تفصيلة من التصوير حتى التسليم.",name:"محمد العتيبي",role:"مدير فعاليات",av:"م"},
  {q:"الوثائقي تجاوز كل توقعاتنا. صور جوية مذهلة وسرد بصري راقٍ يعكس قيمة المشروع.",name:"فهد الزهراني",role:"مطور عقاري",av:"ف"},
  {q:"من أفضل فرق الإنتاج في المنطقة الشرقية — التزام بالمواعيد وجودة عالية وتعامل راقٍ.",name:"سارة المحمد",role:"مديرة تسويق",av:"س"},
];
const CLIENTS=["شركة العتيشان","ريفايفا","مسكوب","الزاهد","معهد سين","مهرجان أفلام السعودية"];
export default function Testimonials(){
  return (
    <section style={{background:"#0a0a0a",paddingTop:"112px",paddingBottom:"112px"}} className="text-center">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="flex items-center justify-center gap-4 mb-5">
          <span style={{width:"28px",height:"1px",background:"rgba(193,18,31,.55)",display:"block"}}/>
          <div className="sec-label">آراء عملائنا</div>
          <span style={{width:"28px",height:"1px",background:"rgba(193,18,31,.55)",display:"block"}}/>
        </div>
        <motion.h2 initial={{opacity:0,y:20}} whileInView={{opacity:1,y:0}} viewport={{once:true}} className="sec-title mb-14">
          ثقتهم أكبر <span className="r">جائزة</span>
        </motion.h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px" style={{background:"rgba(193,18,31,.1)"}}>
          {T.map((t,i)=>(
            <motion.div key={t.name}
              initial={{opacity:0,y:28}} whileInView={{opacity:1,y:0}} viewport={{once:true}} transition={{delay:i*.12,duration:.68}}
              className="test-c p-12 text-right" style={{background:"#111"}}>
              <span className="f-bebas block mb-4 leading-none" style={{fontSize:"88px",color:"rgba(193,18,31,.1)"}}>
                "
              </span>
              <p className="text-white/60 text-sm leading-loose mb-9">{t.q}</p>
              <div className="flex items-center justify-end gap-4">
                <div>
                  <div className="text-white text-sm font-semibold">{t.name}</div>
                  <div className="f-mont mt-1" style={{fontSize:"9px",letterSpacing:"2px",color:"#A51419"}}>{t.role}</div>
                </div>
                <div className="f-bebas flex items-center justify-center text-white text-xl"
                  style={{width:"44px",height:"44px",background:"linear-gradient(135deg,#A51419,#C1121F)"}}>
                  {t.av}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
        <motion.div initial={{opacity:0}} whileInView={{opacity:1}} viewport={{once:true}} transition={{delay:.5}}
          className="mt-16 flex flex-wrap justify-center gap-8 items-center">
          {CLIENTS.map(c=>(
            <span key={c} className="f-mont cursor-default transition-colors"
              style={{fontSize:"11px",letterSpacing:"2px",color:"rgba(255,255,255,.18)",transition:"color .3s"}}
              onMouseEnter={e=>(e.currentTarget.style.color="rgba(193,18,31,.6)")}
              onMouseLeave={e=>(e.currentTarget.style.color="rgba(255,255,255,.18)")}>
              {c}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
