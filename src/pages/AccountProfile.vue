<script setup>
import { computed, ref } from 'vue';
import { useAuthStore } from '@/stores/authStore';

const auth = useAuthStore();
const roles = {
  admin: '管理员',
  official_account: '官方账号',
  company_staff: '公司员工',
  collaborator_fan: '粉丝协作者',
};
const isAdmin = computed(() => auth.userProfile?.role === 'admin');
const access = computed(() => {
  if (isAdmin.value) return '可审核用户并管理后台内容。';
  if (auth.userProfile?.role === 'collaborator_fan') return '可管理活动和参与事项；用户审核、艺人资料及消息核实由管理员负责。';
  return '此角色的内容管理范围尚未开放，请联系管理员。';
});
const copied = ref(false);
async function copyRegistrationLink() {
  copied.value = false;
  try {
    await navigator.clipboard.writeText(new URL(`${import.meta.env.BASE_URL}register`, location.origin).href);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <section class="bg-white rounded-xl p-6 space-y-5">
    <h1 class="text-xl font-bold">账号资料</h1>
    <dl class="grid gap-3">
      <div><dt class="inline text-gray-500">邮箱：</dt><dd class="inline">{{ auth.userProfile?.email }}</dd></div>
      <div><dt class="inline text-gray-500">昵称：</dt><dd class="inline">{{ auth.userProfile?.nickname || '未填写' }}</dd></div>
      <div><dt class="inline text-gray-500">角色：</dt><dd class="inline">{{ roles[auth.userProfile?.role] || auth.userProfile?.role }}</dd></div>
      <div><dt class="inline text-gray-500">公司：</dt><dd class="inline">{{ auth.userProfile?.company || '未填写' }}</dd></div>
      <div><dt class="inline text-gray-500">后台权限：</dt><dd class="inline">{{ access }}</dd></div>
    </dl>
    <div class="flex flex-wrap gap-4 items-center">
      <router-link class="text-primary-600 underline" to="/reset-password">通过邮件重置密码</router-link>
      <router-link v-if="isAdmin" class="text-primary-600 underline" to="/users">查看用户审核</router-link>
    </div>
    <div v-if="isAdmin" class="border-t pt-4 space-y-2">
      <p class="font-medium">邀请协作者</p>
      <p class="text-sm text-gray-600">请对方使用注册链接自行注册并验证邮箱；你可在“用户审核”中批准或拒绝后台权限。</p>
      <button class="btn-secondary" type="button" @click="copyRegistrationLink">复制注册链接</button>
      <span v-if="copied" class="text-sm text-green-700 ml-3" role="status">已复制</span>
    </div>
  </section>
</template>
