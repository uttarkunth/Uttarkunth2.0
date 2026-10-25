const crypto=require("crypto");
const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET, POST, PATCH, OPTIONS"};
const json=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)}), enc=v=>encodeURIComponent(String(v)), clean=(v,n=200)=>String(v||"").trim().slice(0,n);
const validDate=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v||"")))return false;const d=new Date(v+"T00:00:00Z");return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===v;};
const nights=(a,b)=>Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000), hash=v=>crypto.createHash("sha256").update(v).digest("hex");
exports.handler=async event=>{
 if(event.httpMethod==="OPTIONS")return{statusCode:204,headers,body:""};
 if(!["GET","POST","PATCH"].includes(event.httpMethod))return json(405,{ok:false,error:"Method not allowed."});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return json(503,{ok:false,error:"Booking service is not configured."});
 const base=url.replace(/\/+$/,"")+"/rest/v1/";
 async function db(path,options={}){const r=await fetch(base+path,{...options,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Accept:"application/json",...(options.headers||{})}});const txt=await r.text();let d;try{d=txt?JSON.parse(txt):null;}catch{d=txt;}if(!r.ok){const e=new Error("Database request failed");e.status=r.status;throw e;}return d;}
 async function getUser(){const token=(event.headers.authorization||event.headers.Authorization||"").replace(/^Bearer\s+/i,"");if(!token)return null;const r=await fetch(url.replace(/\/+$/,"")+"/auth/v1/user",{headers:{apikey:key,Authorization:"Bearer "+token}});return r.ok?r.json():null;}
 try{
  const q=event.queryStringParameters||{};
  if(event.httpMethod==="GET"){
   const ref=clean(q.reference_code,40).toUpperCase(),token=clean(q.tracking_code,200);
   if(ref&&token){
    const rows=await db("booking_requests?select=id,booking_reference,property_id,room_unit_id,guest_name,guest_email,check_in,check_out,adults,children,estimated_total,status,created_at,host_notes,guest_access_token_hash&booking_reference=eq."+enc(ref)+"&limit=1");
    const row=rows[0];if(!row||!row.guest_access_token_hash||hash(token)!==row.guest_access_token_hash)return json(404,{ok:false,error:"Booking not found. Check your reference and tracking code."});
    const [p,r]=await Promise.all([db("properties?select=name,slug,village,district,state&id=eq."+enc(row.property_id)+"&limit=1"),db("room_units?select=room_name&id=eq."+enc(row.room_unit_id)+"&limit=1")]);
    const {guest_access_token_hash,...safe}=row;return json(200,{ok:true,booking:{...safe,property:p[0]||null,room:r[0]||null}});
   }
   const user=await getUser();if(!user)return json(401,{ok:false,error:"Sign in or enter your booking reference and tracking code."});
   const rows=await db("booking_requests?select=id,booking_reference,property_id,room_unit_id,check_in,check_out,adults,children,estimated_total,status,created_at,host_notes&guest_user_id=eq."+enc(user.id)+"&order=created_at.desc");
   return json(200,{ok:true,bookings:rows});
  }
  if(event.httpMethod==="POST"){
   const ip=String(event.headers["x-nf-client-connection-ip"]||event.headers["x-forwarded-for"]||"unknown").split(",")[0].trim().slice(0,100);
   const ipHash=hash(ip+"|uttarkunth-stays-rate-limit");
   await db("booking_rate_limits",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({ip_hash:ipHash})});
   const since=new Date(Date.now()-60*60*1000).toISOString();
   const recent=await db("booking_rate_limits?select=id&ip_hash=eq."+enc(ipHash)+"&created_at=gte."+enc(since)+"&limit=11");
   if(recent.length>10)return json(429,{ok:false,error:"Too many booking attempts from this connection. Please wait and try again later."});
   let b;try{b=JSON.parse(event.body||"{}");}catch{return json(400,{ok:false,error:"Invalid booking form data."});}
   const required=["property_id","room_unit_id","guest_name","guest_email","guest_phone","check_in","check_out"],missing=required.filter(k=>!clean(b[k],300));
   if(missing.length)return json(400,{ok:false,error:"Complete required fields.",fields:missing});
   if(!validDate(b.check_in)||!validDate(b.check_out)||b.check_in<new Date().toISOString().slice(0,10))return json(400,{ok:false,error:"Choose valid future dates."});
   const n=nights(b.check_in,b.check_out);if(n<1||n>60)return json(400,{ok:false,error:"Stay must be between 1 and 60 nights."});
   const adults=Number(b.adults||1),children=Number(b.children||0),email=clean(b.guest_email,254).toLowerCase();
   if(!Number.isInteger(adults)||adults<1||!Number.isInteger(children)||children<0)return json(400,{ok:false,error:"Guest count is invalid."});
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(400,{ok:false,error:"Enter a valid email."});
   const [ps,rs]=await Promise.all([db("properties?select=id,name,published,moderation_status&id=eq."+enc(b.property_id)+"&limit=1"),db("room_units?select=id,property_id,room_name,max_guests,base_price,active&id=eq."+enc(b.room_unit_id)+"&property_id=eq."+enc(b.property_id)+"&limit=1")]);
   const p=ps[0],r=rs[0];if(!p||!p.published||p.moderation_status!=="approved")return json(400,{ok:false,error:"This stay is not currently accepting requests."});
   if(!r||!r.active||adults+children>Number(r.max_guests))return json(400,{ok:false,error:"Selected room is inactive or guest count exceeds capacity."});
   const [blocks,confirmed,requests]=await Promise.all([
    db("room_availability_blocks?select=id&room_unit_id=eq."+enc(r.id)+"&blocked_from=lt."+enc(b.check_out)+"&blocked_until=gt."+enc(b.check_in)),
    db("stay_bookings?select=id&room_unit_id=eq."+enc(r.id)+"&status=in.(pending,confirmed)&check_in=lt."+enc(b.check_out)+"&check_out=gt."+enc(b.check_in)),
    db("booking_requests?select=id&room_unit_id=eq."+enc(r.id)+"&status=eq.pending&check_in=lt."+enc(b.check_out)+"&check_out=gt."+enc(b.check_in))
   ]);
   if(blocks.length||confirmed.length||requests.length)return json(409,{ok:false,error:"Those dates have a request, reservation or availability block. Choose other dates."});
   const token=crypto.randomBytes(32).toString("base64url"),ref="UK-"+crypto.randomBytes(6).toString("hex").toUpperCase(),user=await getUser();
   const total=Number((Number(r.base_price)*n).toFixed(2));
   const row={booking_reference:ref,property_id:p.id,room_unit_id:r.id,guest_name:clean(b.guest_name,120),guest_email:email,guest_phone:clean(b.guest_phone,40),special_requests:clean(b.special_requests,2000)||null,check_in:b.check_in,check_out:b.check_out,adults,children,estimated_total:total,status:"pending",guest_access_token_hash:hash(token),guest_user_id:user&&user.id||null};
   await db("booking_requests",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(row)});
   return json(201,{ok:true,booking_reference:ref,tracking_code:token,status:"pending",nights:n,estimated_total:total,property_name:p.name,message:"Request sent. It is not confirmed until the host approves it."});
  }
  let b;try{b=JSON.parse(event.body||"{}");}catch{return json(400,{ok:false,error:"Invalid request."});}
  if(!b.booking_reference||!b.tracking_code)return json(400,{ok:false,error:"Reference and tracking code are required."});
  const rows=await db("booking_requests?select=id,booking_reference,status,guest_access_token_hash&booking_reference=eq."+enc(clean(b.booking_reference,40).toUpperCase())+"&limit=1"),row=rows[0];
  if(!row||!row.guest_access_token_hash||hash(clean(b.tracking_code,200))!==row.guest_access_token_hash)return json(404,{ok:false,error:"Booking not found."});
  if(row.status!=="pending")return json(409,{ok:false,error:"Only pending requests can be cancelled online."});
  await db("booking_requests?id=eq."+enc(row.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"cancelled",cancellation_reason:"Cancelled by guest",updated_at:new Date().toISOString()})});
  return json(200,{ok:true,status:"cancelled"});
 }catch(e){console.error("Stays booking API",e.status||"",e.message);return json(500,{ok:false,error:"Booking service could not complete this request. Please try again."});}
};