<script setup>
import { onMounted, ref } from 'vue';
import SourceAutomation from './SourceAutomation.vue';
import { supabase } from '@/config/supabase';
import { rpc, allRows } from '@/lib/api';
const props=defineProps({form:Object, provenance:Object});
const sources=ref([]),history=ref([]),venues=ref([]),companies=ref([]),events=ref([]),reviews=ref([]),error=ref(''),busy=ref(false);
const source=ref({url:'',platform:'',account:'',source_type:'unknown',priority:5,raw_evidence:{}}),evidence=ref(''),entityName=ref(''),entityKind=ref('venue'),company=ref(''),role=ref('organizer');
const note=ref(''),artist=ref(''),artistCompanyRole=ref('agency'),relations=ref([]),artistRelations=ref([]);
props.form.attributes.field_states ||= {};
async function load(){try{
 const [s,v,c,e]=await Promise.all(['sources','venues','companies','events'].map(allRows));sources.value=s;venues.value=v;companies.value=c;events.value=e.filter(x=>x.id!==props.form.id&&!x.attributes?.admin_deleted_at);
 const [h,r,links,cr,ar]=await Promise.all([supabase.from('event_changes').select('*').eq('event_id',props.form.id).order('changed_at',{ascending:false}).limit(100),supabase.from('entity_reviews').select('*').eq('status','pending').order('created_at').limit(100),supabase.from('event_sources').select('*').eq('event_id',props.form.id),supabase.from('event_companies').select('*').eq('event_id',props.form.id),supabase.from('artist_companies').select('*').in('artist_id',props.form.artist_ids||[])]);
 for(const response of [h,r,links,cr,ar])if(response.error)throw response.error;
 relations.value=cr.data;artistRelations.value=ar.data;
 history.value=h.data;reviews.value=r.data;const primary=links.data.find(x=>x.is_primary)||links.data[0];if(primary&&!props.provenance.source_id)props.provenance.source_id=primary.source_id;
 }catch(e){error.value=e.message}}
