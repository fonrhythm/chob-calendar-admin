<script setup>
import { ref } from 'vue';
import { useAuthStore } from '@/stores/authStore';
import { useRouter } from 'vue-router';
import { supabase } from '@/config/supabase';
const auth=useAuthStore(),router=useRouter(),busy=ref(false),message=ref('');
async function retry(){await auth.fetchUserProfile(auth.user.id);if(auth.ready)router.replace('/');}
async function request(){busy.value=true;message.value='';try{const {error}=await supabase.rpc('chob_request_backend_access');if(error)throw error;message.value='已提交后台访问申请。';await retry();}catch(e){message.value=e.message;}finally{busy.value=false;}}
async function exit(){if((await auth.logout()).success)router.replace('/login');}
</script>
<template><main class="max-w-lg mx-auto p-8 space-y-5">
<h1 class="text-2xl font-bold">后台访问申请</h1>
<p role="alert">{{ auth.error }}</p><p v-if="message" role="status">{{ message }}</p>
<p class="text-gray-500">网站普通用户无需后台权限。只有参与内容维护的人需要申请，完成邮箱验证并经管理员批准后才能进入。</p>
<button v-if="auth.userProfile && !auth.userProfile.backend_access_requested" class="btn-primary" :disabled="busy" @click="request">申请后台访问</button>
<button class="btn-secondary" :disabled="busy" @click="retry">重新检查</button>
<button class="btn-secondary" @click="exit">退出登录</button>
</main></template>
