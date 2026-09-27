<script setup>
import { onMounted, ref } from 'vue'
import { allRows } from '@/lib/api'
const count = ref(null), error = ref('')
onMounted(async () => { try { const [a,c]=await Promise.all([allRows('artists'),allRows('cp_pairs')]); count.value={artists:a.filter(x=>!x.deleted_at).length,cp:c.filter(x=>!x.deleted_at).length} } catch(e) {error.value=e.message} })
</script>
<template><section class="space-y-6"><div><p class="text-primary-600 font-semibold">第一阶段 · 建立艺人资料库</p><h1 class="text-3xl font-bold mt-2">从少量资料开始</h1><p class="mt-3 text-gray-500">先测试10～20位艺人和几组CP，再导入全部资料。</p></div><p v-if="error" role="alert" class="text-red-700">{{ error }}</p><div v-if="count" class="grid sm:grid-cols-2 gap-4"><div class="bg-white rounded-xl p-6"><p class="text-gray-500">艺人</p><p class="text-4xl font-bold mt-3">{{ count.artists }}</p></div><div class="bg-white rounded-xl p-6"><p class="text-gray-500">CP配对</p><p class="text-4xl font-bold mt-3">{{ count.cp }}</p></div></div><router-link to="/artists" class="btn-primary inline-block px-5 py-3">管理艺人资料 →</router-link><p class="text-sm text-gray-500">这里展示数据库中的实际数量。活动、事项与完整统计将在后续阶段接入。</p></section></template>
