import {parseCsv} from '../lib/artists.js';
import {validateDrama,generateSchedule} from './schedule.js';
import {validateDramaImages} from './images.js';
export const importFields={titleZh:'中文名',titleEn:'英文名',titleTh:'泰语名',types:'剧集类别',productionCompany:'出品公司',production:'制作进度',images:'图片链接',synopsis:'简介',source:'官方来源',cast:'卡司',platform:'播出平台',premiere:'首播日期',totalEpisodes:'总集数',weekdays:'每周播出日',episodesPerRelease:'每次更新集数',time:'播出时间',timezone:'时区',phases:'播出阶段JSON',rules:'平台排期JSON'};
const norm=v=>String(v||'').normalize('NFKC').trim().toLowerCase();
export function importTemplate(example=false){const values=Object.values(importFields);const rows=[values];if(example)rows.push(['晴天（示例，请替换）','Sunny Days','','BL','','已公布','https://example.com/poster.jpg;https://example.com/calendar.png','请填写简介','https://example.com/official','','YouTube','2026-11-05','12','周四;周日','1','21:30','Asia/Bangkok','','']);return '\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';}
export {parseCsv};
export function prepareDramaImport(grid,catalog){
 if(grid.length<2)throw Error('表格至少需要表头和一行资料');
 const headers=grid[0].map(v=>Object.keys(importFields).find(k=>norm(k)===norm(v)||norm(importFields[k])===norm(v)));
 if(!headers.some(h=>['titleZh','titleEn','titleTh'].includes(h)))throw Error('缺少剧名表头，请使用剧集导入模板');
 const recognized=headers.filter(Boolean);if(new Set(recognized).size!==recognized.length)throw Error('存在重复表头');
 const rows=grid.slice(1).map((cells,i)=>({cells,line:i+2})).filter(r=>r.cells.some(v=>String(v??'').trim()));if(rows.length>100)throw Error('每批最多 100 部剧集，请分批导入');
 const seen=new Set();const existing=new Set(catalog.dramas.flatMap(d=>[d.titleZh,d.titleEn,d.titleTh].map(norm).filter(Boolean)));
 const split=v=>String(v||'').split(/[;；\n]/).map(v=>v.trim()).filter(Boolean);
 return rows.map(({cells,line})=>{let title='';try{
  const raw=Object.fromEntries(headers.flatMap((k,i)=>k?[[k,(cells[i] instanceof Date?cells[i].toISOString().slice(0,10):String(cells[i]??'').trim())]]:[]));title=raw.titleZh||raw.titleEn||raw.titleTh||'';
  const names=[raw.titleZh,raw.titleEn,raw.titleTh].map(norm).filter(Boolean);if(names.some(n=>existing.has(n)||seen.has(n)))throw Error('剧名已存在或在本文件重复，本功能仅新增，不覆盖已有资料');
  const data={id:crypto.randomUUID(),titleZh:raw.titleZh||'',titleEn:raw.titleEn||'',titleTh:raw.titleTh||'',types:split(raw.types).map(t=>({'bl':'Boys Love','boys love':'Boys Love','gl':'Girls Love','girls love':'Girls Love','bg':'BG','bromance':'Bromance','群像':'群像','其他':'其他'}[norm(t)]||t)),production:raw.production||'',productionCompany:raw.productionCompany||'',images:split(raw.images),synopsis:raw.synopsis||'',source:raw.source||'',cast:[],rules:[]};
  if(!data.types.length)throw Error('请填写剧集类别，例如 BL、GL、BG、Bromance、群像或其他');
  if(data.production&&!['已公布','未开机','已开机','已杀青'].includes(data.production))throw Error('制作进度仅支持已公布、未开机、已开机、已杀青');
  if(data.productionCompany&&!catalog.companies.some(c=>norm(c)===norm(data.productionCompany)))throw Error('出品公司不在现有公司资料中');
  if(data.source&&!/^https?:\/\//i.test(data.source))throw Error('官方来源必须是 http/https 链接');
  data.poster=data.images[0]||'';
  for(const item of split(raw.cast)){const [who,role='',lead='']=item.split('|').map(v=>v.trim());const matches=catalog.artists.filter(a=>!a.deleted_at&&[a.id,a.name,a.en_name,a.full_name,...(a.aliases||[])].some(n=>n&&norm(n)===norm(who)));if(matches.length!==1)throw Error('卡司“'+who+'”'+(matches.length?'匹配多人，请填艺人ID':'未找到，请先加入艺人资料库'));const artist=matches[0];data.cast.push({artistId:artist.id,name:artist.en_name||artist.name,role,lead:['1','是','主演'].includes(lead)});}
  if(raw.rules){data.rules=JSON.parse(raw.rules);if(!Array.isArray(data.rules))throw Error('平台排期JSON必须是数组');}
  else if(raw.platform||raw.premiere){const platform=catalog.platforms.find(p=>[p.id,p.name].some(n=>norm(n)===norm(raw.platform)));if(!platform)throw Error('播出平台未找到，请先在平台管理中新增');const days=split(raw.weekdays).map(day=>{const token=day.replace(/^星期|^周/,'');const n={'日':0,'天':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6}[token];return n??Number(token);});data.rules=[{id:crypto.randomUUID(),platformId:platform.id,premiere:raw.premiere||'',totalEpisodes:['未知','unknown'].includes(norm(raw.totalEpisodes))?null:Number(raw.totalEpisodes),totalEpisodesUnknown:['未知','unknown'].includes(norm(raw.totalEpisodes)),weekdays:days,episodesPerRelease:Number(raw.episodesPerRelease||1),time:raw.time||'',timezone:raw.timezone||'Asia/Bangkok',phases:raw.phases?JSON.parse(raw.phases):[]}];}
  validateDrama(data);validateDramaImages(data);for(const rule of data.rules){if(!catalog.platforms.some(p=>p.id===rule.platformId))throw Error('排期JSON包含未知平台ID');generateSchedule(data,rule);}names.forEach(n=>seen.add(n));return {line,title,data,status:'ready',error:''};
 }catch(e){return {line,title,status:'invalid',error:e.message};}});
}
