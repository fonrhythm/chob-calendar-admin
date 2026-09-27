<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 to-secondary-600 px-4">
    <div class="text-center">
      <!-- 大的404 -->
      <div class="mb-8">
        <h1 class="text-9xl font-bold text-white opacity-80 mb-4">404</h1>
        <div class="text-6xl mb-6">😕</div>
      </div>

      <!-- 错误信息 -->
      <h2 class="text-4xl font-bold text-white mb-4">页面不存在</h2>
      <p class="text-xl text-primary-100 mb-8">
        抱歉，我们找不到你要访问的页面。
        <br />
        可能是网址输错了，或者这个页面已经被删除。
      </p>

      <!-- 快速链接 -->
      <div class="flex flex-col sm:flex-row gap-4 justify-center mb-12">
        <router-link
          to="/"
          class="btn-primary px-8 py-3 font-semibold inline-block"
        >
          返回首页
        </router-link>
        <button
          @click="goBack"
          class="bg-white text-primary-600 font-semibold px-8 py-3 rounded-lg hover:bg-primary-50 transition-colors"
        >
          返回上一页
        </button>
      </div>

      <!-- 搜索建议 -->
      <div class="bg-white bg-opacity-10 rounded-lg p-8 text-white max-w-md mx-auto">
        <p class="text-sm opacity-75 mb-4">你可能在寻找这些页面：</p>
        <ul class="space-y-2 text-left">
          <li>
            <router-link to="/" class="text-primary-100 hover:text-white underline">
              📊 首页 - 查看统计数据
            </router-link>
          </li>
          <li>
            <router-link to="/artists" class="text-primary-100 hover:text-white underline">
              👤 艺人管理 - 管理艺人信息
            </router-link>
          </li>
          <li>
            <router-link to="/events" class="text-primary-100 hover:text-white underline">
              📅 活动管理 - 管理活动信息
            </router-link>
          </li>
          <li>
            <router-link to="/tasks" class="text-primary-100 hover:text-white underline">
              ✅ 事项管理 - 管理待办事项
            </router-link>
          </li>
          <li>
            <router-link to="/profile" class="text-primary-100 hover:text-white underline">
              ⚙️ 个人资料 - 设置个人信息
            </router-link>
          </li>
        </ul>
      </div>

      <!-- 错误详情 -->
      <p class="text-primary-100 text-sm mt-8 opacity-75">
        错误代码: 404 Not Found
        <br />
        请求的资源无法找到
      </p>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

// 返回上一页
const goBack = () => {
  router.back()
}
</script>

<style scoped>
/* 动画效果 */
@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-20px);
  }
}

h1 {
  animation: float 3s ease-in-out infinite;
}
</style>
