<template>
  <div class="min-h-screen bg-gradient-to-br from-primary-600 to-secondary-600 flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-md">
      <!-- Logo 和标题 -->
      <div class="text-center mb-8">
        <h1 class="text-4xl font-bold text-white mb-2">Chob Calendar</h1>
        <p class="text-primary-100">艺人行程管理系统</p>
      </div>

      <!-- 重置密码卡片 -->
      <div class="bg-white rounded-2xl shadow-2xl p-8">
        <h2 class="text-2xl font-bold text-gray-900 mb-2">重置密码</h2>
        <p class="text-gray-600 text-sm mb-6">输入你的邮箱地址，我们将发送一条密码重置链接</p>

        <!-- 错误提示 -->
        <div
          v-if="error"
          class="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
        >
          {{ error }}
        </div>

        <!-- 成功提示 -->
        <div
          v-if="resetSent"
          class="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm"
        >
          <p class="font-semibold mb-1">✓ 邮件已发送</p>
          <p>请检查你的邮箱并点击链接来重置密码。</p>
        </div>

        <!-- 第一步：输入邮箱 -->
        <form v-if="!resetSent" @submit.prevent="handleResetPassword" class="space-y-4">
          <div class="form-group">
            <label for="email" class="form-label">邮箱地址</label>
            <input
              id="email"
              v-model="formData.email"
              type="email"
              class="input-field"
              placeholder="your@email.com"
              required
              :disabled="loading"
            />
            <span v-if="errors.email" class="form-error">{{ errors.email }}</span>
          </div>

          <button
            type="submit"
            class="w-full btn-primary py-3 font-semibold text-lg"
            :disabled="loading"
          >
            <span v-if="!loading">发送重置链接</span>
            <span v-else class="flex items-center justify-center">
              <svg class="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              发送中...
            </span>
          </button>
        </form>

        <!-- 重置密码成功后 -->
        <div v-if="resetSent" class="space-y-4">
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
            <p class="font-semibold mb-2">💡 提示</p>
            <ul class="list-disc list-inside space-y-1">
              <li>检查你的邮箱（包括垃圾邮件文件夹）</li>
              <li>点击邮件中的"重置密码"链接</li>
              <li>设置新密码并确认</li>
              <li>返回登录页面使用新密码登录</li>
            </ul>
          </div>

          <router-link
            to="/login"
            class="block text-center btn-primary py-3 font-semibold"
          >
            返回登录页面
          </router-link>
        </div>

        <!-- 分隔线 -->
        <div v-if="!resetSent" class="my-6 flex items-center">
          <div class="flex-1 border-t border-gray-300" />
          <span class="px-3 text-sm text-gray-500">或</span>
          <div class="flex-1 border-t border-gray-300" />
        </div>

        <!-- 其他链接 -->
        <div v-if="!resetSent" class="text-center space-y-3 text-sm">
          <div>
            <router-link to="/login" class="text-primary-600 hover:text-primary-700 font-medium">
              返回登录
            </router-link>
          </div>
          <div>
            还没有账户？
            <router-link to="/register" class="text-primary-600 hover:text-primary-700 font-medium">
              立即注册
            </router-link>
          </div>
        </div>
      </div>

      <!-- 底部信息 -->
      <p class="text-center text-white text-xs mt-8 opacity-75">
        © 2024 Chob Calendar. 保留所有权利。
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useAuthStore } from '@/stores/authStore'

const authStore = useAuthStore()

const loading = ref(false)
const error = ref(null)
const resetSent = ref(false)
const formData = reactive({
  email: '',
})
const errors = reactive({
  email: '',
})

// 验证表单
const validateForm = () => {
  errors.email = ''

  if (!formData.email) {
    errors.email = '请输入邮箱地址'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
    errors.email = '请输入有效的邮箱地址'
  }

  return !errors.email
}

// 处理密码重置请求
const handleResetPassword = async () => {
  if (!validateForm()) return

  loading.value = true
  error.value = null

  const result = await authStore.resetPassword(formData.email)

  if (result.success) {
    resetSent.value = true
  } else {
    error.value = result.error || '发送失败，请稍后重试'
  }

  loading.value = false
}
</script>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.bg-white {
  animation: fadeIn 0.3s ease-out;
}
</style>
