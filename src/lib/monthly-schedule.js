import { artistTypeKeys } from './artistFilters.js';
export const BAR_NOTICE = '温馨提示：此场为酒吧/餐吧演出，一般需要提前去FB或是Line联系店家预定桌子，如有需要，请自行搜索联系，具体演出时间，请咨询店家。';
export const FORMS = {bar:'酒吧／餐吧',festival:'音乐节',livehouse:'Livehouse',commercial:'品牌商演',other:'普通演出'};
export const normalizeFestival = value => String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function monthlyDate(month, day) {
  const value=`${month}-${String(day).padStart(2,'0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:'';
}
const monthNames={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
export function parseMonthlyText(text, month) {
  const lines=String(text||'').replace(/[๐-๙]/g,c=>String(c.charCodeAt(0)-3664)).split(/\r?\n/);
  const groups=[];let current=null;
  for(const [index,raw] of lines.entries()){
    let line=raw.trim().replace(/([\u0E00-\u0E7F])[ \t]+(?=[\u0E00-\u0E7F])/g,'$1');if(!line)continue;
    const corrections=[];
    // Narrow correction for a common schedule phrase; retain the OCR evidence and require review.
    if(line.includes('ถ่ายธายการ')){line=line.replaceAll('ถ่ายธายการ','ถ่ายรายการ');corrections.push('泰文说明按常见行程用语修正为“ถ่ายรายการ”，请对照原图核对');}
    if(/(?:booking\s*show|show\s*booking|^booking$|^PR\b|^INFLUENCER\b|^LINE\s*ID|^TEL\b)/i.test(line)){current=null;continue;}
    // Avoid treating years and telephone numbers as day anchors.
    const anchor=line.match(/^(\d{1,2}|O\d|\d[OIl])(?:[.)]\s*|\s+|(?=[A-Za-z])|$)(.*)$/);
    if(anchor){
      const day=anchor[1].replace(/O/g,'0').replace(/[Il]/g,'1');let rest=anchor[2].trim(),explicitMonth=null;
      const name=rest.match(/^([A-Za-z]+)\.?(?:\s+|$)/);
      if(name&&monthNames[name[1].toLowerCase()]){explicitMonth=monthNames[name[1].toLowerCase()];rest=rest.slice(name[0].length).trim();}
      current={index,day,explicitMonth,parts:rest?[rest]:[],original:[raw.trim()],corrections};groups.push(current);
    }else if(current){
      if(monthNames[line.toLowerCase().replace(/\.$/,'')]){current.explicitMonth=monthNames[line.toLowerCase().replace(/\.$/,'')];current.original.push(line);continue;}
      if(/^(?:november|december|january|february|march|april|may|june|july|august|september|october)\s+20\d{2}$/i.test(line))continue;
      current.parts.push(line);current.original.push(raw.trim());current.corrections.push(...corrections);
    }
  }
  return groups.slice(0,100).map(group=>{
    const content=group.parts.join(' '),form=content.includes('ร้าน')?'bar':/festival|\bfest\b|\bexpo\b|เทศกาล/i.test(content)?'festival':/livehouse/i.test(content)?'livehouse':'other';
    const titles=[],venues=[];let venueStarted=false;
    for(const part of group.parts){
      if(/^[@＠]/.test(part)){venues.push(part.replace(/^[@＠]\s*/,''));venueStarted=true;continue;}
      if(venueStarted){venues.push(part);continue;}
      const split=part.split(/\s*[|\t]\s*|\s*_{3,}\s*|\s{2,}/).filter(Boolean);
      const at=split[0]?.match(/^(.*?)\s+[@＠]\s*(.+)$/);
      if(at){if(at[1])titles.push(at[1]);venues.push(at[2]);venueStarted=true;}else if(split[0])titles.push(split[0]);
      venues.push(...split.slice(1));if(split.length>1)venueStarted=true;
    }
    const warnings=[...new Set(group.corrections)],date=monthlyDate(month,group.day);
    const monthMismatch=group.explicitMonth!==null&&group.explicitMonth!==Number(month.slice(5));
    if(monthMismatch)warnings.push('图片中的月份与所选月份不同，请核对日期');
    if(!date)warnings.push('日期无法确认，请对照原图修改');
    const title=titles.join(' ').replace(/^(?:ร้าน|งาน)\s*/u,'').trim();
    if(!title)warnings.push('日期下面未识别到活动说明，请补充');
    const category=/ถ่ายรายการ|บันทึกเทป|recording|TV show/i.test(content)?'broadcast':/ร่วมงาน|in[ -]?cosmetics|อีเวนต์/i.test(content)?'interaction':'music';
    return {id:'line-'+group.index,selected:true,reviewed:false,forceNew:false,day:group.day,date:monthMismatch?'':date,title,venue:venues.join(' '),city:'',time:'',form,category,note:form==='bar'?BAR_NOTICE:'',original:group.original.join('\n'),parseWarnings:warnings,action:'new'};
  });
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
