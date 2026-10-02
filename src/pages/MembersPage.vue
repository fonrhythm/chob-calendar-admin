<script setup>
import { onMounted, ref } from 'vue';
import { supabase } from '@/config/supabase';
const items=ref([]), total=ref(0), page=ref(1), search=ref(''), loading=ref(false), error=ref('');
async function load(reset=false) {
  if(loading.value) return;
  if(reset) page.value=1;
  loading.value=true; error.value=''; items.value=[];
  try {
    const {data,error:problem}=await supabase.rpc('chob_admin_list_members',{search_text:search.value,page_number:page.value});
    if(problem) throw problem;
    items.value=data.items; total.value=data.total;
  } catch(problem) { error.value=problem.code==='PGRST202' ? '用户管理尚未启用，请联系维护人员完成更新。' : problem.message; total.value=0; }
  finally {loading.value=false;}
}
function turn(delta){page.value+=delta;load();}
onMounted(()=>load());
</script>
<template>
  <section class="space-y-5">
    <header><h1 class="text-2xl font-bold">用户管理</h1><p class="text-gray-500 mt-1">网站普通用户的账号和个人资料。后台访问申请请到“后台成员”处理。</p></header>
    <form class="flex gap-2" @submit.prevent="load(true)"><input v-model="search" class="input-field" aria-label="搜索邮箱或昵称" placeholder="搜索邮箱或昵称" maxlength="100"/><button class="btn-primary" :disabled="loading">搜索</button></form>
    <p v-if="error" role="alert" class="text-red-700">{{ error }}</p>
    <p v-if="loading" role="status">正在读取用户…</p>
    <template v-else>
      <p>共 {{ total }} 位用户</p>
      <article v-for="user in items" :key="user.id" class="bg-white border rounded-xl p-4 space-y-2">
        <h2 class="font-semibold">{{ user.nickname || '未填写昵称' }}</h2><p class="break-all">{{ user.email }}</p>
        <p class="text-sm text-gray-500">{{ user.email_verified ? '邮箱已验证' : '邮箱未验证' }} · {{ user.is_active ? '账号正常' : '账号已停用' }} · 收藏活动 {{ user.event_favorites }} · 收藏艺人 {{ user.artist_favorites }}</p>
        <p v-if="user.bio">{{ user.bio }}</p>
      </article>
      <p v-if="!items.length && !error" class="text-gray-500">没有符合条件的用户。</p>
      <nav aria-label="用户分页" class="flex gap-3 items-center"><button class="btn-secondary" :disabled="page<=1 || loading" @click="turn(-1)">上一页</button><span>第 {{ page }} 页</span><button class="btn-secondary" :disabled="page*50>=total || loading" @click="turn(1)">下一页</button></nav>
    </template>
  </section>
</template>
