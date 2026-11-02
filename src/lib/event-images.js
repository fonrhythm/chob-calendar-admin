import { supabase } from '@/config/supabase';
export function facebookImage(url) {
  try { const u=new URL(url); return u.protocol==='https:'&&(u.hostname==='fbcdn.net'||u.hostname.endsWith('.fbcdn.net')||u.hostname==='fbsbx.com'||u.hostname.endsWith('.fbsbx.com')); } catch{return false;}
}
export async function saveImage(fileOrUrl) {
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw Error('请先登录后台。');
  if(typeof fileOrUrl==='string'&&!facebookImage(fileOrUrl)){
    if(fileOrUrl.startsWith(import.meta.env.VITE_SUPABASE_URL+'/storage/v1/object/public/chob-event-images/'))return fileOrUrl;
    if(!/^https?:\/\//i.test(fileOrUrl))throw Error('请填写完整的图片链接');
    try{const response=await fetch(fileOrUrl,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();const blob=await response.blob();return saveImage(blob);}catch{throw Error('图片链接无法读取，请上传原图。');}
  }
  const headers={Authorization:`Bearer ${session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY};
  let body;
  if(typeof fileOrUrl==='string'){headers['Content-Type']='application/json';body=JSON.stringify({url:fileOrUrl});}
  else {if(fileOrUrl.size>10*1024*1024)throw Error('图片不能超过 10 MB。');body=fileOrUrl;headers['Content-Type']=fileOrUrl.type;}
  const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chob-event-image`,{method:'POST',headers,body});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'图片保存失败，请上传原图后重试。');
  return data.url;
}
export async function persistEventImages(event) {
  const pictures=event.attributes?.picture_urls||[];
  if(!pictures.some(facebookImage))return event;
  const stored=[],sources={...(event.attributes?.image_sources||{})};
  for(const url of pictures){const next=facebookImage(url)?await saveImage(url):url;stored.push(next);if(next!==url)sources[next]=url;}
  return {...event,attributes:{...event.attributes,picture_urls:stored,image_sources:sources}};
}
