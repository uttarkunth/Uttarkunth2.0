const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
const json=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
const enc=v=>encodeURIComponent(String(v));
exports.handler=async event=>{
 if(event.httpMethod==="OPTIONS")return{statusCode:204,headers,body:""};
 if(event.httpMethod!=="GET")return json(405,{ok:false,error:"Method not allowed."});
 const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return json(503,{ok:false,error:"Stays service is not configured."});
 async function get(path){const r=await fetch(url.replace(/\/+$/,"")+"/rest/v1/"+path,{headers:{apikey:key,Authorization:"Bearer "+key,Accept:"application/json"}});if(!r.ok)throw new Error("Database request failed "+r.status);return r.json();}
 try{
  const p=event.queryStringParameters||{}, fields="id,slug,name,description,address,village,district,state,amenities,photos,booking_mode,property_type";
  let path="properties?select="+fields+"&published=eq.true&moderation_status=eq.approved&order=name.asc";
  if(p.slug)path+="&slug=eq."+enc(p.slug);if(p.id)path+="&id=eq."+enc(p.id);
  if(["Himachal Pradesh","Jammu and Kashmir","Uttarakhand"].includes(p.state))path+="&state=eq."+enc(p.state);
  if(["homestay","hotel","resort","villa","guesthouse","cottage","other"].includes(p.type))path+="&property_type=eq."+enc(p.type);
  let properties=await get(path);
  if((p.slug||p.id)&&!properties.length)return json(404,{ok:false,error:"Stay not found or unavailable."});
  const ids=properties.map(x=>x.id);let rooms=[];
  if(ids.length)rooms=await get("room_units?select=id,property_id,room_name,description,max_guests,base_price,active&active=eq.true&property_id=in.("+ids.map(enc).join(",")+")&order=base_price.asc");
  let list=properties.map(x=>{const rs=rooms.filter(r=>r.property_id===x.id);return{...x,rooms:rs,starting_price:rs.length?Math.min(...rs.map(r=>Number(r.base_price||0))):null};});
  if(p.q){const s=p.q.trim().toLowerCase().slice(0,100);list=list.filter(x=>[x.name,x.description,x.village,x.district,x.state].some(v=>String(v||"").toLowerCase().includes(s)));}
  if(p.guests&&Number(p.guests)>0)list=list.filter(x=>x.rooms.some(r=>Number(r.max_guests)>=Number(p.guests)));
  if(p.max_price&&Number.isFinite(Number(p.max_price)))list=list.filter(x=>x.starting_price!==null&&x.starting_price<=Number(p.max_price));
  if(p.check_in&&p.check_out&&p.check_out>p.check_in&&list.length){
   const rids=list.flatMap(x=>x.rooms.map(r=>r.id));
   if(rids.length){const [blocks,stays,requests]=await Promise.all([
    get("room_availability_blocks?select=room_unit_id&room_unit_id=in.("+rids.map(enc).join(",")+")&blocked_from=lt."+enc(p.check_out)+"&blocked_until=gt."+enc(p.check_in)),
    get("stay_bookings?select=room_unit_id&room_unit_id=in.("+rids.map(enc).join(",")+")&status=in.(pending,confirmed)&check_in=lt."+enc(p.check_out)+"&check_out=gt."+enc(p.check_in)),
    get("booking_requests?select=room_unit_id&room_unit_id=in.("+rids.map(enc).join(",")+")&status=eq.pending&check_in=lt."+enc(p.check_out)+"&check_out=gt."+enc(p.check_in))
   ]);
   list=list.map(x=>({...x,rooms:x.rooms.filter(r=>!blocks.some(b=>b.room_unit_id===r.id)&&!stays.some(b=>b.room_unit_id===r.id)&&!requests.some(b=>b.room_unit_id===r.id))})).filter(x=>x.rooms.length);
   list=list.map(x=>({...x,starting_price:Math.min(...x.rooms.map(r=>Number(r.base_price||0)))}));
   }else list=[];
  }
  return json(200,p.slug||p.id?{ok:true,property:{...list[0],rooms:list[0]?.rooms||[]}}:{ok:true,count:list.length,properties:list});
 }catch(e){console.error("properties:",e.message);return json(500,{ok:false,error:"Unable to load stays right now."});}
};