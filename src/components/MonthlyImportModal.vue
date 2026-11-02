<script setup>
import {computed,ref,onUnmounted} from 'vue';
import ModalShell from './common/ModalShell.vue';
import {BAR_NOTICE,FORMS,parseMonthlyText,monthlyCandidates,mergeMonthlyLineup,monthlyLineup} from '@/lib/monthly-schedule';
import {recognizeMonthlyImage} from '@/lib/monthly-ocr';
import {saveImage} from '@/lib/event-images';
import {newEvent,saveEventWithTasks,loadEventWorkspace} from '@/lib/events';
import {eventTime,validateEvent,recordLabel} from '@/lib/event-fields';
import {displayArtistName} from '@/lib/artists';
import {ACTIVITY_TYPES} from '@/lib/activity-types';
import {rpc} from '@/lib/api';
const props=defineProps({workspace:Object}),emit=defineEmits(['close','imported']);
const artistId=ref(''),month=ref(new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}).slice(0,7)),sourceUrl=ref(''),imageInput=ref(''),imageUrl=ref(''),originalImageUrl=ref(''),region=ref('泰国'),condition=ref('');
const bulkForm=ref(''),bulkCategory=ref('');
const busy=ref(false),error=ref(''),message=ref(''),text=ref(''),rows=ref([]),crop=ref(0),imageMode=ref('original'),mode=ref('draft'),sourceId=ref('');
const artists=computed(()=>props.workspace.artists.filter(a=>!a.deleted_at));
const selected=computed(()=>rows.value.filter(r=>r.selected));
const allSelected=computed(()=>rows.value.length>0&&selected.value.length===rows.value.length);
let localFile=null;const objectUrl=ref('');
const previewUrl=computed(()=>objectUrl.value||imageUrl.value);
function resetReview(){for(const row of rows.value)row.reviewed=false;}
async function fileChosen(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>10*1024*1024){error.value='图片不能超过 10 MB';return;}if(objectUrl.value)URL.revokeObjectURL(objectUrl.value);localFile=file;objectUrl.value=URL.createObjectURL(file);imageUrl.value='';imageInput.value='';originalImageUrl.value='';resetReview();}
async function ensureImage(){if(imageUrl.value)return imageUrl.value;if(localFile){imageUrl.value=await saveImage(localFile);}else{if(!imageInput.value.trim())throw Error('请提供图片链接或上传原图');originalImageUrl.value=imageInput.value.trim();imageUrl.value=await saveImage(imageInput.value.trim());}return imageUrl.value;}
async function recognize(){if(busy.value)return;busy.value=true;error.value='';try{
 const url=await ensureImage();message.value='准备本地识别模型，首次加载需要稍等…';
 const blob=localFile||await (await fetch(url)).blob(),bitmap=await createImageBitmap(blob);
 const top=Math.round(bitmap.height*crop.value/100),scale=Math.min(2,2600/bitmap.width);
 const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round((bitmap.height-top)*scale);const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,top,bitmap.width,bitmap.height-top,0,0,canvas.width,canvas.height);bitmap.close();
 if(imageMode.value!=='original'){const data=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<data.data.length;i+=4){const r=data.data[i],g=data.data[i+1],b=data.data[i+2];const v=imageMode.value==='red'?(r>g*1.3&&r>b*1.2&&r>55?0:255):255-Math.round(.299*r+.587*g+.114*b);data.data[i]=data.data[i+1]=data.data[i+2]=v;}ctx.putImageData(data,0,0);}
 text.value=await recognizeMonthlyImage(canvas,m=>{message.value=`本地识别中 ${Math.round((m.progress||0)*100)}%`;});message.value='识别完成，请检查原始文字并生成初稿。';
 }catch(e){error.value=e.message;}finally{busy.value=false;}}
