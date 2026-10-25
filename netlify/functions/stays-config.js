exports.handler=async()=>{
 const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"};
 const url=process.env.SUPABASE_URL||"",anon=process.env.SUPABASE_ANON_KEY||"";
 if(!url||!anon)return{statusCode:503,headers,body:JSON.stringify({ok:false,error:"Set SUPABASE_URL and SUPABASE_ANON_KEY in Netlify environment variables."})};
 return{statusCode:200,headers,body:JSON.stringify({ok:true,supabaseUrl:url,supabaseAnonKey:anon})};
};