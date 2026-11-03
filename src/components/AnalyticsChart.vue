<script setup>
import {computed,ref} from 'vue';
import {ACTIVITY_TYPES} from '@/lib/activity-types';
import {percent} from '@/lib/analytics';
const props=defineProps({mode:String,rows:{type:Array,default:()=>[]},total:{type:Number,default:0},start:String,end:String});
const focus=ref(null);
const colors=['#6F8FBD','#C96D8A','#9A4650','#B97A3E','#7A5446','#4F6491','#BDA168','#8F9E8D','#B3A59B'];
const months=computed(()=>{
 const map=new Map(props.rows.map(r=>[r.month_key,Number(r.n)]));
 const keys=[...map.keys()].sort();
 const start=props.start?.slice(0,7)||keys[0],end=props.end?.slice(0,7)||keys.at(-1);
 if(!start||!end)return [];
 const list=[];let [y,m]=start.split('-').map(Number);
 for(let i=0;i<1200;i++) {const key=y+'-'+String(m).padStart(2,'0');if(key>end)break;list.push({key,n:map.get(key)||0});if(++m>12){m=1;y++;}}
 return list;
});
const peak=computed(()=>months.value.reduce((a,b)=>b.n>a.n?b:a,{n:0,key:''}));
const max=computed(()=>Math.max(...months.value.map(r=>r.n),1));
const ceiling=computed(()=>{const step=10**Math.floor(Math.log10(max.value));return Math.ceil(max.value/step)*step;});
const step=computed(()=>Math.max(56,740/Math.max(months.value.length,1)));
const width=computed(()=>Math.max(820,months.value.length*step.value+64));
const categoryMax=computed(()=>Math.max(...props.rows.map(r=>Number(r.n)),1));
const categoryLabel=id=>ACTIVITY_TYPES.find(t=>t.id===id)?.name||id;
const currentMonth=new Date().toISOString().slice(0,7);
</script>
<template>
<section v-if="mode==='months'" aria-label="月度活动柱状图">
 <div class="chart-heading"><div><p class="eyebrow">MONTHLY ACTIVITY</p><h2>月度活动分布</h2><p class="caption">柱高表示已收录活动数 · 空白月份表示当前没有收录</p></div><div v-if="peak.n" class="peak"><span>收录最多</span><strong>{{peak.key}} <i>·</i> {{peak.n}}<small> 场</small></strong></div></div>
 <p v-if="!rows.length" class="empty">此范围暂无可展示的活动。</p>
 <template v-else><div class="legend"><span><i class="dot past"/>已过月份</span><span><i class="dot future"/>本月及未来已收录</span></div>
 <div class="chart-scroll"><svg :viewBox="'0 0 '+width+' 300'" :style="{minWidth:width+'px'}" role="img" aria-label="各月已收录活动数量，数值标注在柱顶">
 <g v-for="tick in [0,1,2,3,4]" :key="tick"><line x1="45" :x2="width-12" :y1="246-tick*52" :y2="246-tick*52" stroke="#E9EDF2" :stroke-dasharray="tick?'3 5':undefined"/><text x="34" :y="250-tick*52" text-anchor="end" class="axis">{{Math.round(ceiling*tick/4)}}</text></g>
 <g v-for="(r,i) in months" :key="r.key" class="month-column" tabindex="0" :aria-label="r.key+'：'+r.n+'场已收录活动'" @mouseenter="focus=r.key" @mouseleave="focus=null" @focus="focus=r.key" @blur="focus=null">
 <title>{{r.key}} · {{r.n}} 场已收录活动</title>
 <rect :x="49+i*step" y="20" :width="step-4" height="228" rx="8" :fill="focus===r.key?'#F2F5F9':'transparent'"/>
 <rect :x="49+i*step+(step-4)*.22" :y="246-r.n/ceiling*198" :width="(step-4)*.56" :height="r.n?Math.max(2,r.n/ceiling*198):2" rx="5" :fill="r.n?(r.key>=currentMonth?'#A6B7D0':'#4F6491'):'#DDE3EC'" :opacity="focus&&focus!==r.key?.65:1"/>
 <text v-if="r.n" :x="49+i*step+(step-4)/2" :y="236-r.n/ceiling*198" text-anchor="middle" class="bar-value">{{r.n}}</text>
 <text :x="49+i*step+(step-4)/2" y="273" text-anchor="middle" class="axis">{{r.key.slice(5)}}月</text>
 <text v-if="i===0||r.key.endsWith('-01')" :x="49+i*step+(step-4)/2" y="291" text-anchor="middle" class="year">{{r.key.slice(0,4)}}</text>
 </g></svg></div></template>
