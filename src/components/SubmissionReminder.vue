<script setup>
import {ref,onMounted,onUnmounted} from 'vue';
import {supabase} from '@/config/supabase';
const count=ref(0),visible=ref(false);let timer,closed=false,seen=new Set();
async function load(){try{const {data,error}=await supabase.from('chob_submission_reviews').select('id').eq('status','pending');if(error||closed)return;count.value=data.length;if(data.some(r=>!seen.has(r.id)))visible.value=true;seen=new Set(data.map(r=>r.id));if(!count.value)visible.value=false}catch{}}
onMounted(()=>{load();timer=setInterval(load,60000)});
onUnmounted(()=>{closed=true;clearInterval(timer)});
</script>
<template><router-link class="review-count" to="/submissions">活动投稿审核 <strong v-if="count">{{count}} 待审核</strong></router-link><aside v-if="visible" class="review-toast" role="status"><strong>有 {{count}} 份活动投稿待审核</strong><p>查看海报和资料，审核后回复投稿者。</p><router-link to="/submissions" @click="visible=false">前往审核</router-link><button @click="visible=false" aria-label="关闭投稿提醒">稍后</button></aside></template>
<style scoped>.review-count{display:block;margin-bottom:20px;color:#80512e}.review-count strong{background:#fff0cf;border-radius:12px;padding:4px 10px}.review-toast{position:fixed;right:24px;bottom:24px;z-index:60;max-width:calc(100vw - 48px);padding:22px;background:#fffaf1;border:1px solid #dbc5a6;border-radius:16px;box-shadow:0 8px 30px #0002}.review-toast p{margin:10px 0}.review-toast a{color:#80512e;margin-right:24px}.review-toast button{padding:6px 12px}</style>
