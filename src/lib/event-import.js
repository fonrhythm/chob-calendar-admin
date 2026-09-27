import { normalize, parseCsv } from './artists.js'
import { eventTime, imageUrls, validateEvent } from './event-fields.js'

const aliases = { date:'date',日期:'date', time:'time',时间:'time', name:'name',艺人名称:'name',参与艺人:'name',
  activity:'activity',title:'activity',活动名称:'activity', venue:'venue',场地:'venue', city:'city',城市:'city',
  company:'company',公司:'company', type:'type',艺人类别:'type', region:'region',地区:'region', thailand:'thailand',
  category:'category', event_type:'event_type',活动类型:'event_type', participation_condition:'participation_condition',参与方式:'participation_condition',
  picture_url:'picture_url',picture_urls:'picture_url',活动图片:'picture_url', note:'note',备注:'note', description:'description',参与规则:'description',
  ticket_url:'ticket_url',ticket_type:'ticket_type',price:'price',tag:'tag',status:'status',sale_date:'sale_date',sale_time:'sale_time',slae_date:'sale_date',
  sale_end_date:'sale_end_date',sale_end_time:'sale_end_time' }
const text = value => value == null ? '' : String(value).trim()
export function importDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0,10)
  const match = text(value).match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  if (!match) return ''
  const result = `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`
  return !Number.isNaN(Date.parse(result)) && new Date(result).toISOString().slice(0,10) === result ? result : ''
}
export function importTime(value) {
  if (value instanceof Date) return value.toISOString().slice(11,16)
  if (typeof value === 'number' && value >= 0 && value < 1) { const minutes=Math.round(value*1440)%1440; return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}` }
  return text(value)
}
export function readImportRows(rows) {
  if (rows.length < 2) throw new Error('文件至少需要表头和一行活动。')
  const headers=rows[0].map(v=>aliases[normalize(v)])
  const mapped=headers.filter(Boolean)
  if (new Set(mapped).size!==mapped.length) throw new Error('表头含重复含义的字段，请保留一列。')
  for (const required of ['name','activity','date','venue']) if(!headers.includes(required)) throw new Error(`缺少必需列：${required}`)
  const data=rows.slice(1).map((row,index)=>({row,index})).filter(({row})=>row.some(v=>text(v)))
  if(data.length > 200) throw new Error('每次最多导入 200 行，请拆分文件。')
  if(!data.length) throw new Error('文件没有活动数据。')
  return data.map(({row,index})=>({line:index+2,id:crypto.randomUUID(),taskId:crypto.randomUUID(),raw:Object.fromEntries(headers.flatMap((h,i)=>h?[[h,row[i]??'']]:[]))}))
}
export const csvImportRows = source => readImportRows(parseCsv(source))
export function eventFingerprint(e) { return [normalize(e.title), e.date, normalize(e.location), [...(e.artist_ids||[])].sort().join(',')].join('|') }
function matchRecord(value, records, keys) {
  const query=normalize(value)
  return records.filter(r=>keys.some(key=>normalize(r[key])===query && query))
}
export function previewImport(rows, workspace, defaults = {}) {
  const existing=new Set(workspace.events.map(eventFingerprint)), seen=new Set()
  return rows.map(({raw:r,id,taskId,line})=>{
    const problems=[],warnings=[], artistIds=[]
    const names=text(r.name).split(/[;；|、/]/).map(s=>s.trim()).filter(Boolean)
    if(!names.length) problems.push('艺人名称不能为空')
    for(const name of names) {
      const matches=workspace.artists.filter(a=>!a.deleted_at && [a.name,a.en_name,...(a.aliases||[])].some(v=>normalize(v)===normalize(name)))
      if(matches.length!==1) problems.push(matches.length ? `艺人“${name}”存在重名，请在资料库设置唯一别名后使用` : `找不到艺人“${name}”，请先添加资料或修正名称`)
      else artistIds.push(matches[0].id)
    }
    const typeValue=text(r.event_type || r.category)
    const types=typeValue ? matchRecord(typeValue,workspace.types,['id','name','code','label']) : []
    if(typeValue && types.length!==1) problems.push(`活动类型“${typeValue}”无法唯一匹配，请填写后台类型名称或编号`)
    const conditionValue=text(r.participation_condition || defaults.condition)
    const conditions=matchRecord(conditionValue,workspace.conditions,['code','name'])
    if(conditions.length!==1) problems.push('请选择默认参与方式，或在表格中填写有效的 participation_condition')
    let region=text(r.region || defaults.region)
    if(!region && text(r.thailand)) region=['true','1','yes','是','泰国'].includes(normalize(r.thailand)) ? '泰国' : ['false','0','no','否'].includes(normalize(r.thailand)) ? '其他国家或地区' : text(r.thailand)
    const timeText=importTime(r.time)
    const event={id,title:text(r.activity),date:importDate(r.date),time:eventTime(timeText),location:text(r.venue),location_region:text(r.city),company:text(r.company),
      artist_ids:[...new Set(artistIds)],event_type_id:types[0]?.id||'',participation_condition:conditions[0]?.code||'',description:text(r.description),ticket_url:text(r.ticket_url),status:'draft',
      attributes:{artist_type:text(r.type),region,time_text:timeText,picture_urls:imageUrls(r.picture_url),note:text(r.note),category:text(r.category),ticket_type:text(r.ticket_type),price:text(r.price),tag:text(r.tag),source_status:text(r.status)}}
    const tasks=[]
    if(text(r.sale_date)) {
      const start=importDate(r.sale_date), end=text(r.sale_end_date)?importDate(r.sale_end_date):''
      if(!start || (text(r.sale_end_date) && !end)) problems.push('开售日期或开售结束日期无效，需填写完整年月日')
      const startText=importTime(r.sale_time),endText=importTime(r.sale_end_time)
      if((startText && !eventTime(startText)) || (endText && !eventTime(endText))) problems.push('开售时间需填写 HH:mm')
      tasks.push({id:taskId,title:`${event.title} · 购票`,task_type:'ticketing',start_date:start,end_date:end,start_time:eventTime(startText),end_time:eventTime(endText),action_url:event.ticket_url,description:'',status:'draft'})
      if(!end) warnings.push('已生成购票草稿；请补截止日期后发布事项')
    } else if(text(r.sale_time) || text(r.sale_end_date) || text(r.sale_end_time)) problems.push('有开售时间或结束日期，但缺少 sale_date')
    const validation=validateEvent(event,tasks)
    if(validation) problems.push(validation)
    const key=eventFingerprint(event)
    if(existing.has(key)) problems.push('数据库中已有相同艺人、活动名称、日期和场地的活动')
    if(seen.has(key)) problems.push('文件中有重复活动')
    seen.add(key)
    return {line,event,tasks,problems:[...new Set(problems)],warnings,names:names.join(' / ')}
  })
}
