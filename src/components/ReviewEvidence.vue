<script setup>
import {computed} from 'vue';
const props=defineProps({review:Object,source:Object,events:Array});
const evidence=computed(()=>props.review?.evidence||{});
const raw=computed(()=>evidence.value.raw||props.source?.raw_evidence||{});
const labels={title:'活动名称',date:'活动日期',time:'活动时间',location:'地点',city:'城市',region:'地区',artist_names:'艺人',category:'活动类型',participation_condition:'参与条件',scope:'开放范围',sale_date:'开售日期',sale_time:'开售时间',ticket_url:'票务链接'};
const rows=computed(()=>Object.entries(evidence.value.facts||evidence.value.extraction?.facts||{}).filter(([key])=>labels[key]).map(([key,fact])=>({label:labels[key],value:typeof fact==='object'&&!Array.isArray(fact)?fact.state==='tba'?'官方待公布':fact.state==='missing'?'尚缺资料':fact.value:fact})).filter(r=>r.value!=null));
const title=computed(()=>rows.value.find(r=>r.label==='活动名称')?.value||`${props.source?.account||'来源'} · 待核验公告`);
const candidates=computed(()=>(props.review?.candidates||[]).map(id=>props.events?.find(e=>e.id===id)).filter(Boolean));
</script>
<template>
 <article>
  <h3>{{title}}</h3>
  <p>{{source?.account||'账号待核验'}} · {{source?.published_at?new Date(source.published_at).toLocaleString('zh-CN'):'发布时间未记录'}} · 待审核</p>
  <p><a v-if="source?.url" :href="source.url" target="_blank" rel="noopener noreferrer">打开原帖核验 ↗</a></p>
  <table v-if="rows.length"><tbody><tr v-for="r in rows" :key="r.label"><th scope="row">{{r.label}}</th><td>{{Array.isArray(r.value)?r.value.join(' / '):r.value}}</td></tr></tbody></table>
  <p v-else>尚无通过证据校验的活动字段，请先核对下面的采集备注。</p>
  <h4>待核验事项</h4>
  <ul><li>{{review.reason}}</li><li v-for="(note,index) in evidence.observations||[]" :key="index">{{note}}</li></ul>
  <p v-if="raw.image_transcriptions?.length>1">本帖包含 {{raw.image_transcriptions.length}} 张已转录图片，请核对是否属于不同活动；批准当前表单只保存一个活动。</p>
  <div v-if="candidates.length"><h4>可能关联的已有活动</h4><ul><li v-for="e in candidates" :key="e.id">{{e.title}} · {{e.date}} · {{e.location}}</li></ul></div>
  <details><summary>查看原始证据</summary><p>{{raw.capture||'原始正文'}}</p><pre>{{raw.text}}</pre><pre v-if="evidence.translations?.zh">{{evidence.translations.zh}}</pre><details v-for="image in raw.image_transcriptions||[]" :key="image.url"><summary>图片转录（{{image.url.split('/').at(-1)}}）</summary><a :href="image.url" target="_blank" rel="noopener noreferrer">打开原图 ↗</a><p>{{image.capture}}</p><pre>{{image.text}}</pre></details></details>
  <details><summary>技术数据（排查问题时查看）</summary><pre>{{JSON.stringify(evidence.extraction||{},null,2)}}</pre></details>
 </article>
</template>
