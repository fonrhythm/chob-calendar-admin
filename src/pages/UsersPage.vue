<script setup>
import { computed, onMounted, ref } from 'vue';
import { supabase } from '@/config/supabase';

const accounts = ref([]);
const loading = ref(false);
const busyId = ref('');
const error = ref('');
const message = ref('');
const statusLabels = {
  pending: '待审核',
  approved: '已通过',
  rejected: '未通过',
  revoked: '已撤销',
};
const visible = computed(() => [...accounts.value]
  .filter((account) => account.role !== 'admin' && account.backend_access_requested === true)
  .sort((a, b) => {
    const order = { pending: 0, approved: 1, rejected: 2, revoked: 3 };
    return (order[a.backend_review_status] ?? 4) - (order[b.backend_review_status] ?? 4) ||
      String(a.email || '').localeCompare(String(b.email || ''));
  }));
const pendingCount = computed(() => visible.value.filter((account) => account.backend_review_status === 'pending').length);

async function load() {
  loading.value = true;
  error.value = '';
  const { data, error: problem } = await supabase.from('users')
    .select('id,email,nickname,role,email_verified,is_active,backend_approved,backend_review_status,backend_access_requested')
    .order('email');
  if (problem) error.value = problem.code === '42703' || problem.code === 'PGRST204'
    ? '请先在 Supabase 执行 018_backend_access_approval.sql。'
    : problem.message;
  else accounts.value = data || [];
  loading.value = false;
}
async function review(account, decision) {
  if (busyId.value) return;
  if (decision !== 'approved' && !window.confirm(`确定${decision === 'rejected' ? '拒绝' : '撤销'} ${account.email} 的后台访问权限？`)) return;
  busyId.value = account.id;
  error.value = '';
  message.value = '';
  try {
    const { error: problem } = await supabase.rpc('chob_review_backend_user', {
      target_user_id: account.id,
      decision,
    });
    if (problem) throw problem;
    message.value = `已${decision === 'approved' ? '批准' : decision === 'rejected' ? '拒绝' : '撤销'} ${account.email} 的后台访问。`;
    await load();
  } catch (problem) {
    error.value = problem.code === 'PGRST202'
      ? '请先在 Supabase 执行 018_backend_access_approval.sql。'
      : problem.message;
  } finally {
    busyId.value = '';
  }
}
onMounted(load);
</script>

<template>
  <section class="space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">后台成员</h1>
        <p class="text-gray-500 mt-1">这里只审核申请进入管理后台的账号，普通网站用户在“用户管理”中查看。待审核 {{ pendingCount }} 人。</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="load">刷新</button>
    </header>
    <p v-if="error" role="alert" class="bg-red-50 text-red-700 rounded-lg p-3">{{ error }}</p>
    <p v-if="message" role="status" class="bg-green-50 text-green-800 rounded-lg p-3">{{ message }}</p>
    <p v-if="loading">正在读取账号…</p>
    <div v-else class="space-y-3">
      <article v-for="account in visible" :key="account.id" class="bg-white rounded-xl border p-4 flex flex-wrap justify-between gap-3">
        <div>
          <h2 class="font-semibold break-all">{{ account.email }}</h2>
          <p class="text-sm text-gray-500">{{ account.nickname || '未填写昵称' }} · {{ statusLabels[account.backend_review_status] || '待审核' }} · {{ account.role === 'collaborator_fan' ? '粉丝协作者' : account.role }} · {{ account.email_verified ? '邮箱已验证' : '邮箱未验证' }}</p>
        </div>
        <div class="flex flex-wrap gap-2 items-center">
          <button v-if="!account.backend_approved" class="btn-primary" :disabled="!!busyId" @click="review(account, 'approved')">批准协作者权限</button>
          <button v-if="account.backend_review_status === 'pending'" class="btn-secondary" :disabled="!!busyId" @click="review(account, 'rejected')">拒绝</button>
          <button v-if="account.backend_approved" class="btn-secondary text-red-700" :disabled="!!busyId" @click="review(account, 'revoked')">撤销权限</button>
        </div>
      </article>
      <p v-if="!visible.length" class="text-gray-500">暂无后台访问申请。</p>
    </div>
    <p class="text-sm text-gray-500">活动编辑可管理活动和参与事项；后台成员、消息核实、艺人资料修改及操作记录仍仅管理员可用。</p>
  </section>
</template>
