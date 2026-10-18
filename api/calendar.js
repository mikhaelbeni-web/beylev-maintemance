// Flux ICS par utilisateur : /api/calendar?user=u3&k=<jeton signe>. Le lien complet est affiche dans Reglages.
// Les applications calendrier ne peuvent pas envoyer de jeton Firebase, d'ou la signature dans l'URL.
const fb = require('./_lib/firebase');

function escICS(s){return(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
function d2ICS(d){return d.replace(/-/g,'');}
function nextDay(d){const dt=new Date(d+'T12:00:00');dt.setDate(dt.getDate()+1);return dt.toISOString().slice(0,10).replace(/-/g,'');}

function generateICS(missions){
  const now=new Date().toISOString().replace(/[:\-]/g,'').slice(0,15)+'Z';
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Beylev//FR','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Maintenance Beylev'];
  missions.forEach(m=>{
    const event=['BEGIN:VEVENT','UID:'+m.id+'@beylev','DTSTAMP:'+now,'DTSTART;VALUE=DATE:'+d2ICS(m.date),'DTEND;VALUE=DATE:'+nextDay(m.dateEnd||m.date),'SUMMARY:'+escICS(m.title+(m.priority==='urgent'?' - URGENT':'')+(m.location?' - '+m.location:'')),(m.location?'LOCATION:'+escICS(m.location):null),'DESCRIPTION:'+escICS([m.description,'Statut: '+(m.status||'')].filter(Boolean).join(' | ')),'STATUS:'+(m.status==='done'?'COMPLETED':m.status==='cancelled'?'CANCELLED':'CONFIRMED'),'END:VEVENT'];
    event.forEach(l=>{if(l)lines.push(l);});
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = async (req, res) => {
  const userId = req.query.user || null;
  try {
    if (!fb.calendarTokenOk(userId, req.query.k)) return res.status(401).send('Lien calendrier invalide : recopiez-le depuis Reglages');
  } catch (e) { return res.status(500).send(e.message); }
  const months = [];
  const now = new Date();
  for(let i=-2;i<=4;i++){const d=new Date(now.getFullYear(),now.getMonth()+i,1);const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');months.push(`lv_missions_${y}_${m}`);}
  const allMissions=[];
  await Promise.all(months.map(async key=>{
    try{
      const monthData=await fb.getDoc(key);
      if(!monthData||typeof monthData!=='object')return;
      Object.values(monthData).flat().forEach(m=>{
        if(!m||!m.date)return;
        if(m.approved===false||m.approved==='rejected')return;
        if(m.status==='cancelled'||m.deletedAt)return;
        if(m.assignedTo!==userId)return;
        allMissions.push(m);
      });
    }catch(e){console.error('calendar',key,e.message);}
  }));
  const seen=new Set();
  const unique=allMissions.filter(m=>{if(seen.has(m.id))return false;seen.add(m.id);return true;});
  unique.sort((a,b)=>a.date.localeCompare(b.date));
  res.setHeader('Content-Type','text/calendar; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.status(200).send(generateICS(unique));
};
