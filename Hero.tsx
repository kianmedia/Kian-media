"use client";
import { motion, useScroll, useTransform } from "framer-motion";
import Image from "next/image";
import { useState, useRef } from "react";

const HOLES=Array.from({length:22});
const f=(d=0)=>({hidden:{opacity:0,y:50},show:{opacity:1,y:0,transition:{duration:.95,ease:[.16,1,.3,1],delay:d}}});
const STATS=[{n:"٥+",l:"سنوات"},{n:"١٥٠+",l:"مشروع"},{n:"٥٠+",l:"عميل"},{n:"١٣",l:"منطقة"}];

export default function Hero(){
  const [reel,setReel]=useState(false);
  const ref=useRef<HTMLElement>(null);
  const {scrollYProgress}=useScroll({target:ref,offset:["start start","end start"]});
  const bgY=useTransform(scrollYProgress,[0,1],["0%","25%"]);
  const fade=useTransform(scrollYProgress,[0,.55],[1,0]);
  const go=(h:string)=>document.querySelector(h)?.scrollIntoView({behavior:"smooth"});

  return (
    <section ref={ref} className="relative min-h-screen flex items-center justify-center overflow-hidden" style={{background:"#000"}}>

      {/* Parallax bg */}
      <motion.div style={{y:bgY}} className="absolute inset-0 pointer-events-none">
        {/* Red diagonal accent — matches logo angle */}
        <div className="absolute inset-0" style={{
          background:"linear-gradient(160deg, #000 0%, #0d0505 45%, #000 100%)"
        }}/>
        {/* Subtle red glow top-left, matching logo K side */}
        <div className="absolute top-0 left-0 w-[60vw] h-[60vh]"
          style={{background:"radial-gradient(ellipse at 20% 20%, rgba(227,30,36,.13) 0%, transparent 65%)"}}/>
        {/* Right glow - M side */}
        <div className="absolute bottom-0 right-0 w-[50vw] h-[50vh]"
          style={{background:"radial-gradient(ellipse at 80% 80%, rgba(227,30,36,.07) 0%, transparent 65%)"}}/>
        {/* Diagonal slash like logo geometry */}
        <div className="absolute top-0 right-0 w-[45vw] h-full pointer-events-none"
          style={{background:"linear-gradient(135deg,transparent 60%,rgba(227,30,36,.04) 100%)"}}/>
      </motion.div>

      {/* Film strips */}
      {[false,true].map(right=>(
        <div key={String(right)}
          className={`absolute top-0 bottom-0 w-6 overflow-hidden pointer-events-none ${right?"right-5":"left-5"}`}
          style={{opacity:.1}}>
          <div className={right?"anim-fu":"anim-fd"} style={{display:"flex",flexDirection:"column"}}>
            {[...HOLES,...HOLES].map((_,i)=>(
              <div key={i} style={{width:"16px",height:"12px",margin:"3px auto",border:"1px solid rgba(255,255,255,.5)",flexShrink:0}}/>
            ))}
          </div>
        </div>
      ))}

      {/* Content */}
      <motion.div style={{opacity:fade}} className="relative z-10 text-center px-6 max-w-5xl mx-auto">

        {/* Eyebrow */}
        <motion.div variants={f(.05)} initial="hidden" animate="show" className="flex items-center justify-center gap-4 mb-9">
          <span style={{width:"36px",height:"1px",background:"rgba(227,30,36,.55)",display:"block"}}/>
          <span className="sec-label">كيان الابتكار للإنتاج الفني</span>
          <span style={{width:"36px",height:"1px",background:"rgba(227,30,36,.55)",display:"block"}}/>
        </motion.div>

        {/* Logo — large, centered, glowing */}
        <motion.div variants={f(.15)} initial="hidden" animate="show" className="flex justify-center mb-9">
          <div className="relative" style={{
            width:"clamp(110px,14vw,155px)",
            height:"clamp(110px,14vw,155px)",
            filter:"drop-shadow(0 0 60px rgba(227,30,36,.55)) drop-shadow(0 0 120px rgba(227,30,36,.22))",
          }}>
            <Image src="/logo.png" alt="Kian Media" fill className="object-contain" priority/>
          </div>
        </motion.div>

        {/* Headline */}
        <motion.h1 variants={f(.25)} initial="hidden" animate="show"
          className="f-bebas text-white leading-none tracking-tight mb-3"
          style={{fontSize:"clamp(72px,12vw,160px)",letterSpacing:"-3px"}}>
          KIAN{" "}<span className="grad-r">MEDIA</span>
        </motion.h1>

        <motion.div variants={f(.34)} initial="hidden" animate="show"
          className="f-mont text-white/22 uppercase mb-8"
          style={{fontSize:"clamp(10px,1.8vw,17px)",letterSpacing:"10px",fontWeight:300}}>
          ART PRODUCTION — SAUDI ARABIA
        </motion.div>

        <motion.p variants={f(.43)} initial="hidden" animate="show"
          className="text-white/52 text-base md:text-lg leading-loose max-w-xl mx-auto mb-12">
          نصنع محتوى بصريًا يروي قصتك
          <br/>
          <span className="f-mont text-white/28" style={{fontSize:"12px",letterSpacing:"2px"}}>
            Cinematic · Drone · Live Streaming · Corporate · Weddings
          </span>
        </motion.p>

        {/* Buttons */}
        <motion.div variants={f(.55)} initial="hidden" animate="show"
          className="flex flex-wrap gap-3 justify-center mb-14">
          <button onClick={()=>setReel(true)} className="btn-red flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 1l9 5-9 5z"/>
            </svg>
            مشاهدة الشورييل
          </button>
          <button onClick={()=>go("#portfolio")} className="btn-ghost">أعمالنا</button>
          <button onClick={()=>go("#contact")} className="btn-ghost" style={{borderColor:"rgba(227,30,36,.35)",color:"rgba(227,30,36,.75)"}}>تواصل</button>
        </motion.div>

        {/* YouTube reel */}
        {reel&&(
          <motion.div initial={{opacity:0,scale:.93}} animate={{opacity:1,scale:1}}
            className="relative max-w-3xl mx-auto mb-12">
            <button onClick={()=>setReel(false)}
              className="absolute -top-8 left-0 f-mont text-xs tracking-widest text-white/45 hover:text-white transition-colors">
              ✕ إغلاق
            </button>
            <div className="yt" style={{
              border:"1px solid rgba(227,30,36,.3)",
              boxShadow:"0 28px 80px rgba(227,30,36,.18)",
            }}>
              <iframe
                src="https://www.youtube.com/embed/xvzneIB-OFs?autoplay=1&rel=0&controls=1"
                title="Kian Media Showreel" allowFullScreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"/>
            </div>
          </motion.div>
        )}

        {/* Stats strip */}
        <motion.div variants={f(.68)} initial="hidden" animate="show"
          className="grid grid-cols-4 gap-px max-w-md mx-auto"
          style={{background:"rgba(227,30,36,.2)",border:"1px solid rgba(227,30,36,.2)"}}>
          {STATS.map(s=>(
            <div key={s.l} className="text-center py-4 group"
              style={{background:"rgba(0,0,0,.88)",transition:"background .3s"}}
              onMouseEnter={e=>(e.currentTarget.style.background="rgba(227,30,36,.08)")}
              onMouseLeave={e=>(e.currentTarget.style.background="rgba(0,0,0,.88)")}>
              <div className="f-bebas text-[26px] text-white group-hover:text-red-500 transition-colors leading-none">{s.n}</div>
              <div className="f-mont text-[8px] text-white/30 mt-1 tracking-wider">{s.l}</div>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* Scroll hint */}
      <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:1.7}}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10 pointer-events-none">
        <span className="f-mont text-white/18 uppercase" style={{fontSize:"7px",letterSpacing:"4px"}}>scroll</span>
        <div style={{width:"1px",height:"44px",background:"linear-gradient(to bottom,rgba(227,30,36,.6),transparent)"}} className="animate-pulse"/>
      </motion.div>
    </section>
  );
}
