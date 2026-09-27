<template>
  <div id="app">
    <div v-if="configurationError" class="p-8 max-w-xl mx-auto"><h1 class="text-xl font-bold mb-4">后台配置未完成</h1><p>{{ configurationError }}</p></div>
    <router-view v-else />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { configurationError } from '@/config/supabase'

const authStore = useAuthStore()

// 初始化认证监听
onMounted(() => {
  if (configurationError) return
  authStore.setupAuthListener()
  authStore.checkAuth()
})
</script>

<style scoped>
#app {
  min-height: 100vh;
}
</style>
