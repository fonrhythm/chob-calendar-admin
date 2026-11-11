<script setup>
import {onMounted,ref,onErrorCaptured} from 'vue';
import {allRows} from '@/lib/api';
import {supabase} from '@/config/supabase';
import {createDramaRepository} from '@/drama/repository';
const repository=createDramaRepository(supabase);
import Manager from '@/drama/DramaManager.vue';
const artists=ref([]),error=ref(''),pageError=ref(''),pageKey=ref(0);
onErrorCaptured(error=>{pageError.value=error.message||'页面加载失败';return false;});
function retry(){pageError.value='';pageKey.value++;}
onMounted(async()=>{try{artists.value=await allRows('artists');}catch(e){error.value=e.message;}});
</script>
<template><p v-if="error" role="alert">公司资料加载失败：{{error}}</p><section v-if="pageError" role="alert"><h2>剧集管理暂时无法显示</h2><p>{{pageError}}</p><p>已保存的资料不受影响，请重试；如仍失败，请保留此错误信息。</p><button @click="retry">重新加载剧集管理</button></section><Manager v-else :key="pageKey" :schedule-artists="artists" :repository="repository" /></template>
