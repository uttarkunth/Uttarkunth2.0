const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const json=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)}), enc=v=>encodeURIComponent(String(v));
exports.handler=async event=>{
 if(event.httpMethod==="OPTIONS")return{statusCode:204,headers,body:""};
 if(!["GET","POST"].includes(event.httpMethod))return json(405,{ok:false,error:"Method not allowed."});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return json(503,{ok:false,error:"Portal service is not configured."});
 const token=(event.headers.authorization||event.headers.Authorization||"").replace(/^Bearer\s+/i,"");
 if(!token)return json(401,{ok:false,error:"Please sign in."});
 const root=url.replace(/\/+$/,""), rest=root+"/rest/v1/";
 async function db(path,opts={}){const r=await fetch(rest+path,{...opts,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Accept:"application/json",...(opts.headers||{})}});const t=await r.text();let d;try{d=t?JSON.parse(t):null;}catch{d=t;}if(!r.ok){const e=new Error("Database request failed "+r.status);e.status=r.status;throw e;}return d;}
 async function rpc(name,body){const r=await fetch(rest+"rpc/"+name,{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(body)});const t=await r.text();let d;try{d=t?JSON.parse(t):null;}catch{d=t;}if(!r.ok){const e=new Error("Operation failed");e.status=r.status;throw e;}return d;}
 try{
  const auth=await fetch(root+"/auth/v1/user",{headers:{apikey:key,Authorization:"Bearer "+token}});
  if(!auth.ok)return json(401,{ok:false,error:"Your session has expired. Please sign in again."});
  const user=await auth.json();if(!user.id||!user.email_confirmed_at)return json(403,{ok:false,error:"Please verify your email before using the portal."});
  const email=String(user.email||"").toLowerCase(),isAdmin=email==="uttarkunth@gmail.com";
  const scope=(event.queryStringParameters||{}).scope||"host";
  if(event.httpMethod==="GET"){
   const owned=await db("properties?select=id,slug,name,description,address,village,district,state,amenities,photos,booking_mode,property_type,published,moderation_status,moderation_notes,host_id&id=not.is.null&order=created_at.desc");
   const propertyHosts=await db("property_hosts?select=property_id&user_id=eq."+enc(user.id));
   const ids=new Set([...owned.filter(p=>p.host_id===user.id).map(p=>p.id),...propertyHosts.map(x=>x.property_id)]);
   const properties=isAdmin?owned:owned.filter(p=>ids.has(p.id));
   const propertyIds=properties.map(p=>p.id);
   let requests=[],rooms=[],blocks=[],agreements=[];
   if(propertyIds.length){
    const inIds="("+propertyIds.map(enc).join(",")+")";
    [requests,rooms,agreements]=await Promise.all([
     db("booking_requests?select=*&property_id=in."+inIds+"&order=created_at.desc"),
     db("room_units?select=*&property_id=in."+inIds+"&order=base_price.asc"),
     db("host_agreements?select=id,property_id,host_name,host_contact,agreement_start,agreement_end,commission_percent,agreement_status,accepted_at,intro_commission_percent,intro_period_months,standard_commission_percent&property_id=in."+inIds)
    ]);
    const roomIds=rooms.map(r=>r.id);
    if(roomIds.length)blocks=await db("room_availability_blocks?select=*&room_unit_id=in.("+roomIds.map(enc).join(",")+")&order=blocked_from.asc");
   }
   if(isAdmin){
    const allRequests=await db("booking_requests?select=*&order=created_at.desc");
    requests=allRequests;
   }
   return json(200,{ok:true,user:{id:user.id,email:user.email,full_name:user.user_metadata&&user.user_metadata.full_name||""},is_admin:isAdmin,properties,rooms,requests,blocks,agreements,stats:{properties:properties.length,pending:requests.filter(x=>x.status==="pending").length,approved:properties.filter(x=>x.moderation_status==="approved"&&x.published).length}});
  }
  let b;try{b=JSON.parse(event.body||"{}");}catch{return json(400,{ok:false,error:"Invalid request."});}
  const action=b.action;
  if(action==="save_property"){
   const name=String(b.name||"").trim(),slug=name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,90);
   if(!name||!b.village||!b.district||!b.state||!b.description)return json(400,{ok:false,error:"Complete the required property details."});
   const photos=Array.isArray(b.photos)?b.photos.filter(x=>/^https?:\/\//i.test(String(x))).slice(0,20):[];
   const amenities=Array.isArray(b.amenities)?b.amenities.slice(0,40):[];
   const record={slug,name,property_type:b.property_type||"homestay",village:String(b.village).slice(0,120),district:String(b.district).slice(0,120),state:String(b.state).slice(0,80),address:String(b.address||"").slice(0,300)||null,description:String(b.description).slice(0,3000),photos,amenities,booking_mode:"request",host_id:user.id,published:false,moderation_status:"pending",moderation_notes:null,reviewed_at:null,reviewed_by:null,updated_at:new Date().toISOString()};
   if(b.property_id){
    const existing=await db("properties?select=id,host_id&id=eq."+enc(b.property_id)+"&limit=1");
    if(!existing[0]||(!isAdmin&&existing[0].host_id!==user.id))return json(403,{ok:false,error:"You cannot edit this property."});
    const updated=await db("properties?id=eq."+enc(b.property_id),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(record)});
    return json(200,{ok:true,property:updated[0]||null,message:"Changes saved and sent for review."});
   }
   record.slug=slug+"-"+crypto.randomUUID().slice(0,6);
   const created=await db("properties",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(record)});
   return json(201,{ok:true,property:created[0]||null,message:"Property submitted for admin review."});
  }
  if(action==="save_room"){
   const prop=await db("properties?select=id,host_id&id=eq."+enc(b.property_id)+"&limit=1");
   const ph=await db("property_hosts?select=id&property_id=eq."+enc(b.property_id)+"&user_id=eq."+enc(user.id)+"&limit=1");
   if(!prop[0]||(!isAdmin&&prop[0].host_id!==user.id&&!ph.length))return json(403,{ok:false,error:"You do not manage this property."});
   const rate=Number(b.base_price),capacity=Number(b.max_guests);
   if(!String(b.room_name||"").trim()||!Number.isFinite(rate)||rate<0||!Number.isInteger(capacity)||capacity<1||capacity>30)return json(400,{ok:false,error:"Enter a valid room name, rate and guest capacity."});
   const record={property_id:b.property_id,room_name:String(b.room_name).trim().slice(0,120),description:String(b.description||"").slice(0,1000)||null,base_price:rate,max_guests:capacity,active:true};
   const created=await db("room_units",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(record)});
   return json(201,{ok:true,room:created[0]||null});
  }
  if(action==="accept_agreement"){
   if(!b.property_id||b.accepted!==true)return json(400,{ok:false,error:"Explicit agreement acceptance is required."});
   const prop=await db("properties?select=id,host_id,name&id=eq."+enc(b.property_id)+"&limit=1");
   const ph=await db("property_hosts?select=id&property_id=eq."+enc(b.property_id)+"&user_id=eq."+enc(user.id)+"&limit=1");
   if(!prop[0]||(!isAdmin&&prop[0].host_id!==user.id&&!ph.length))return json(403,{ok:false,error:"You do not manage this property."});
   const existing=await db("host_agreements?select=id&property_id=eq."+enc(b.property_id)+"&limit=1");
   const record={property_id:b.property_id,host_name:String(user.user_metadata&&user.user_metadata.full_name||user.email).slice(0,120),host_contact:user.email,host_user_id:user.id,agreement_start:new Date().toISOString().slice(0,10),agreement_end:null,commission_percent:0,intro_commission_percent:0,intro_period_months:12,standard_commission_percent:10,agreement_status:"active",accepted_at:new Date().toISOString(),terms_version:"uttarkunth-stays-2026-10-v1",notes:"0% introductory commission for 12 months, then 10% standard commission."};
   if(existing[0])await db("host_agreements?id=eq."+enc(existing[0].id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(record)});
   else await db("host_agreements",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(record)});
   return json(200,{ok:true,message:"Agreement acceptance recorded."});
  }
  if(action==="respond_booking"){
   const reqs=await db("booking_requests?select=id,property_id&id=eq."+enc(b.booking_request_id));
   const req=reqs[0];if(!req)return json(404,{ok:false,error:"Booking request not found."});
   if(!isAdmin){
    const [p,ph]=await Promise.all([db("properties?select=id,host_id&id=eq."+enc(req.property_id)+"&limit=1"),db("property_hosts?select=id&property_id=eq."+enc(req.property_id)+"&user_id=eq."+enc(user.id)+"&limit=1")]);
    if(!(p[0]&&p[0].host_id===user.id)&&!ph.length)return json(403,{ok:false,error:"You do not manage this property."});
   }
   if(!["confirm","decline","cancel"].includes(b.decision))return json(400,{ok:false,error:"Invalid decision."});
   const result=await rpc("respond_to_booking_request",{p_booking_request_id:b.booking_request_id,p_action:b.decision,p_host_notes:String(b.host_notes||"").slice(0,1000)||null,p_actor_user_id:user.id});
   return json(200,{ok:true,result});
  }
  if(action==="save_availability_block"){
   if(!b.room_unit_id||!b.blocked_from||!b.blocked_until||b.blocked_until<=b.blocked_from)return json(400,{ok:false,error:"Choose valid block dates."});
   const room=await db("room_units?select=id,property_id&id=eq."+enc(b.room_unit_id)+"&limit=1");
   if(!room[0])return json(404,{ok:false,error:"Room not found."});
   const [p,ph]=await Promise.all([db("properties?select=id,host_id&id=eq."+enc(room[0].property_id)+"&limit=1"),db("property_hosts?select=id&property_id=eq."+enc(room[0].property_id)+"&user_id=eq."+enc(user.id)+"&limit=1")]);
   if(!isAdmin&&!(p[0]&&p[0].host_id===user.id)&&!ph.length)return json(403,{ok:false,error:"You do not manage this property."});
   const result=await db("room_availability_blocks",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({room_unit_id:b.room_unit_id,blocked_from:b.blocked_from,blocked_until:b.blocked_until,reason:String(b.reason||"Host block").slice(0,300),created_by:user.id})});
   return json(201,{ok:true,block:result[0]});
  }
  if(action==="delete_availability_block"){
   const rows=await db("room_availability_blocks?select=id,room_unit_id&id=eq."+enc(b.block_id)+"&limit=1");
   if(!rows.length)return json(404,{ok:false,error:"Availability block not found."});
   const room=await db("room_units?select=id,property_id&id=eq."+enc(rows[0].room_unit_id)+"&limit=1");
   const [p,ph]=await Promise.all([db("properties?select=id,host_id&id=eq."+enc(room[0].property_id)+"&limit=1"),db("property_hosts?select=id&property_id=eq."+enc(room[0].property_id)+"&user_id=eq."+enc(user.id)+"&limit=1")]);
   if(!isAdmin&&!(p[0]&&p[0].host_id===user.id)&&!ph.length)return json(403,{ok:false,error:"You do not manage this property."});
   await db("room_availability_blocks?id=eq."+enc(b.block_id),{method:"DELETE"});return json(200,{ok:true});
  }
  if(action==="moderate_property"){
   if(!isAdmin)return json(403,{ok:false,error:"Administrator access required."});
   const allowed=["approved","rejected","changes_requested","suspended","pending"];
   if(!allowed.includes(b.status)||!b.property_id)return json(400,{ok:false,error:"Invalid moderation request."});
   const patch={moderation_status:b.status,published:b.status==="approved",moderation_notes:String(b.notes||"").slice(0,1000)||null,reviewed_at:new Date().toISOString(),reviewed_by:user.id,updated_at:new Date().toISOString()};
   const result=await db("properties?id=eq."+enc(b.property_id),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});
   await db("admin_audit_log",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({actor_user_id:user.id,action:"property_moderated",target_type:"property",target_id:b.property_id,details:{status:b.status,notes:patch.moderation_notes}})});
   return json(200,{ok:true,property:result[0]||null});
  }
  if(action==="assign_property"){
   if(!isAdmin)return json(403,{ok:false,error:"Administrator access required."});
   if(!b.property_id||!b.host_user_id)return json(400,{ok:false,error:"Property and host account are required."});
   await db("properties?id=eq."+enc(b.property_id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({host_id:b.host_user_id,updated_at:new Date().toISOString()})});
   await db("property_hosts?property_id=eq."+enc(b.property_id),{method:"DELETE"});
   await db("property_hosts",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({property_id:b.property_id,user_id:b.host_user_id})});
   await db("admin_audit_log",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({actor_user_id:user.id,action:"host_assigned",target_type:"property",target_id:b.property_id,details:{host_user_id:b.host_user_id}})});
   return json(200,{ok:true});
  }
  return json(400,{ok:false,error:"Unknown portal action."});
 }catch(e){console.error("Stays portal:",e.status||"",e.message);return json(e.status===403?403:500,{ok:false,error:e.status===403?"You are not authorised to perform this action.":"Portal operation failed. Please refresh and try again."});}
};