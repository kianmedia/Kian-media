"use client";
import { motion } from "framer-motion";
const WA="966503422999";
const MSG=encodeURIComponent("السلام عليكم، أريد الاستفسار عن خدمات كيان ميديا للإنتاج الفني");
export default function Contact(){
  return (
    <section id="contact" style={{background:"#000",paddingTop:"112px",paddingBottom:"112px"}} className="relative overflow-hidden">
      {/* Glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div style={{
          position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
          width:"700px",height:"350px",
          background:"rgba(227,30,36,.07)",
          borderRadius:"50%",filter:"blur(120px)",
        }}/>
      </div>
      <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
        <motion.div initial={{opacity:0}} whileInView={{opacity:1}} viewport={{once:true}}
          className="flex items-center justify-center gap-4 mb-7">
          <span style={{width:"28px",height:"1px",background:"rgba(227,30,36,.55)",display:"block"}}/>
          <div className="sec-label">ابدأ مشروعك</div>
          <span style={{width:"28px",height:"1px",background:"rgba(227,30,36,.55)",display:"block"}}/>
        </motion.div>
        <motion.h2 initial={{opacity:0,y:28}} whileInView={{opacity:1,y:0}} viewport={{once:true}} transition={{delay:.1}}
          className="f-bebas text-white mb-6"
          style={{fontSize:"clamp(52px,8vw,120px)",lineHeight:.93}}>
          قصتك تستحق<br/>أن تُروى <span className="grad-r">باحتراف</span>
        </motion.h2>
        <motion.p initial={{opacity:0}} whileInView={{opacity:1}} viewport={{once:true}} transition={{delay:.2}}
          className="text-white/35 mb-14 max-w-lg mx-auto" style={{fontSize:"15px"}}>
          نحن مستعدون لتحويل رؤيتك إلى محتوى بصري استثنائي
        </motion.p>
        <motion.div initial={{opacity:0,y:16}} whileInView={{opacity:1,y:0}} viewport={{once:true}} transition={{delay:.3}}
          className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-14">
          <a href={`https://wa.me/${WA}?text=${MSG}`} target="_blank" rel="noopener noreferrer" className="btn-wa w-full sm:w-auto justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            واتساب — راسلنا الآن
          </a>
          <a href="mailto:info@kianmedia.com" className="btn-ghost w-full sm:w-auto text-center">
            ✉ info@kianmedia.com
          </a>
        </motion.div>
        <div style={{width:"1px",height:"32px",background:"rgba(227,30,36,.2)",margin:"0 auto 24px"}}/>
        <motion.div initial={{opacity:0}} whileInView={{opacity:1}} viewport={{once:true}} transition={{delay:.45}}
          className="flex flex-col sm:flex-row gap-6 justify-center items-center text-white/35">
          {["966503422999","966543553038"].map(n=>(
            <a key={n} href={`tel:+${n}`}
              className="f-mont flex items-center gap-2 transition-colors"
              style={{fontSize:"13px",letterSpacing:"2px",textDecoration:"none",color:"rgba(255,255,255,.35)"}}
              onMouseEnter={e=>(e.currentTarget.style.color="#E31E24")}
              onMouseLeave={e=>(e.currentTarget.style.color="rgba(255,255,255,.35)")}>
              <span style={{color:"#A51419"}}>📞</span> +{n}
            </a>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
