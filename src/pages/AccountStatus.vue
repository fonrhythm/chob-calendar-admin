<script setup>
import { useAuthStore } from '@/stores/authStore'
import { useRouter } from 'vue-router'
const auth = useAuthStore(), router = useRouter()
async function retry() { await auth.checkAuth(); if (auth.ready) router.replace('/') }
async function exit() { if ((await auth.logout()).success) router.replace('/login') }
</script>
<template><main class="max-w-lg mx-auto p-8 space-y-5">
<h1 class="text-2xl font-bold">后台访问审核</h1>
<p role="alert">{{ auth.error || '正在读取账号资料。' }}</p>
<p class="text-gray-500">邮箱验证完成后仍需管理员审核。获批前不能进入后台；审核完成后可点击重新检查。</p>
<button class="btn-primary px-5 py-2" @click="retry">重新检查</button>
<button class="btn-secondary px-5 py-2 ml-3" @click="exit">退出登录</button>
</main></template>