onMounted(load);
async function addSource(){busy.value=true;error.value='';try{if(!evidence.value.trim())throw Error('请粘贴原始公告文字或证据');const id=await rpc('chob_add_source',{payload:{...source.value,raw_evidence:{text:evidence.value}}});props.provenance.source_id=id;await load();evidence.value='';source.value.url=''}catch(e){error.value=e.message}finally{busy.value=false}}
async function verify(){try{await rpc('chob_verify_source',{target:props.provenance.source_id,verification:'verified'});await load()}catch(e){error.value=e.message}}
async function addEntity(){try{const id=await rpc('chob_add_entity',{kind:entityKind.value,payload:{name:entityName.value,source_id:props.provenance.source_id||null}});if(entityKind.value==='venue')props.form.attributes.venue_id=id;else company.value=id;await load();entityName.value=''}catch(e){error.value=e.message}}
function linkCompany(){if(!company.value)return;props.provenance.companies ||= [];if(!props.provenance.companies.some(x=>x.company_id===company.value&&x.role===role.value))props.provenance.companies.push({company_id:company.value,role:role.value})}
async function linkArtist(){try{await rpc('chob_link_artist_company',{artist:artist.value,company:company.value,company_role:artistCompanyRole.value,source:props.provenance.source_id||null});await load()}catch(e){error.value=e.message}}
async function resolve(id,decision){try{await rpc('chob_resolve_entity_review',{target:id,decision,note:note.value});await load();note.value=''}catch(e){error.value=e.message}}
function prepareReview(r,merge=false){
 if(r.event_id&&r.event_id!==props.form.id){error.value='请先打开关联活动，再审核该来源';return;}
 if(!note.value.trim()){error.value='请填写审核结论，再选择编辑或合并';return;}
 props.provenance.review_id=r.id;props.provenance.review_note=note.value;props.provenance.source_id=r.source_id;
 if(!merge){const f=r.evidence?.facts||{};for(const k of ['title','date','location'])if(f[k])props.form[k]=f[k];if(f.city)props.form.location_region=f.city;}
 error.value='已选择该审核。请在现有表单核对艺人、时间、图片、分类和事项后保存；审核与保存将一起提交。';
}
const labels={date:'日期',time:'时间',location:'场地',artist_ids:'艺人',ticket_url:'票务'};
</script>
<template>
 <details class="provenance"><summary>来源、变更与实体关系</summary><SourceAutomation />
  <p v-if="error" role="alert">{{error}}</p>
  <label>本次变更来源<select v-model="provenance.source_id"><option value="">未关联（人工编辑）</option><option v-for="s in sources" :key="s.id" :value="s.id">{{s.account||s.platform}} · {{s.url}} · {{s.verification}}</option></select></label>
  <label>来源角色<select v-model="provenance.role"><option v-for="r in ['announcement','update','ticketing','correction','evidence']" :key="r">{{r}}</option></select></label>
  <label><input type="checkbox" v-model="provenance.is_primary"/>设为主要来源</label>
  <button type="button" :disabled="!provenance.source_id" @click="verify">确认已核验来源</button>
  <details><summary>保存新来源快照</summary>
   <label>原始公告 URL<input v-model="source.url" type="url"/></label>
   <label>平台<input v-model="source.platform"/></label><label>账号<input v-model="source.account"/></label>
   <label>来源类型<select v-model="source.source_type"><option v-for="t in ['unknown','organizer','brand','event_official','company_official','artist_official','official_fc','ticketing','media','fan']" :key="t">{{t}}</option></select></label>
   <label>优先级（人工确认）<select v-model.number="source.priority"><option :value="1">官方主办／品牌／活动方</option><option :value="2">公司／艺人官方</option><option :value="3">官方 FC</option><option :value="4">可靠票务／媒体</option><option :value="5">普通粉丝／未知</option></select></label>
   <label>发布时间<input v-model="source.published_at" type="datetime-local"/></label>
   <label>原始证据<textarea v-model="evidence" rows="4"/></label><button type="button" :disabled="busy" @click="addSource">保存来源</button>
  </details>
  <label v-for="(label,field) in labels" :key="field">{{label}}信息状态<select v-model="form.attributes.field_states[field]"><option value="">沿用已有数据</option><option value="known">已知</option><option value="tba">官方尚未公布（需来源）</option><option value="missing">Chob 缺数据</option></select></label>
  <label>标准场地<select v-model="form.attributes.venue_id"><option value="">沿用旧场地文字</option><option v-for="v in venues" :key="v.id" :value="v.id">{{v.name}} · {{v.city}}</option></select></label>
  <label>上级活动<select v-model="form.attributes.parent_event_id"><option value="">无</option><option v-for="e in events" :key="e.id" :value="e.id">{{e.title}} · {{e.date}}</option></select></label>
  <label>公司<select v-model="company"><option value="">选择公司</option><option v-for="c in companies" :key="c.id" :value="c.id">{{c.name}}</option></select></label>
  <label>公司角色<select v-model="role"><option v-for="r in ['organizer','promoter','brand','agency','label','sponsor','ticketing']" :key="r">{{r}}</option></select></label>
  <button type="button" @click="linkCompany">添加关系（随活动保存）</button><p v-for="c in provenance.companies||[]" :key="c.company_id+c.role">{{companies.find(x=>x.id===c.company_id)?.name}} · {{c.role}}</p>
  <p v-for="c in relations" :key="c.company_id+c.role">{{companies.find(x=>x.id===c.company_id)?.name}} · {{c.role}}（已保存）</p>
  <details><summary>艺人与公司关系</summary><label>已选艺人<select v-model="artist"><option value="">选择艺人 ID</option><option v-for="id in form.artist_ids" :key="id">{{id}}</option></select></label><label>角色<select v-model="artistCompanyRole"><option value="agency">agency</option><option value="label">label</option><option value="management">management</option></select></label><button type="button" :disabled="!artist||!company" @click="linkArtist">保存艺人公司关系</button><p v-for="r in artistRelations" :key="r.artist_id+r.company_id+r.role">{{r.artist_id}} · {{companies.find(c=>c.id===r.company_id)?.name}} · {{r.role}}</p></details>
  <details><summary>新增标准实体（人工确认）</summary><label>类型<select v-model="entityKind"><option value="venue">场地</option><option value="company">公司</option></select></label><label>名称<input v-model="entityName"/></label><button type="button" @click="addEntity">新增</button></details>
  <details><summary>变更历史（最近100项）</summary><p v-for="h in history" :key="h.id">{{h.changed_at}} · {{labels[h.field]||h.field}}：{{JSON.stringify(h.old_value)}} → {{JSON.stringify(h.new_value)}} <a v-if="sources.find(x=>x.id===h.source_id)" :href="sources.find(x=>x.id===h.source_id).url" target="_blank" rel="noopener noreferrer">来源</a></p></details>
  <details><summary>异常审核（待处理）</summary><label>审核结论<textarea v-model="note"/></label><div v-for="r in reviews" :key="r.id"><p>{{r.entity_type}} · {{r.reason}}</p><pre>{{JSON.stringify(r.candidates)}}</pre><p><a v-if="sources.find(s=>s.id===r.source_id)" :href="sources.find(s=>s.id===r.source_id).url" target="_blank" rel="noopener noreferrer">原始来源</a></p><pre>{{r.evidence?.raw?.text||sources.find(s=>s.id===r.source_id)?.raw_evidence?.text}}</pre><pre>{{r.evidence?.translations?.zh}}</pre><pre>{{JSON.stringify(r.evidence?.extraction||r.evidence,null,2)}}</pre><button type="button" @click="prepareReview(r)">编辑后批准（随表单保存）</button><button type="button" @click="prepareReview(r,true)">合并来源到当前活动（随表单保存）</button><button type="button" @click="resolve(r.id,'resolved')">已人工处理</button><button type="button" @click="resolve(r.id,'rejected')">拒绝</button></div></details>
 </details>
</template>
<style scoped>
.provenance{margin:12px 0}summary{cursor:pointer}label{display:block;margin:10px 0}select,input:not([type=checkbox]),textarea{display:block;width:100%;border:1px solid #d1d5db;border-radius:6px;padding:8px;font:inherit;background:inherit;color:inherit}p,pre{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}button{margin:4px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px}details details{margin:12px 0}
</style>
