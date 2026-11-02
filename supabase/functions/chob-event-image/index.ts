import {allowedRemote,imageMime,limitedBytes} from './image-security.js';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
const origins=new Set(['https://fonrhythm.github.io','http://127.0.0.1:5199']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origins.has(origin)?origin:'https://fonrhythm.github.io','Access-Control-Allow-Headers':'authorization,content-type,apikey','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!origins.has(origin))return reply({error:'不支持此来源'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const authorization=req.headers.get('authorization')||'';
 const authHeaders={apikey:key,Authorization:authorization};
 try{
  const auth=await fetch(base+'/auth/v1/user',{headers:authHeaders});if(!auth.ok)return reply({error:'请先登录'},401);
  const user=await auth.json();
  const profile=await fetch(base+'/rest/v1/users?id=eq.'+user.id+'&select=role,is_active,email_verified,backend_approved',{headers:authHeaders});
  const p=(await profile.json())[0];if(!profile.ok||!p?.is_active||!p?.email_verified||!p?.backend_approved||!['admin','collaborator_fan'].includes(p.role))return reply({error:'需要已获批的后台编辑权限'},403);
  let bytes;
  if(req.headers.get('content-type')?.startsWith('application/json')){
   if(Number(req.headers.get('content-length'))>10000)return reply({error:'请求过大'},413);
   let url=(await req.json()).url;if(typeof url!=='string'||url.length>8192||!allowedRemote(url))return reply({error:'仅支持 FB 图片直链；其他图片请上传原图'},400);
   let response:Response|undefined;
   for(let i=0;i<4;i++){
    if(!allowedRemote(url))return reply({error:'图片重定向不受支持'},400);
    response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('图片跳转失败');url=new URL(location,url).href;continue;}break;
   }
   if(!response?.ok)throw Error('FB 图片已过期或无法读取，请上传原图');
   bytes=await limitedBytes(response);
  }else bytes=await limitedBytes(new Response(req.body,{headers:req.headers}));
  const mime=imageMime(bytes);if(!mime)return reply({error:'只支持 JPEG、PNG、WebP 原图'},400);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const ext=mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp',path=user.id+'/'+digest+'.'+ext;
  const upload=await fetch(base+'/storage/v1/object/chob-event-images/'+path,{method:'POST',headers:{...authHeaders,'Content-Type':mime,'Cache-Control':'max-age=31536000','x-upsert':'false'},body:bytes});
  if(!upload.ok){const info=await upload.json();if(info.statusCode!=='409'&&info.error!=='Duplicate')throw Error('图片保存失败：'+(info.message||'存储不可用'));}
  return reply({url:base+'/storage/v1/object/public/chob-event-images/'+path});
 }catch(e){return reply({error:e instanceof Error?e.message:'图片保存失败'},400);}
});
