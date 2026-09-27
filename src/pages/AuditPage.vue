<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from '@/config/supabase'
const records=ref([]), error=ref(''), loading=ref(true)
const labels={create:'新增',update:'修改',delete:'删除',restore:'恢复'}
onMounted(async()=>{try {const {data,error:problem}=await supabase.from('operation_logs').select('*').order('created_at',{ascending:false}).limit(200);if(problem)throw problem;records.value=data}catch(e){error.value=e.message}finally{loading.value=false}})
</script>
<template><section class="space-y-4"><h1 class="text-2xl font-bold">操作记录</h1><p class="text-gray-500">最近200条记录。删除的艺人或CP可在资料库的回收站恢复。</p><p v-if="error" role="alert" class="text-red-700">{{ error }}</p><p v-if="loading">正在读取…</p><details v-for="r in records" :key="r.id" class="bg-white p-4 rounded-xl"><summary class="cursor-pointer">{{ labels[r.action] || r.action }} · {{ r.new_value?.name || r.new_value?.cp_name }} · {{ new Date(r.created_at).toLocaleString() }}</summary><p class="text-sm mt-3 break-all">操作者：{{ r.user_id }}</p><div class="grid md:grid-cols-2 gap-3 mt-3"><div><h2>修改前</h2><pre class="whitespace-pre-wrap break-all bg-gray-50 p-3 text-xs">{{ JSON.stringify(r.old_value,null,2) }}</pre></div><div><h2>修改后</h2><pre class="whitespace-pre-wrap break-all bg-gray-50 p-3 text-xs">{{ JSON.stringify(r.new_value,null,2) }}</pre></div></div></details><p v-if="!loading && !error && !records.length">暂无操作记录。</p></section></template>
