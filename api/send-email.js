const RESEND_API_KEY = "re_JZgydhox_8XtWDrfwRFAQDcjWwxAXXz5g";
const FROM_EMAIL     = "gestion@beylev.com";

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});

  try{
    const p = typeof req.body==='string' ? JSON.parse(req.body) : req.body;
    const html=`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#1e1b4b;color:white;padding:20px;border-radius:12px 12px 0 0"><h2 style="margin:0">${p.subject}</h2></div><div style="background:#f8fafc;padding:20px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0"><p>Bonjour <strong>${p.to_name}</strong>,</p><p>${p.message}</p><div style="background:white;border-left:4px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0"><p style="margin:4px 0"><strong>Intervention :</strong> ${p.mission_title}</p><p style="margin:4px 0"><strong>Date :</strong> ${p.mission_date}</p><p style="margin:4px 0"><strong>Lieu :</strong> ${p.mission_location}</p><p style="margin:4px 0"><strong>Assigne a :</strong> ${p.assigned_to}</p><p style="margin:4px 0"><strong>Cree par :</strong> ${p.created_by}</p><p style="margin:4px 0"><strong>Priorite :</strong> ${p.mission_priority}</p>${p.mission_description&&p.mission_description!=="—"?`<p style="margin:4px 0"><strong>Description :</strong> ${p.mission_description}</p>`:""}</div><a href="${p.app_url}" style="display:inline-block;background:#6366f1;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Voir l'application</a><p style="color:#94a3b8;font-size:12px;margin-top:20px">Maintenance Beylev</p></div></div>`;

    const r=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:FROM_EMAIL,to:[p.to_email],subject:p.subject,html}),
    });
    const data=await r.json();
    res.status(r.ok?200:400).json(data);
  }catch(e){
    res.status(500).json({error:e.message});
  }
};
