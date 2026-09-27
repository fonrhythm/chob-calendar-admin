<script setup>
import { useAuthStore } from '@/stores/authStore'
const auth=useAuthStore()
const roles={admin:'管理员',official_account:'官方账号',company_staff:'经纪公司员工',collaborator_fan:'合作粉丝'}
</script>
<template><section class="bg-white rounded-xl p-6 space-y-4"><h1 class="text-xl font-bold">账号资料</h1><p>邮箱：{{ auth.userProfile?.email }}</p><p>昵称：{{ auth.userProfile?.nickname }}</p><p>角色：{{ roles[auth.userProfile?.role] }}</p><p>公司：{{ auth.userProfile?.company || '未填写' }}</p><router-link class="text-primary-600 block" to="/reset-password">通过邮件重置密码</router-link><p class="text-gray-500">个人资料编辑与用户邀请将在用户管理阶段接入。</p></section></template>
