<script setup>
import {onMounted,ref} from 'vue';
import {supabase} from '@/config/supabase';
import {rpc,allRows} from '@/lib/api';
import {prepareBrowserReviews,importBrowserReviews} from '@/lib/browser-review-import.mjs';
const emit=defineEmits(['imported']);
const batch=ref(null),preview=ref([]),importResults=ref([]);
async function readBatch(event){batch.value=null;preview.value=[];importResults.value=[];error.value='';try{const file=event.target.files?.[0];if(!file)return;if(file.size>2000000)throw Error('样本文件不能超过2MB');const value=JSON.parse(await file.text());preview.value=prepareBrowserReviews(value);batch.value=value;}catch(e){error.value=e.message}event.target.value='';}
async function importBatch(){if(!batch.value||busy.value)return;busy.value=true;error.value='';try{importResults.value=await importBrowserReviews(batch.value,{saveSource:payload=>rpc('chob_add_source',{payload}),async hasReview(sourceId){const r=await supabase.from('entity_reviews').select('id,evidence').eq('source_id',sourceId);if(r.error)throw r.error;return r.data.some(x=>x.evidence?.import_mode==='browser-sample');},saveReview:payload=>rpc('chob_add_entity_review',{payload})});emit('imported');await load();}catch(e){error.value=e.message}finally{busy.value=false;}}
const accounts=ref([]),runs=ref([]),contents=ref([]),error=ref(''),busy=ref(false);
const blank=()=>({platform:'x',account:'',url:'',source_type:'unknown',notes:'',enabled:false,reviewed:false,start_at:''});
const form=ref(blank());
async function load(){try{const [a,r,c]=await Promise.all([allRows('source_accounts'),supabase.from('automation_runs').select('*').order('started_at',{ascending:false}).limit(20),supabase.from('source_contents').select('*,sources(url,raw_evidence)').order('created_at',{ascending:false}).limit(20)]);if(r.error||c.error)throw r.error||c.error;accounts.value=a;runs.value=r.data;contents.value=c.data}catch(e){error.value=e.message}}
async function save(){busy.value=true;error.value='';try{if(!form.value.start_at)throw Error('请选择首次扫描开始时间');const payload={...form.value,start_at:new Date(form.value.start_at).toISOString()};await rpc('chob_save_source_account',{payload});form.value=blank();await load()}catch(e){error.value=e.message}finally{busy.value=false}}
function edit(a){form.value={...a,start_at:new Date(new Date(a.start_at).getTime()-new Date(a.start_at).getTimezoneOffset()*60000).toISOString().slice(0,16)}}
onMounted(load);
</script>
<template>
 <details><summary>自动化来源与扫描记录</summary>
  <p v-if="error" role="alert">{{error}}</p>
  <p>账号身份需人工核验；启用账号仍需配置运行器与真实 provider。扫描开始时间按本机时区输入。修改账号不重置游标。</p>
  <div v-for="a in accounts" :key="a.id"><button type="button" @click="edit(a)">{{a.platform}} · {{a.account}} · {{a.enabled?'启用':'停用'}} · {{a.reviewed?'身份已核验':'待核验'}}</button><p>{{a.notes}}</p></div>
  <label>平台<select v-model="form.platform" :disabled="!!form.id"><option v-for="p in ['x','facebook','instagram','ticketmelon','website']" :key="p">{{p}}</option></select></label>
  <label>账号<input v-model="form.account" :disabled="!!form.id"/></label><label>链接<input v-model="form.url" type="url"/></label>
  <label>来源角色<select v-model="form.source_type"><option v-for="t in ['organizer','brand','event_official','company_official','artist_official','official_fc','ticketing','media','fan','unknown']" :key="t">{{t}}</option></select></label>
  <label>备注<textarea v-model="form.notes"/></label><label>首次扫描开始时间<input v-model="form.start_at" type="datetime-local" :disabled="!!form.id"/></label>
  <label><input type="checkbox" v-model="form.reviewed"/>已人工核验身份</label><label><input type="checkbox" v-model="form.enabled"/>启用</label>
  <button type="button" :disabled="busy" @click="save">保存来源账号</button><button type="button" @click="form=blank()">新建</button>
  <p v-for="r in runs" :key="r.id">{{accounts.find(a=>a.id===r.account_id)?.account}} · {{r.started_at}} → {{r.finished_at||'运行中'}} · {{r.status}} · {{r.counts}} {{r.error}}</p>
  <details><summary>浏览器采集证据导入（待审核）</summary>
   <p>选择已核验的浏览器样本文件，先预览，再保存来源与待审核记录。导入不会启用账号、推进扫描游标或发布活动；重复导入同一来源快照会跳过已有审核。正文摘录会保留摘录标记。</p>
   <label>浏览器样本 JSON<input type="file" accept=".json,application/json" :disabled="busy" @change="readBatch"/></label>
   <div v-for="r in preview" :key="r.source.url"><a :href="r.source.url" target="_blank" rel="noopener noreferrer">{{r.source.account}} · {{r.source.published_at}}</a><details><summary>查看原始正文</summary><p>{{r.source.raw_evidence.capture}}</p><pre>{{r.source.raw_evidence.text}}</pre></details><details v-for="image in r.source.raw_evidence.image_transcriptions" :key="image.url"><summary>图片转录</summary><a :href="image.url" target="_blank" rel="noopener noreferrer">原图</a><pre>{{image.text}}</pre></details><p v-for="(note,i) in r.review.evidence.observations" :key="i">{{note}}</p></div>
   <button type="button" :disabled="busy||!batch" @click="importBatch">保存来源并加入待审核</button>
   <p v-for="r in importResults" :key="r.url">{{r.url}} · {{r.action==='review'?'已加入待审核':r.action==='duplicate'?'已有审核，跳过':'保存失败，可重试'}} {{r.error}}</p>
  </details>
  <details><summary>节目与音乐内容（独立于活动）</summary><div v-for="c in contents" :key="c.id"><a :href="c.sources?.url" target="_blank" rel="noopener noreferrer">{{c.kind}}</a><pre>{{c.sources?.raw_evidence?.text}}</pre><pre>{{c.translations?.zh}}</pre></div></details>
 </details>
</template>
