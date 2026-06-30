const PROJECT_ID = 'planning-maintenance-9a3c4';
const API_KEY    = 'AIzaSyB7i6PnqFAdBuGuFM84BKGYWwRT0P8GClc';

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
  const months = [];
  const now = new Date();
  for(let i=-2;i<=4;i++){const d=new Date(now.getFullYear(),now.getMonth()+i,1);const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');months.push(`lv_missions_${y}_${m}`);}
  const allMissions=[];
  await Promise.all(months.map(async key=>{
    try{
      const url=`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/app_data/${key}?key=${API_KEY}`;
      const r=await fetch(url);if(!r.ok)return;
      const data=await r.json();
      if(data.fields?.v?.stringValue){
        const monthData=JSON.parse(data.fields.v.stringValue);
        Object.values(monthData).flat().forEach(m=>{
          if(m.approved===false||m.approved==='rejected')return;
          if(m.status==='cancelled')return;
          if(userId&&m.assignedTo!==userId)return;
          allMissions.push(m);
        });
      }
    }catch{}
  }));
  const seen=new Set();
  const unique=allMissions.filter(m=>{if(seen.has(m.id))return false;seen.add(m.id);return true;});
  unique.sort((a,b)=>a.date.localeCompare(b.date));
  res.setHeader('Content-Type','text/calendar; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.status(200).send(generateICS(unique));
};
