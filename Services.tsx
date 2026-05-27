"use client";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const SVCS=[
  {n:"01",icon:"🎬",ar:"الإنتاج السينمائي",   en:"Cinematic Production",
   desc:"إنتاج وتصوير وإخراج بمستوى سينمائي احترافي يعكس هوية علامتك التجارية."},
  {n:"02",icon:"🚁",ar:"التصوير الجوي",        en:"Drone Filming 4K",
   desc:"لقطات جوية 4K بمنظور استثنائي لمشاريعك ومواقعك."},
  {n:"03",icon:"📡",ar:"البث المباشر",         en:"Live Streaming",
   desc:"بث مباشر احترافي لفعالياتك بإدارة كاملة للمنصات."},
  {n:"04",icon:"🏢",ar:"الإنتاجات الشركاتية", en:"Corporate Productions",
   desc:"أفلام تعريفية وإعلانات احترافية لشركتك."},
  {n:"05",icon:"💒",ar:"تصوير الأعراس",        en:"Wedding Films",
   desc:"توثيق سينمائي احترافي لأجمل لحظات حياتك."},
  {n:"06",icon:"📽️",ar:"الأفلام الوثائقية",   en:"Documentary Films",
   desc:"أفلام وثائقية تاريخية وثقافية بأسلوب سردي رصين."},
];

function Card({s,i}:{s:typeof SVCS[0];i:number}){
  const r=useRef(null);
  const v=useInView(r,{once:true,margin:"-50px"});
  return (
    <motion.div ref={r}
      initial={{opacity:0,y:36}} animate={v?{opacity:1,y:0}:{}}
      transition={{duration:.72,ease:[.16,1,.3,1],delay:(i%3)*.1}}
      className="svc p-11 cursor-default">
      <div className="f-bebas leading-none mb-5"
        style={{fontSize:"72px",color:"rgba(227,30,36,.1)",letterSpacing:"-2px",transition:"color .35s"}}
        onMouseEnter={e=>(e.currentTarget.style.color="rgba(227,30,36,.2)")}
        onMouseLeave={e=>(e.currentTarget.style.color="rgba(227,30,36,.1)")}>
        {s.n}
      </div>
      <span className="text-3xl mb-4 block">{s.icon}</span>
      <h3 className="text-white text-[19px] font-semibold mb-1">{s.ar}</h3>
      <span className="f-mont block mb-4" style={{fontSize:"8px",letterSpacing:"4px",color:"rgba(163,20,25,.7)",textTransform:"uppercase"}}>
        {s.en}
      </span>
      <p className="text-white/38 text-sm leading-relaxed">{s.desc}</p>
    </motion.div>
  );
}

export default function Services(){
  const r=useRef(null);
  const v=useInView(r,{once:true});
  return (
    <section id="services" style={{background:"#000",paddingTop:"112px",paddingBottom:"112px"}} className="relative overflow-hidden">
      {/* BG word */}
      <div className="f-bebas absolute top-8 right-[-60px] pointer-events-none select-none"
        style={{fontSize:"200px",lineHeight:1,color:"rgba(227,30,36,.03)",letterSpacing:"-6px"}}>
        SERVICES
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div ref={r} className="mb-16">
          <motion.div initial={{opacity:0,x:-18}} animate={v?{opacity:1,x:0}:{}} className="sec-label mb-5">خدماتنا</motion.div>
          <motion.h2 initial={{opacity:0,y:24}} animate={v?{opacity:1,y:0}:{}} transition={{delay:.1}} className="sec-title">
            كل ما تحتاجه من<br/><span className="r">إنتاج فني</span> في مكان واحد
          </motion.h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px" style={{background:"rgba(227,30,36,.12)"}}>
          {SVCS.map((s,i)=><Card key={s.n} s={s} i={i}/>)}
        </div>
      </div>
    </section>
  );
}
