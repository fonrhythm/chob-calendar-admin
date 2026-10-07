<script setup>
import {onMounted,ref} from 'vue';
import {supabase} from '@/config/supabase';
import {rpc,allRows} from '@/lib/api';
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
  <details><summary>节目与音乐内容（独立于活动）</summary><div v-for="c in contents" :key="c.id"><a :href="c.sources?.url" target="_blank" rel="noopener noreferrer">{{c.kind}}</a><pre>{{c.sources?.raw_evidence?.text}}</pre><pre>{{c.translations?.zh}}</pre></div></details>
 </details>
</template>
