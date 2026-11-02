<script setup>
import {ref,onMounted} from 'vue';
import {supabase} from '@/config/supabase';
import {ACTIVITY_TYPES} from '@/lib/activity-types';
import {artistTypeLabels} from '@/lib/artistFilters';
import {csvText,percent} from '@/lib/analytics';
const now=new Date(),filters=ref({start:now.getFullYear()+'-01-01',end:now.getFullYear()+'-12-31',kind:'personal',genre:'',category:'',region:'',city:'',status:'effective'});
const data=ref(null),busy=ref(false),error=ref(''),tab=ref('rankings'),subject=ref(null),page=ref(0),applied=ref(null),exporting=ref(false);
let request=0;
const label=id=>ACTIVITY_TYPES.find(x=>x.id===id)?.name||id;
async function query(reset=true){if(reset){if(filters.value.kind==='cp')filters.value.genre='';page.value=0;subject.value=null;applied.value={...filters.value};}const token=++request;busy.value=true;error.value='';try{const {data:result,error:e}=await supabase.rpc('chob_analytics',{filters:applied.value,subject:subject.value,page_number:page.value});if(e)throw e;if(token===request)data.value=result;}catch(e){if(token===request){error.value=e.message;data.value=null;}}finally{if(token===request)busy.value=false;}}
async function detail(row){subject.value=row.id;page.value=0;tab.value='details';await query(false);}
async function turn(delta){page.value+=delta;await query(false);}
async function changeTab(value){tab.value=value;subject.value=null;page.value=0;await query(false);}
async function download(){exporting.value=true;error.value='';try{const rows=[['排名','名称','活动次数','活动占比','比较活动总数']];for(let p=0;;p++){const {data:d,error:e}=await supabase.rpc('chob_analytics',{filters:applied.value,page_number:p});if(e)throw e;for(const r of d.rankings)rows.push([r.position,r.name,r.n,percent(r.n,d.total),d.total]);if(d.rankings.length<100)break;}const url=URL.createObjectURL(new Blob([csvText(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='chob-rankings.csv';a.click();URL.revokeObjectURL(url);}catch(e){error.value=e.message;}finally{exporting.value=false;}}
onMounted(()=>query());
</script>
<template><section class="space-y-6"><header><h1 class="text-2xl font-bold">数据统计与分析</h1><p class="text-gray-500 mt-2">本数据基于 Chob Calendar 已收录活动，不代表行业全部活动。</p></header>
<form @submit.prevent="query()" class="bg-white rounded-xl p-5 grid sm:grid-cols-3 gap-4">
<label>开始日期<input class="input" type="date" v-model="filters.start" /></label><label>结束日期<input class="input" type="date" v-model="filters.end" /></label>
<label>主体<select class="input" v-model="filters.kind"><option value="personal">个人身份</option><option value="cp">CP身份</option><option value="group">团体 / 乐队</option></select></label>
<label>艺人类别<select class="input" v-model="filters.genre" :disabled="filters.kind==='cp'"><option value="">全部类别</option><option v-for="(v,k) in artistTypeLabels" :key="k" :value="k">{{v}}</option></select><small v-if="filters.kind==='cp'">CP暂按整体统计，请选择全部类别。</small></label>
<label>活动类别<select class="input" v-model="filters.category"><option value="">全部活动</option><option v-for="v in data?.options.categories||[]" :key="v" :value="v">{{label(v)}}</option></select></label>
<label>地区<select class="input" v-model="filters.region"><option value="">全部地区</option><option v-for="v in ['泰国','中国','海外','待确认']" :key="v">{{v}}</option></select></label>
<label>城市<select class="input" v-model="filters.city"><option value="">全部城市</option><option v-for="v in data?.options.cities||[]" :key="v">{{v}}</option></select></label>
<label>活动范围<select class="input" v-model="filters.status"><option value="effective">有效且已发布</option><option value="all">全部发布及业务状态</option></select></label><button class="btn-primary rounded-lg" :disabled="busy">{{busy?'查询中…':'应用筛选'}}</button></form>
<p v-if="error" role="alert" class="text-red-700">{{error}} <button @click="query(false)">重试</button></p>
<template v-if="data"><div class="grid sm:grid-cols-4 gap-4"><div class="card"><span>筛选内独立活动</span><b>{{data.total}}</b></div><div class="card"><span>有活动的主体</span><b>{{data.participating}}</b></div><div class="card"><span>活跃主体 · 前50%含并列</span><b>{{data.active}}</b></div><div class="card"><span>主体覆盖率</span><b>{{percent(data.covered,data.catalog_total)}}</b><small>{{data.covered}} / {{data.catalog_total}} 个有效资料</small></div></div>
<p class="text-sm text-gray-500">只统计明确选择的身份，团体和CP活动不分摊给个人。活动占比分母为当前筛选的 {{data.total}} 场独立活动，多人活动的占比之和可能超过100%。当前年度尚未结束，包含未来已收录活动。</p>
<nav class="flex flex-wrap gap-3"><button v-for="[k,v] in [['rankings','排行榜'],['categories','类别分析'],['months','月度趋势'],['details','活动明细'],['quality','数据质量']]" :key="k" :class="tab===k?'btn-primary':'btn-secondary'" class="px-4 py-2 rounded-lg" @click="changeTab(k)">{{v}}</button><button @click="download" :disabled="exporting||busy" class="btn-secondary px-4 py-2">{{exporting?'导出中…':'导出全部排行 CSV'}}</button></nav>
<p v-if="busy" role="status">正在查询…</p>
<div v-else class="bg-white rounded-xl p-5 overflow-x-auto">
<table v-if="tab==='rankings'" class="w-full text-left"><thead><tr><th>排名</th><th>主体</th><th>活动次数</th><th>活动占比</th></tr></thead><tbody><tr v-for="r in data.rankings" :key="r.id"><td>{{r.position}}</td><td>{{r.name}}{{r.archived?'（历史资料）':''}}</td><td><button class="text-primary-600 underline" @click="detail(r)">{{r.n}} · 查看活动</button></td><td>{{percent(r.n,data.total)}}</td></tr></tbody></table>
<template v-else-if="tab==='categories'||tab==='months'"><div v-for="r in (tab==='categories'?data.categories:data.months)" :key="r.category||r.month_key" class="py-3"><div class="flex justify-between"><span>{{r.month_key||label(r.category)}}</span><span>{{r.n}} 场</span></div><meter :value="r.n" :max="Math.max(data.total,1)" class="w-full" /></div></template>
<template v-else-if="tab==='details'"><p class="mb-3">{{subject?'所选主体':'筛选范围'}}对应 {{data.detail_total}} 场活动</p><table class="w-full text-left"><tbody><tr v-for="r in data.details" :key="r.id"><td>{{r.date||'日期待定'}}</td><td>{{r.title}}</td><td>{{label(r.category)}}</td><td>{{r.city}}</td></tr></tbody></table></template>
<template v-else><p class="mb-3">全库数据质量：{{data.quality_total}} 条需要核对（不受上方筛选影响）</p><table class="w-full text-left"><tbody><tr v-for="r in data.quality" :key="r.id"><td>{{r.date||'日期待定'}}</td><td>{{r.title}}<small class="block text-gray-400">{{r.id}}</small></td><td class="text-amber-700">{{r.issue}}</td></tr></tbody></table></template>
<p v-if="(tab==='rankings'&&!data.rankings.length)||(tab==='details'&&!data.details.length)" class="py-8 text-gray-500">此范围没有可统计的活动。</p>
<div v-if="['rankings','details','quality'].includes(tab)" class="flex gap-4 mt-5"><button :disabled="page===0" @click="turn(-1)">上一页</button><span>第 {{page+1}} 页 · 每页100条</span><button :disabled="(page+1)*100>=(tab==='rankings'?data.participating:tab==='details'?data.detail_total:data.quality_total)" @click="turn(1)">下一页</button></div>
</div></template></section></template>
<style scoped>.input{display:block;width:100%;border:1px solid #d1d5db;border-radius:8px;padding:9px;margin-top:6px;background:white}label{font-size:14px}.card{background:white;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:8px}.card span,small{color:#6b7280}.card b{font-size:28px}th,td{padding:14px 10px;border-bottom:1px solid #eee}button:disabled{opacity:.45}meter{height:14px}</style>
