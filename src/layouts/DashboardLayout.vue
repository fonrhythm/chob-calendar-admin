<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/authStore';
const auth = useAuthStore(),
  router = useRouter(),
  route = useRoute(),
  open = ref(false);
const roles = {
  admin: '管理员',
  official_account: '官方账号',
  company_staff: '经纪公司员工',
  collaborator_fan: '粉丝协作者',
};
const items = computed(() => [
  { path: '/', label: '概览' },
  ...(auth.userProfile?.role === 'admin'
    ? [{ path: '/artists', label: '艺人 / CP资料库' }]
    : []),
  ...(['admin', 'collaborator_fan'].includes(auth.userProfile?.role)
    ? [
        { path: '/events', label: '活动管理' },
        { path: '/tasks', label: '事项预览' },
      ]
    : []),
  ...(auth.userProfile?.role === 'admin'
    ? [
        { path: '/community', label: '消息与核实' },
        { path: '/logs', label: '操作记录' },
        { path: '/users', label: '用户审核' },
      ]
    : []),
  { path: '/profile', label: '账号资料' },
]);
watch(
  () => route.fullPath,
  () => {
    open.value = false;
  },
);
async function logout() {
  if ((await auth.logout()).success) router.replace('/login');
}
</script>
<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header
      class="md:hidden flex items-center justify-between bg-white border-b p-4"
    >
      <router-link to="/" class="font-bold text-primary-600"
        >Chob Calendar</router-link
      ><button
        @click="open = !open"
        :aria-expanded="open"
        aria-controls="main-navigation"
        class="btn-secondary px-3 py-2"
      >
        {{ open ? '收起菜单' : '菜单' }}
      </button>
    </header>
    <aside
      id="main-navigation"
      :class="open ? 'block' : 'hidden'"
      class="md:!flex md:fixed md:inset-y-0 md:w-64 flex-col bg-white border-r border-gray-200 z-20"
    >
      <div class="p-6 border-b">
        <h1 class="font-bold text-xl text-primary-600">Chob Calendar</h1>
        <p class="text-xs text-gray-500 mt-1">艺人、活动与参与事项</p>
      </div>
      <div class="p-6">
        <p class="font-semibold break-all">{{ auth.userProfile?.nickname }}</p>
        <p class="text-sm text-gray-500 mt-1">
          {{ roles[auth.userProfile?.role] }}
        </p>
      </div>
      <nav aria-label="主导航" class="px-3 space-y-1 flex-1">
        <router-link
          v-for="item in items"
          :key="item.path"
          :to="item.path"
          :aria-current="route.path === item.path ? 'page' : undefined"
          :class="
            route.path === item.path
              ? 'bg-primary-50 text-primary-600 font-semibold'
              : 'text-gray-700 hover:bg-gray-50'
          "
          class="block rounded-lg px-4 py-3"
          >{{ item.label }}</router-link
        >
        <p class="px-4 pt-6 pb-3 text-xs text-gray-400">
          事项在活动表单中统一维护
        </p>
      </nav>
      <div class="p-4 border-t">
        <button
          @click="logout"
          :disabled="auth.loading"
          class="btn-secondary w-full py-2"
        >
          退出登录
        </button>
        <p v-if="auth.error" role="alert" class="text-red-700 text-sm mt-2">
          {{ auth.error }}
        </p>
      </div>
    </aside>
    <main class="md:ml-64 p-4 sm:p-8 max-w-screen-2xl"><router-view /></main>
  </div>
</template>
