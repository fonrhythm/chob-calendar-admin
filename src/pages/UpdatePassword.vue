<script setup>
import { ref } from 'vue'
import { supabase, recoveryPending } from '@/config/supabase'
import { useAuthStore } from '@/stores/authStore'
const auth = useAuthStore(), password = ref(''), confirm = ref(''), message = ref(''), busy = ref(false), done = ref(false)
async function save() {
  message.value = ''
  if (password.value.length < 6 || !/[a-z]/.test(password.value) || !/[A-Z]/.test(password.value) || !/\d/.test(password.value) || !/[^a-zA-Z0-9\s]/.test(password.value)) { message.value = '密码至少6位，包含大小写字母、数字和符号。'; return }
  if (password.value !== confirm.value) { message.value = '两次密码不一致。'; return }
  busy.value = true
  try {
    const { error } = await supabase.auth.updateUser({ password: password.value })
    if (error) throw error
    recoveryPending.value = false; done.value = true; password.value = ''; confirm.value = ''
  } catch(e) { message.value = e.message } finally { busy.value = false }
}
</script>
<template><main class="max-w-md mx-auto p-8 space-y-5"><h1 class="text-2xl font-bold">设置新密码</h1>
<p v-if="done">密码已更新。<router-link to="/">返回后台</router-link></p>
<form v-else-if="auth.user" @submit.prevent="save" class="space-y-4">
<label class="block">新密码<input class="input-field mt-2" type="password" autocomplete="new-password" v-model="password" required /></label>
<label class="block">确认密码<input class="input-field mt-2" type="password" autocomplete="new-password" v-model="confirm" required /></label>
<p role="alert">{{ message }}</p><button class="btn-primary px-5 py-2" :disabled="busy">{{ busy ? '保存中…' : '保存新密码' }}</button></form>
<p v-else>链接无效或已过期，请<router-link to="/reset-password" @click="recoveryPending = false">重新申请重置邮件</router-link>。</p>
</main></template>

