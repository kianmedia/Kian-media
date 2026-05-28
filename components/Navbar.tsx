"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";

const LINKS = [
  {h:"#services", l:"خدماتنا"},
  {h:"#portfolio",l:"أعمالنا"},
  {h:"#about",    l:"من نحن"},
  {h:"#contact",  l:"تواصل معنا", cta:true},
];

export default function Navbar(){
  const [scrolled,setScrolled]=useState(false);
  const [open,setOpen]=useState(false);

  useEffect(()=>{
    const fn=()=>setScrolled(window.scrollY>50);
    window.addEventListener("scroll",fn,{passive:true});
    return ()=>window.removeEventListener("scroll",fn);
  },[]);

  const go=(e:React.MouseEvent,h:string)=>{
    e.preventDefault();setOpen(false);
    document.querySelector(h)?.scrollIntoView({behavior:"smooth"});
  };

  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-400 ${scrolled?"nav-solid":""}`}
      style={{paddingTop:scrolled?"12px":"22px",paddingBottom:scrolled?"12px":"22px"}}>
      <nav className="max-w-7xl mx-auto px-6 lg:px-12 flex items-center justify-between">

        {/* Logo */}
        <a href="#" onClick={e=>go(e,"#")} className="flex items-center gap-3 group">
          <div className="relative w-12 h-12 overflow-hidden" style={{background:"#000",border:"1px solid rgba(227,30,36,.3)"}}>
            <Image src="/logo.png" alt="Kian Media" fill className="object-contain p-[3px]" priority/>
          </div>
          <div className="leading-none">
            <div className="f-bebas text-[20px] tracking-[6px] text-white">KIAN</div>
            <div className="f-mont text-[7px] tracking-[3px] text-white/35 uppercase">Media Production</div>
          </div>
        </a>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-8">
          {LINKS.map(l=>(
            <li key={l.h}>
              <a href={l.h} onClick={e=>go(e,l.h)}
                className={`f-mont text-[11px] tracking-[2px] uppercase font-semibold transition-all duration-250 ${
                  l.cta
                    ?"border text-red-500 hover:bg-red-600 hover:text-white px-5 py-2 transition-all"
                    :"text-white/60 hover:text-white ul-hover"
                }`}
                style={l.cta?{borderColor:"#E31E24"}:{}}>
                {l.l}
              </a>
            </li>
          ))}
        </ul>

        {/* Hamburger */}
        <button className="md:hidden flex flex-col gap-[5px] w-8 z-50" onClick={()=>setOpen(o=>!o)} aria-label="menu">
          {[0,1,2].map(i=>(
            <motion.span key={i} className="block h-[1.5px] bg-white origin-center"
              animate={open
                ?i===0?{rotate:45,y:6.5}:i===1?{opacity:0}:{rotate:-45,y:-6.5}
                :{rotate:0,y:0,opacity:1}}
              style={{width:i===1?(!open?"75%":"100%"):"100%"}}
              transition={{duration:.22}}/>
          ))}
        </button>
      </nav>

      {/* Mobile */}
      <AnimatePresence>
        {open&&(
          <motion.div initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            transition={{duration:.28}}
            className="md:hidden mobile-drop"
            style={{background:"rgba(0,0,0,.98)",borderTop:"1px solid rgba(227,30,36,.2)"}}>
            {LINKS.map(l=>(
              <a key={l.h} href={l.h} onClick={e=>go(e,l.h)}
                className="flex items-center px-6 py-4 f-mont text-sm tracking-widest text-white/60 hover:text-red-500 transition-colors"
                style={{borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                {l.l}
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
