"use client";
import { motion } from "framer-motion";
const STEPS=[
  {n:"01",title:"الاستشارة",desc:"نستمع لرؤيتك ونضع خطة إنتاج تفصيلية تناسب أهدافك وميزانيتك."},
  {n:"02",title:"التصوير",  desc:"فريقنا الاحترافي ينفذ مرحلة التصوير بأحدث المعدات والتقنيات."},
  {n:"03",title:"المونتاج", desc:"نعالج المادة — مونتاج، تصحيح ألوان، موسيقى، ومؤثرات."},
  {n:"04",title:"التسليم",  desc:"نسلّمك المنتج النهائي بالجودة المتفق عليها حتى رضاك التام."},
];
export default function Process(){
  return (
    <section style={{background:"#F2F0ED",color:"#000",paddingTop:"112px",paddingBottom:"112px"}} className="relative overflow-hidden">
      {/* Giant watermark */}
      <div className="f-bebas absolute pointer-events-none select-none"
        style={{top:"-50px",left:"50%",transform:"translateX(-50%)",
          fontSize:"380px",lineHeight:1,color:"rgba(227,30,36,.05)",whiteSpace:"nowrap",letterSpacing:"-10px"}}>
        كيان
      </div>
      <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10">
        <div className="mb-16">
          <motion.div initial={{opacity:0,x:-18}} whileInView={{opacity:1,x:0}} viewport={{once:true}}
            className="sec-label mb-5" style={{color:"#E31E24"}}>
            كيف نعمل
          </motion.div>
          <motion.h2 initial={{opacity:0,y:20}} whileInView={{opacity:1,y:0}} viewport={{once:true}} transition={{delay:.1}}
            className="f-bebas" style={{fontSize:"clamp(40px,5.5vw,70px)",lineHeight:.93,color:"#000"}}>
            من الفكرة إلى<br/><span style={{color:"#E31E24"}}>التسليم النهائي</span>
          </motion.h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px"
          style={{background:"rgba(0,0,0,.1)",border:"1px solid rgba(0,0,0,.1)"}}>
          {STEPS.map((s,i)=>(
            <motion.div key={s.n}
              initial={{opacity:0,y:28}} whileInView={{opacity:1,y:0}} viewport={{once:true}} transition={{delay:i*.09,duration:.65}}
              className="step bg-[#F2F0ED] p-12 group" style={{transition:"background .3s"}}>
              <div className="f-bebas leading-none mb-5"
                style={{fontSize:"84px",color:"rgba(227,30,36,.14)",transition:"color .3s"}}
                onMouseEnter={e=>(e.currentTarget.style.color="rgba(227,30,36,.22)")}
                onMouseLeave={e=>(e.currentTarget.style.color="rgba(227,30,36,.14)")}>
                {s.n}
              </div>
              <h3 style={{fontSize:"17px",fontWeight:700,color:"#000",marginBottom:"10px"}}>{s.title}</h3>
              <p style={{fontSize:"13px",color:"rgba(0,0,0,.48)",lineHeight:1.7}}>{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
