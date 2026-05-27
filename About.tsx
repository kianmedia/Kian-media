"use client";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import Image from "next/image";

const TAGS=["إنتاج سينمائي","Drone 4K","بث مباشر","مونتاج","وثائقي","أعراس","شركاتي"];
const STATS=[{n:"٥+",l:"سنوات"},{n:"١٥٠+",l:"مشروع"},{n:"٥٠+",l:"عميل"},{n:"١٣",l:"منطقة"}];

export default function About(){
  const r=useRef(null);
  const v=useInView(r,{once:true,margin:"-70px"});
  return (
    <section id="about" style={{background:"#000",paddingTop:"112px",paddingBottom:"112px"}} className="overflow-hidden">
      <div ref={r} className="max-w-7xl mx-auto px-6 lg:px-12 grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-28 items-center">

        {/* Text */}
        <div>
          <motion.div initial={{opacity:0,x:-18}} animate={v?{opacity:1,x:0}:{}} className="sec-label mb-6">من نحن</motion.div>
          <motion.h2 initial={{opacity:0,y:28}} animate={v?{opacity:1,y:0}:{}} transition={{delay:.1}} className="sec-title mb-8">
            نؤمن أن كل قصة<br/>تستحق <span className="r">عدسة استثنائية</span>
          </motion.h2>
          <motion.p initial={{opacity:0}} animate={v?{opacity:1}:{}} transition={{delay:.2}} className="text-white/50 leading-loose mb-5">
            كيان الابتكار للإنتاج الفني — شركة سعودية متخصصة تُعيد تعريف المحتوى البصري
            من خلال الجمع بين الرؤية الإبداعية وأحدث تقنيات التصوير.
          </motion.p>
          <motion.p initial={{opacity:0}} animate={v?{opacity:1}:{}} transition={{delay:.25}} className="text-white/50 leading-loose mb-8">
            من مهرجانات الأفلام إلى الوثائقيات التاريخية وتغطيات الأعراس —
            نحمل الكاميرا بشغف ونُخرج الإبداع من كل لحظة.
          </motion.p>

          {/* Tags */}
          <motion.div initial={{opacity:0}} animate={v?{opacity:1}:{}} transition={{delay:.3}} className="flex flex-wrap gap-2 mb-10">
            {TAGS.map(t=>(
              <span key={t} className="f-mont text-white/42 hover:text-white cursor-default transition-all"
                style={{border:"1px solid rgba(227,30,36,.28)",fontSize:"9px",letterSpacing:"2px",
                  padding:"5px 12px",textTransform:"uppercase",transition:"border-color .3s,color .3s"}}
                onMouseEnter={e=>{(e.currentTarget as HTMLSpanElement).style.borderColor="#E31E24";(e.currentTarget as HTMLSpanElement).style.color="#fff"}}
                onMouseLeave={e=>{(e.currentTarget as HTMLSpanElement).style.borderColor="rgba(227,30,36,.28)";(e.currentTarget as HTMLSpanElement).style.color="rgba(255,255,255,.42)"}}>
                {t}
              </span>
            ))}
          </motion.div>

          {/* Stats */}
          <motion.div initial={{opacity:0,y:16}} animate={v?{opacity:1,y:0}:{}} transition={{delay:.38}}
            className="grid grid-cols-4 gap-px"
            style={{background:"rgba(227,30,36,.18)",border:"1px solid rgba(227,30,36,.18)"}}>
            {STATS.map(s=>(
              <div key={s.l} className="text-center py-5 group"
                style={{background:"#000",transition:"background .3s"}}
                onMouseEnter={e=>(e.currentTarget.style.background="rgba(227,30,36,.08)")}
                onMouseLeave={e=>(e.currentTarget.style.background="#000")}>
                <div className="f-bebas text-[30px] text-white leading-none" style={{transition:"color .3s"}}
                  onMouseEnter={e=>(e.currentTarget.style.color="#E31E24")}
                  onMouseLeave={e=>(e.currentTarget.style.color="#fff")}>{s.n}</div>
                <div className="f-mont text-white/30 mt-2" style={{fontSize:"8px",letterSpacing:"2px"}}>{s.l}</div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Visual — logo framed */}
        <motion.div initial={{opacity:0,x:36}} animate={v?{opacity:1,x:0}:{}} transition={{delay:.22,duration:.85}}
          className="relative hidden lg:block">

          {/* Red accent badge */}
          <div className="absolute z-20" style={{top:"-18px",right:"-18px",background:"#E31E24",padding:"16px 20px"}}>
            <p className="f-bebas text-white leading-tight" style={{fontSize:"12px",letterSpacing:"5px"}}>KIAN<br/>MEDIA</p>
          </div>

          {/* Main frame */}
          <div className="relative" style={{
            aspectRatio:"4/5",
            background:"#0a0a0a",
            border:"1px solid rgba(227,30,36,.2)",
            overflow:"hidden",
          }}>
            {/* Inner frame */}
            <div className="absolute pointer-events-none z-10" style={{inset:"18px",border:"1px solid rgba(227,30,36,.08)"}}/>

            {/* Logo center */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
              <div className="relative" style={{
                width:"200px",height:"200px",
                filter:"drop-shadow(0 0 80px rgba(227,30,36,.55)) drop-shadow(0 0 30px rgba(227,30,36,.3))",
              }}>
                <Image src="/logo.png" alt="Kian Media" fill className="object-contain"/>
              </div>
              <span className="f-mont text-white/35 uppercase" style={{fontSize:"8px",letterSpacing:"8px"}}>
                THROUGH THE LENS
              </span>
            </div>

            {/* Giant K watermark */}
            <div className="absolute f-bebas pointer-events-none select-none"
              style={{bottom:"6px",left:"12px",fontSize:"180px",lineHeight:1,color:"rgba(227,30,36,.04)"}}>
              K
            </div>
          </div>

          {/* Floating stat card */}
          <div className="absolute glass" style={{bottom:"-16px",left:"-16px",padding:"14px 20px"}}>
            <div className="f-bebas text-[22px] leading-none" style={{color:"#E31E24"}}>١٥٠+</div>
            <div className="f-mont text-white/30 mt-1" style={{fontSize:"8px",letterSpacing:"2px"}}>مشروع منجز</div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