function generate(){error.value='';if(!artistId.value||!month.value){error.value='请先选择艺人和年月';return;}if(rows.value.length&&!window.confirm('重新生成会替换当前未导入的核对内容，继续吗？'))return;
 rows.value=parseMonthlyText(text.value,month.value).map(row=>({...row,id:crypto.randomUUID()}));
 for(const row of rows.value){const candidates=monthlyCandidates(row,props.workspace.events);if(candidates.length===1&&candidates[0].exact)row.action=candidates[0].event.id;}
 if(!rows.value.length)error.value='没有识别到日期开头的行程。可修正文字，每行填写“03 活动名称 | 场地”，再生成初稿。';
}
function changeForm(row){if(row.form==='bar'&&!row.note.includes(BAR_NOTICE))row.note=[row.note,BAR_NOTICE].filter(Boolean).join('\n');else if(row.form!=='bar')row.note=row.note.replace(BAR_NOTICE,'').trim();row.reviewed=false;}
function common(){return {artistId:artistId.value,month:month.value,sourceUrl:sourceUrl.value.trim(),imageUrl:imageUrl.value,originalImageUrl:originalImageUrl.value};}
function makeEvent(row){const artist=artists.value.find(a=>a.id===artistId.value);return {...newEvent(),id:row.id,title:row.title.trim(),date:row.date,time:eventTime(row.time),location:row.venue.trim(),location_region:row.city.trim(),artist_ids:[artistId.value],company:artist?.company||'',participation_condition:condition.value,status:mode.value,attributes:{activity_category:row.category,region:region.value,time_text:row.time.trim(),picture_urls:[imageUrl.value],note:row.note,artist_selections:[artistId.value],field_states:{time:row.time?'known':'tba'},monthly_lineups:[monthlyLineup(row,common())]},ticket_url:sourceUrl.value.trim()};}
async function submit(){if(busy.value)return;busy.value=true;error.value='';let count=0;try{
 if(!selected.value.length)throw Error('请勾选要导入的行程');if(!artistId.value)throw Error('请选择艺人');
 if(sourceUrl.value&&!/^https?:\/\//i.test(sourceUrl.value))throw Error('原文链接需要完整的 http 或 https 地址');
 if(selected.value.some(row=>!row.reviewed))throw Error('请逐行勾选“已核对”');
 await ensureImage();
 const fresh=await loadEventWorkspace();
 for(const row of selected.value){if(!row.date||!row.title.trim()||(row.time&&!eventTime(row.time)))throw Error('请核对日期、活动名称和时间');
   if(row.action==='new'){
    const existing=monthlyCandidates(row,fresh.events);if(existing.length&&!row.forceNew)throw Error(`“${row.title}”已有同日期／日期范围活动，请选择关联，避免重复新增。`);
    const problem=validateEvent(makeEvent(row),[]);if(problem)throw Error(`${row.title}：${problem}`);
   }else if(!monthlyCandidates(row,fresh.events).some(c=>c.event.id===row.action))throw Error(`“${row.title}”的关联活动已变化，请重新核对`);
 }
 if(!sourceId.value&&sourceUrl.value.trim())sourceId.value=await rpc('chob_add_source',{payload:{url:sourceUrl.value.trim(),platform:/facebook|fb\.com/i.test(sourceUrl.value)?'facebook':'other',source_type:'unknown',priority:5,raw_evidence:{text:text.value,media:[imageUrl.value],month:month.value}}});
 const provenance=sourceId.value?{source_id:sourceId.value,role:'evidence'}:null;
 for(const row of [...selected.value]){
   let event,tasks=[];
   if(row.action==='new')event=makeEvent(row);
   else{const current=fresh.events.find(e=>e.id===row.action);event=mergeMonthlyLineup(current,row,common(),fresh.artists);tasks=fresh.tasks.filter(t=>t.event_id===current.id);}
   await saveEventWithTasks(event,tasks,null,provenance);
   rows.value=rows.value.filter(r=>r.id!==row.id);count++;message.value=`已成功处理 ${count} 条；剩余 ${rows.value.length} 条`;
   // Refresh after each successful save to preserve another row's newly added lineup/version.
   const latest=await loadEventWorkspace();fresh.events=latest.events;fresh.tasks=latest.tasks;
 }
 emit('imported');
 }catch(e){error.value=`${count?'已保存 '+count+' 条，其余保留供重试。':''}${e.message}`;if(count)emit('imported');}finally{busy.value=false;}}
onUnmounted(()=>{if(objectUrl.value)URL.revokeObjectURL(objectUrl.value);});
</script>
<template>
<ModalShell class="monthly-dialog" title="月行程图导入" :busy="busy" @close="emit('close')">
 <div class="space-y-4">
 <p>一次选择艺人、年月、图片和原文来源。本地识别生成初稿，逐行核对后再保存。此处的关联活动与原有相似活动检查分开。</p>
 <div class="grid sm:grid-cols-2 gap-3">
 <label>艺人／乐队<select v-model="artistId" :disabled="busy||rows.length>0" class="input-field"><option value="">请选择</option><option v-for="a in artists" :key="a.id" :value="a.id">{{displayArtistName(a)}} · {{a.company}}</option></select></label>
 <label>年月<input v-model="month" type="month" class="input-field" :disabled="busy||rows.length>0" /></label>
 <label>原文链接<input v-model="sourceUrl" :disabled="busy||!!sourceId" type="url" class="input-field" placeholder="FB 原帖或官方公告链接" @input="resetReview" /></label>
 <label>图片链接<input v-model="imageInput" :disabled="busy||!!imageUrl" class="input-field" placeholder="FB 图片直链；失效时请上传原图" /></label>
 <label>地区<select v-model="region" :disabled="busy" class="input-field" @change="resetReview"><option>泰国</option><option>其他国家或地区</option><option>线上</option></select></label>
 <label>新增活动参与方式<select v-model="condition" :disabled="busy" class="input-field" @change="resetReview"><option value="">请选择</option><option v-for="c in workspace.conditions" :key="c.code" :value="c.code">{{recordLabel(c)}}</option></select></label>
 </div>
 <label class="btn-secondary inline-block cursor-pointer">上传原图<input type="file" class="sr-only" accept="image/png,image/jpeg,image/webp" :disabled="busy||rows.length>0" @change="fileChosen" /></label>
 <img v-if="previewUrl && !rows.length" :src="previewUrl" alt="月行程原图" class="max-h-72 max-w-full object-contain" />
 <div class="flex flex-wrap gap-3 items-center"><label>跳过顶部海报 {{crop}}%<input v-model.number="crop" type="range" min="0" max="90" :disabled="busy" /></label><label>图片文字<select v-model="imageMode" :disabled="busy" class="input-field"><option value="original">普通图片</option><option value="red">红字深底</option><option value="dark">浅字深底</option></select></label><button class="btn-secondary" :disabled="busy" @click="recognize">识别图片文字</button></div>
 <p class="text-sm text-gray-500">只在当前浏览器识别，不调用外部 AI API。识别不准可在下方修正文字。场地和城市不会凭空推断。</p>
 <label class="block">识别文字／手动粘贴<textarea v-model="text" :disabled="busy" rows="8" class="input-field" placeholder="03 ร้าน HEY BAR | PRACHA CHUEN&#10;21 งาน CAT EXPO 13 | SIAM AMAZING PARK"></textarea></label>
 <button class="btn-secondary" :disabled="busy" @click="generate">生成核对初稿</button>
 <p v-if="message" role="status">{{message}}</p><p v-if="error" role="alert" class="text-red-700">{{error}}</p>
 <template v-if="rows.length">
 <div class="flex gap-3"><label><input type="checkbox" :checked="allSelected" :indeterminate="selected.length>0&&!allSelected" :disabled="busy" @change="rows.forEach(r=>r.selected=$event.target.checked)" />全选行程</label><button :disabled="busy" @click="rows.forEach(r=>r.selected=false)">全不选</button><span>共 {{rows.length}} 条，已选 {{selected.length}} 条</span></div>
 <div class="flex flex-wrap gap-2"><select v-model="bulkForm" :disabled="busy" class="input-field"><option value="">批量设置已勾选行程的演出形式</option><option v-for="(label,key) in FORMS" :key="key" :value="key">{{label}}</option></select><button class="btn-secondary" :disabled="busy||!bulkForm" @click="selected.forEach(r=>{r.form=bulkForm;changeForm(r)})">应用演出形式</button><select v-model="bulkCategory" :disabled="busy" class="input-field"><option value="">批量设置活动类型</option><option v-for="t in ACTIVITY_TYPES" :key="t.id" :value="t.id">{{t.name}}</option></select><button class="btn-secondary" :disabled="busy||!bulkCategory" @click="selected.forEach(r=>{r.category=bulkCategory;r.reviewed=false})">应用活动类型</button></div>
 <div class="monthly-review-layout"><aside v-if="previewUrl"><img :src="previewUrl" alt="核对用原始月行程图" /></aside><div class="space-y-3">
 <article v-for="row in rows" :key="row.id" class="border rounded-lg p-3 space-y-2" :class="{'bg-green-50':row.reviewed}">
 <label><input v-model="row.selected" type="checkbox" :disabled="busy" />导入此条</label><p class="text-sm text-gray-500">原文：{{row.original}}</p>
 <div class="grid sm:grid-cols-2 gap-2" @input="row.reviewed=false" @change="row.reviewed=false">
 <label>日期<input v-model="row.date" type="date" :disabled="busy" class="input-field" /></label><label>时间<input v-model="row.time" :disabled="busy" class="input-field" placeholder="留空＝待公布" /></label>
 <label>活动名称<input v-model="row.title" :disabled="busy" class="input-field" /></label><label>场地<input v-model="row.venue" :disabled="busy" class="input-field" /></label><label>城市<input v-model="row.city" :disabled="busy" class="input-field" placeholder="新增活动需人工补全" /></label>
 <label>活动类型<select v-model="row.category" :disabled="busy" class="input-field"><option v-for="type in ACTIVITY_TYPES" :key="type.id" :value="type.id">{{type.name}}</option></select></label>
 <label>演出形式<select v-model="row.form" :disabled="busy" class="input-field" @change="changeForm(row)"><option v-for="(label,key) in FORMS" :key="key" :value="key">{{label}}</option></select></label>
 <label>处理方式<select v-model="row.action" :disabled="busy" class="input-field"><option value="new">新增活动</option><option v-for="c in monthlyCandidates(row,workspace.events)" :key="c.event.id" :value="c.event.id">关联：{{c.event.title}} · {{c.event.date}} · {{c.event.location||'场地待补'}}</option></select></label>
 </div>
 <label v-if="row.action==='new' && monthlyCandidates(row,workspace.events).length"><input v-model="row.forceNew" type="checkbox" :disabled="busy" @change="row.reviewed=false" />已确认这是另一场独立活动，不关联上述同名活动</label>
 <p v-if="monthlyCandidates(row,workspace.events).length" class="text-amber-700">找到同名同日／日期范围活动，请核对关联。关联仅补充艺人、出席日期和来源，保留已有资料。</p>
 <label class="block">备注<textarea v-model="row.note" :disabled="busy" class="input-field" @input="row.reviewed=false"></textarea></label>
 <label class="font-semibold"><input v-model="row.reviewed" type="checkbox" :disabled="busy" />已核对本条内容及关联活动</label>
 </article>
 </div></div>
 <div class="flex gap-3 items-center"><select v-model="mode" :disabled="busy" class="input-field"><option value="draft">新增活动存为草稿</option><option value="published">新增活动直接发布</option></select><button class="btn-primary whitespace-nowrap" :disabled="busy||!selected.length" @click="submit">{{busy?'正在处理…':'确认导入已勾选行程'}}</button></div><p class="text-sm text-gray-500">关联已有活动时保留其原发布状态；不会新增购票事项，不会因新版图片漏掉某条而自动取消活动。</p>
 </template>
 </div>
</ModalShell>
</template>

<style scoped>
.monthly-dialog{max-width:1200px}.monthly-review-layout{display:grid;gap:16px}.monthly-review-layout aside img{width:100%;height:auto}.monthly-review-layout>div{min-width:0}
@media(min-width:900px){.monthly-review-layout{grid-template-columns:minmax(260px,.8fr) minmax(0,1.2fr)}.monthly-review-layout aside{position:sticky;top:0;align-self:start;max-height:70vh;overflow:auto}}
</style>
