"use client";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { useRef, useState } from "react";

const CATS=["الكل","فعاليات","وثائقي","عقارات","أعراس","شركاتي"];

const ITEMS=[
  {id:1,title:"مهرجان أفلام السعودية ١١",  cat:"فعاليات", yt:"Tp4m2EA1C3o",color:"#1a0505",icon:"🎬",featured:true},
  {id:2,title:"تصوير جوي عقاري سينمائي",   cat:"عقارات",  yt:"eG7K22u6xEU",color:"#050d05",icon:"🚁",featured:false},
  {id:3,title:"مهرجان وندر هيلز",           cat:"فعاليات", yt:"We8sFkpd1b0",color:"#050510",icon:"🎪",featured:false},
  {id:4,title:"وثائقي البيت القطيفي",        cat:"وثائقي",  yt:"vPaH2dnBiFA",color:"#0d0514",icon:"📽️",featured:false},
  {id:5,title:"فيلم زفاف سينمائي",          cat:"أعراس",   yt:"YcsbeqHlm9I",color:"#14100a",icon:"💒",featured:false},
  {id:6,title:"إنتاج شركة العتيشان",        cat:"شركاتي",  yt:"XMjZBgROUIg",color:"#051414",icon:"🏢",featured:false},
  {id:7,title:"اليوم الوطني ٩٥ — الزاهد",  cat:"فعاليات", yt:"CpYYwiEDOJ4",color:"#100505",icon:"🎉",featured:false},
  {id:8,title:"افتتاح مسكوب الجبيل",        cat:"شركاتي",  yt:"naAnvH5DoM0",color:"#050a14",icon:"🏪",featured:false},
];

function PItem({item,idx}:{item:typeof ITEMS[0];idx:number}){
  const [play,setPlay]=useState(false);
  const r=useRef(null);
  const v=useInView(r,{once:true,margin:"-40px"});
  return (
    <motion.div ref={r}
      initial={{opacity:0,y:26}} animate={v?{opacity:1,y:0}:{}}
      transition={{duration:.68,ease:[.16,1,.3,1],delay:idx*.07}}
      className={`port ${item.featured?"md:col-span-2 md:row-span-2":""}`}
      style={{minHeight:item.featured?"420px":"230px"}}>
      {play?(
        <div className="yt absolute inset-0">
          <iframe src={`https://www.youtube.com/embed/${item.yt}?autoplay=1&rel=0`}
            title={item.title} allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"/>
          <button onClick={()=>setPlay(false)}
            className="absolute top-3 right-3 z-10 f-mont text-xs text-white/70 hover:text-white transition-colors"
            style={{background:"rgba(0,0,0,.7)",width:"30px",height:"30px",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      ):(
        <>
          <div className="port-inner absolute inset-0 flex items-center justify-center"
            style={{background:`linear-gradient(135deg,${item.color},#000)`}}>
            <span style={{fontSize:item.featured?"54px":"38px",opacity:.22}}>{item.icon}</span>
          </div>
          <div className="port-ov">
            <span className="f-mont block mb-2" style={{fontSize:"7px",letterSpacing:"4px",color:"#E31E24",textTransform:"uppercase"}}>{item.cat}</span>
            <span className="text-white font-semibold text-sm">{item.title}</span>
          </div>
          <button onClick={()=>setPlay(true)} className="port-play" aria-label={`Play ${item.title}`}>▶</button>
          <div className="f-mont absolute top-3 right-3"
            style={{background:"rgba(163,20,25,.75)",color:"rgba(255,200,200,.85)",fontSize:"7px",letterSpacing:"2px",padding:"3px 8px",textTransform:"uppercase",backdropFilter:"blur(4px)"}}>
            {item.cat}
          </div>
        </>
      )}
    </motion.div>
  );
}

export default function Portfolio(){
  const [tab,setTab]=useState("الكل");
  const r=useRef(null);
  const v=useInView(r,{once:true});
  const filtered=tab==="الكل"?ITEMS:ITEMS.filter(p=>p.cat===tab);

  return (
    <section id="portfolio" style={{background:"#070707",paddingTop:"112px",paddingBottom:"112px"}}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div ref={r} className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
          <div>
            <motion.div initial={{opacity:0,x:-18}} animate={v?{opacity:1,x:0}:{}} className="sec-label mb-5">أعمالنا</motion.div>
            <motion.h2 initial={{opacity:0,y:20}} animate={v?{opacity:1,y:0}:{}} transition={{delay:.1}} className="sec-title">
              جزء من <span className="r">رحلتنا البصرية</span>
            </motion.h2>
          </div>
          <motion.div initial={{opacity:0}} animate={v?{opacity:1}:{}} transition={{delay:.2}} className="flex flex-wrap gap-[2px]">
            {CATS.map(c=>(
              <button key={c} onClick={()=>setTab(c)}
                className="f-mont transition-all duration-250"
                style={{
                  padding:"8px 16px",fontSize:"9px",letterSpacing:"2px",
                  border:`1px solid ${tab===c?"#E31E24":"rgba(227,30,36,.2)"}`,
                  background:tab===c?"#E31E24":"transparent",
                  color:tab===c?"#fff":"rgba(255,255,255,.38)",
                  textTransform:"uppercase",cursor:"pointer",fontWeight:600,
                }}>
                {c}
              </button>
            ))}
          </motion.div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:.3}}
            className="grid grid-cols-1 md:grid-cols-3 gap-[2px]" style={{background:"rgba(227,30,36,.1)"}}>
            {filtered.map((item,i)=><PItem key={item.id} item={item} idx={i}/>)}
          </motion.div>
        </AnimatePresence>

        <div className="text-center mt-14">
          <a href="https://youtube.com/@kianalebtikar" target="_blank" rel="noopener noreferrer" className="btn-red">
            شاهد جميع الأعمال على يوتيوب
          </a>
        </div>
      </div>
    </section>
  );
}