</section>
<section v-else aria-label="活动类别条形图"><div class="chart-heading"><div><p class="eyebrow">ACTIVITY MIX</p><h2>活动类别分布</h2><p class="caption">对比各类别数量 · 占比以当前筛选的 {{total}} 场活动为分母</p></div></div>
 <p v-if="!rows.length" class="empty">此范围暂无可展示的活动。</p>
 <div v-for="(r,i) in rows" :key="r.category" class="category-row"><div class="category-title"><span><i class="dot" :style="{background:colors[i%colors.length]}"/>{{categoryLabel(r.category)}}</span><span><strong>{{r.n}}</strong> 场 <small>{{percent(r.n,total)}}</small></span></div><div class="bar-track" role="img" :aria-label="categoryLabel(r.category)+'：'+r.n+'场，占'+percent(r.n,total)"><div class="category-bar" :style="{width:(r.n/categoryMax*100)+'%',background:colors[i%colors.length]}"/></div></div>
</section>
</template>
<style scoped>
.chart-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:24px}.eyebrow{font-size:10px;font-weight:600;letter-spacing:2px;color:#7c8ba3;margin:0 0 7px}h2{font-size:20px;font-weight:650;color:#253247;margin:0}.caption{font-size:12px;color:#8590a1;margin-top:8px;line-height:1.6}.peak{border-left:2px solid #dfe6ef;padding-left:16px;flex-shrink:0}.peak>span{display:block;font-size:11px;color:#8590a1;margin-bottom:6px}.peak strong{font-size:17px;color:#4f6491}.peak i{font-style:normal;color:#c3ccd9;padding:0 6px}.peak small{font-size:11px;font-weight:400}.legend{display:flex;gap:20px;font-size:11px;color:#7d8796;margin-bottom:8px}.legend span,.category-title>span:first-child{display:flex;align-items:center;gap:8px}.dot{display:inline-block;width:8px;height:8px;border-radius:3px;flex-shrink:0}.past{background:#4f6491}.future{background:#a6b7d0}.chart-scroll{overflow-x:auto;padding-bottom:4px}svg{display:block;width:100%;height:auto;max-height:380px;font-family:inherit}.axis{font-size:11px;fill:#8c96a4}.year{font-size:10px;fill:#a3adbb}.bar-value{font-size:12px;font-weight:600;fill:#455a7a}.month-column{outline:none}.month-column:focus-visible>rect:first-of-type{stroke:#6f8fbd;stroke-width:1.5}.category-row{padding:13px 0}.category-title{display:flex;justify-content:space-between;gap:14px;font-size:13px;color:#4c5869;margin-bottom:10px}.category-title strong{font-size:16px;font-variant-numeric:tabular-nums;color:#29374c}.category-title small{display:inline-block;min-width:56px;text-align:right;margin-left:8px;color:#8a95a4}.bar-track{height:10px;background:#f0f3f7;border-radius:5px;overflow:hidden}.category-bar{height:100%;border-radius:5px}.empty{padding:48px 0;color:#8590a1;text-align:center;font-size:14px}@media(max-width:600px){.chart-heading{flex-direction:column;gap:14px}.peak{display:flex;align-items:center;gap:12px}.peak>span{margin:0}.legend{gap:14px;font-size:10px}.chart-scroll svg{max-height:none}.category-title{font-size:12px}}
</style>
