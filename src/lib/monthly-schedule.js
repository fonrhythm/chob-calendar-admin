import { artistTypeKeys } from './artistFilters.js';
export const BAR_NOTICE = '温馨提示：此场为酒吧/餐吧演出，一般需要提前去FB或是Line联系店家预定桌子，如有需要，请自行搜索联系，具体演出时间，请咨询店家。';
export const FORMS = {bar:'酒吧／餐吧',festival:'音乐节',livehouse:'Livehouse',commercial:'品牌商演',other:'普通演出'};
export const normalizeFestival = value => String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function monthlyDate(month, day) {
  const value=`${month}-${String(day).padStart(2,'0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:'';
}
export function parseMonthlyText(text, month) {
  return String(text||'').replace(/[๐-๙]/g,c=>String(c.charCodeAt(0)-3664)).split(/\r?\n/).flatMap((line,index)=>{
    const match=line.trim().match(/^(\d{1,2}|O\d|\d[OIl])(?:[.)]\s*|\s+)(.+)$/);
    if(!match)return [];
    const content=match[2].trim();
    if(/^(?:SHOW\s*BOOKING|PR\b|LINE\s*ID|TEL\b)/i.test(content))return [];
    const parts=content.split(/\s*[|\t]\s*|\s*_{3,}\s*|\s{2,}/).filter(Boolean);
    const form=content.includes('ร้าน')?'bar':/festival|\bfest\b|\bexpo\b|เทศกาล/i.test(content)?'festival':/livehouse/i.test(content)?'livehouse':'other';
    const title=parts[0].replace(/^(?:ร้าน|งาน)\s*/u,'').trim();
    const day=match[1].replace(/O/g,'0').replace(/[Il]/g,'1');
    return [{id:`line-${index}`,selected:true,reviewed:false,forceNew:false,day,date:monthlyDate(month,day),title,venue:parts.slice(1).join(' '),city:'',time:'',form,category:'music',note:form==='bar'?BAR_NOTICE:'',original:line.trim(),action:'new'}];
  }).slice(0,100);
}
export function monthlyCandidates(row, events) {
  const name=normalizeFestival(row.title);
  if(!name)return [];
  return events.filter(event=>{
    if(event.attributes?.admin_deleted_at||event.status==='withdrawn')return false;
    const eventName=normalizeFestival(event.title);
    const dateMatches=event.date<=row.date&&(event.attributes?.end_date||event.date)>=row.date;
    const numbers=value=>(value.match(/\d+/g)||[]).join(',');
    const related=name.length>=6&&eventName.length>=6&&(eventName.includes(name)||name.includes(eventName))&&numbers(name)===numbers(eventName);
    return dateMatches && (eventName===name||related);
  }).map(event=>({event,exact:normalizeFestival(event.title)===name&&!!row.venue&&normalizeFestival(row.venue)===normalizeFestival(event.location)}));
}
export function monthlyLineup(row, common) {
  return {artist_id:common.artistId,date:row.date,time:row.time||'',source_url:common.sourceUrl||'',image_url:common.imageUrl,original_image_url:common.originalImageUrl||'',month:common.month,original_text:row.original||'',performance_form:row.form};
}
export function mergeMonthlyLineup(event,row,common,catalog) {
  const lineup=monthlyLineup(row,common),attributes=event.attributes||{};
  const lineups=[...(attributes.monthly_lineups||[])];
  const index=lineups.findIndex(x=>x.artist_id===lineup.artist_id&&x.date===lineup.date);
  if(index<0)lineups.push(lineup);else lineups[index]={...lineups[index],...lineup};
  const selections=attributes.artist_selections?.length?attributes.artist_selections:event.artist_ids||[];
  return {...event,artist_ids:[...new Set([...(event.artist_ids||[]),common.artistId])],attributes:{...attributes,
    artist_selections:[...new Set([...selections,common.artistId])],
    artist_types:[...new Set([...(attributes.artist_types||[]),...artistTypeKeys(catalog.find(a=>a.id===common.artistId)||{})])],
    monthly_lineups:lineups}};
}
