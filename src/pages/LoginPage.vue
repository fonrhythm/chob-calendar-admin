<template>
  <div class="min-h-screen bg-gradient-to-br from-primary-600 to-secondary-600 flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-md">
      <!-- Logo 和标题 -->
      <div class="text-center mb-8">
        <h1 class="text-4xl font-bold text-white mb-2">Chob Calendar</h1>
        <p class="text-primary-100">艺人行程管理系统</p>
      </div>

      <!-- 登录卡片 -->
      <div class="bg-white rounded-2xl shadow-2xl p-8">
        <h2 class="text-2xl font-bold text-gray-900 mb-6">登录</h2>

        <!-- 错误提示 -->
        <div
          v-if="authStore.error"
          class="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
        >
          {{ authStore.error }}
        </div>

        <!-- 登录表单 -->
        <form @submit.prevent="handleLogin" class="space-y-4">
          <!-- 邮箱字段 -->
          <div class="form-group">
            <label for="email" class="form-label">邮箱地址</label>
            <input
              id="email"
              v-model="formData.email"
              type="email"
              class="input-field"
              placeholder="your@email.com"
              required
              :disabled="authStore.loading"
            />
            <span v-if="errors.email" class="form-error">{{ errors.email }}</span>
          </div>

          <!-- 密码字段 -->
          <div class="form-group">
            <label for="password" class="form-label">密码</label>
            <div class="relative">
              <input
                id="password"
                v-model="formData.password"
                :type="showPassword ? 'text' : 'password'"
                class="input-field pr-10"
                placeholder="••••••••"
                required
                :disabled="authStore.loading"
              />
              <button
                type="button"
                @click="showPassword = !showPassword"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                <svg
                  v-if="!showPassword"
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                <svg
                  v-else
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-4.803m5.596-3.856a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
            </div>
            <span v-if="errors.password" class="form-error">{{ errors.password }}</span>
          </div>

          <!-- 记住我 -->
          <div class="flex items-center">
            <input
              id="remember"
              v-model="formData.rememberMe"
              type="checkbox"
              class="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
              :disabled="authStore.loading"
            />
            <label for="remember" class="ml-2 text-sm text-gray-700">在此设备保持登录</label>
          </div>

          <!-- 登录按钮 -->
          <button
            type="submit"
            class="w-full btn-primary py-3 font-semibold text-lg"
            :disabled="authStore.loading"
          >
            <span v-if="!authStore.loading">登录</span>
            <span v-else class="flex items-center justify-center">
              <svg class="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              登录中...
            </span>
          </button>
        </form>

        <!-- 分隔线 -->
        <div class="my-6 flex items-center">
          <div class="flex-1 border-t border-gray-300" />
          <span class="px-3 text-sm text-gray-500">或</span>
          <div class="flex-1 border-t border-gray-300" />
        </div>

        <!-- 其他链接 -->
        <div class="space-y-3 text-center text-sm">
          <div>
            <router-link to="/reset-password" class="text-primary-600 hover:text-primary-700 font-medium">
              忘记密码？
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
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const showPassword = ref(false)
const formData = reactive({
  email: '',
  password: '',
  rememberMe: true,
})
const errors = reactive({
  email: '',
  password: '',
})

// 验证表单
const validateForm = () => {
  errors.email = ''
  errors.password = ''

  if (!formData.email) {
    errors.email = '请输入邮箱地址'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
    errors.email = '请输入有效的邮箱地址'
  }

  if (!formData.password) {
    errors.password = '请输入密码'
  } else if (formData.password.length < 6) {
    errors.password = '密码至少需要6位'
  }

  return !errors.email && !errors.password
}

// 处理登录
const handleLogin = async () => {
  if (!validateForm()) return

  const result = await authStore.login(formData.email, formData.password, formData.rememberMe)

  if (result.success) {
    // 清空表单
    formData.email = ''
    formData.password = ''

    // 获取重定向地址，默认为 Dashboard
    const candidate = route.query.redirect
    const redirect = typeof candidate === 'string' && candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/'
    router.push(redirect)
  }
}
</script>

<style scoped>
/* 动画效果 */
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
