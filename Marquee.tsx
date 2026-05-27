const ITEMS=[
  "إنتاج سينمائي","Cinematic Production",
  "تصوير جوي ٤K","Drone Filming 4K",
  "بث مباشر","Live Streaming",
  "مونتاج احترافي","Pro Editing",
  "تغطية فعاليات","Event Coverage",
  "أفلام وثائقية","Documentary",
  "تصوير أعراس","Wedding Films",
  "محتوى شركاتي","Corporate Video",
];
export default function Marquee(){
  return (
    <div style={{background:"#E31E24",borderTop:"1px solid #A51419",borderBottom:"1px solid #A51419",overflow:"hidden"}}>
      <div className="mq-track" style={{padding:"11px 0"}}>
        {[...ITEMS,...ITEMS].map((it,i)=>(
          <span key={i} className="f-mont inline-block whitespace-nowrap px-7 text-white/88"
            style={{fontSize:"10px",letterSpacing:"4px",textTransform:"uppercase",fontWeight:600}}>
            {it}<span style={{margin:"0 16px",color:"rgba(255,255,255,.3)"}}>◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}
