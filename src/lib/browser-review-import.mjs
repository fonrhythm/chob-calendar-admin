// Only existing source/review RPCs are available to this importer.
export function prepareBrowserReviews(batch) {
 if(batch?.mode!=='browser-sample'||batch.coverage_complete!==false||!Array.isArray(batch.records)||!batch.records.length||batch.records.length>100)throw Error('请选择最多100条的浏览器样本文件');
 const seen=new Set();
 return batch.records.map(r=>{
  const p=r.post;let u;try{u=new URL(p?.url)}catch{throw Error('原帖链接无效')}
  if(u.protocol!=='https:'||u.hostname!=='x.com'||!/^\d+$/.test(p.id)||!/^\w{1,15}$/.test(p.account)||u.pathname.toLowerCase()!==`/${p.account}/status/${p.id}`.toLowerCase()||u.search||u.hash||!Number.isFinite(Date.parse(p.published_at))||typeof p.text!=='string'||!p.text.trim()||p.text.length>100000)throw Error('原帖身份或正文无效');
  const key=p.account.toLowerCase()+':'+p.id;if(seen.has(key))throw Error('样本含重复原帖');seen.add(key);
  const images=r.image_transcriptions||[];
  if(!Array.isArray(images)||images.some(i=>i.verified!==true||!new RegExp('^'+p.url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/photo/[1-4]$').test(i.url)||typeof i.text!=='string'||!i.text.trim()||i.text.length>100000))throw Error('图片证据未经核验或链接无效');
  if(r.observations&&!Array.isArray(r.observations))throw Error('审核备注格式无效');
  const raw={text:p.text,post_id:p.id,media:images.map(i=>i.url),ocr_texts:images.map(i=>i.text),capture:r.text_capture||'browser sample',image_transcriptions:images,coverage_complete:false};
  return {source:{url:p.url,platform:'x',account:p.account,source_type:'unknown',priority:5,published_at:p.published_at,raw_evidence:raw},review:{entity_type:'event',reason:'浏览器真实样本：身份、日期规范化、图片及活动范围需审核',candidates:[],evidence:{raw,extraction:r.extraction||{},observations:r.observations||[],import_mode:'browser-sample',coverage_complete:false}}};
 });
}
export async function importBrowserReviews(batch,io) {
 const prepared=prepareBrowserReviews(batch); // Validate the entire file before any writes.
 const results=[];
 for(const row of prepared){
  try{
   const sourceId=await io.saveSource(row.source);
   if(await io.hasReview(sourceId)){results.push({url:row.source.url,action:'duplicate'});continue;}
   await io.saveReview({...row.review,source_id:sourceId});
   results.push({url:row.source.url,action:'review'});
  }catch(e){results.push({url:row.source.url,action:'failed',error:e.message});}
 }
 return results;
}
