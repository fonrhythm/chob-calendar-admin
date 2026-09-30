<template>
  <div class="min-h-screen bg-gradient-to-br from-primary-600 to-secondary-600 flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-md">
      <!-- Logo 和标题 -->
      <div class="text-center mb-8">
        <h1 class="text-4xl font-bold text-white mb-2">Chob Calendar</h1>
        <p class="text-primary-100">艺人行程管理系统</p>
      </div>

      <!-- 注册卡片 -->
      <div class="bg-white rounded-2xl shadow-2xl p-8">
        <h2 class="text-2xl font-bold text-gray-900 mb-6">创建账户</h2>

        <!-- 错误提示 -->
        <div
          v-if="authStore.error"
          class="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
        >
          {{ authStore.error }}
        </div>

        <!-- 成功提示 -->
        <div
          v-if="registrationSuccess"
          class="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm"
        >
          注册成功！请先完成邮箱验证，再等待管理员审核。审核通过后才能进入后台。
        </div>

        <!-- 注册表单 -->
        <form v-if="!registrationSuccess" @submit.prevent="handleRegister" class="space-y-4">
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
                placeholder="至少6位，包含大小写字母、数字和符号"
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

            <!-- 密码强度指示 -->
            <div class="mt-2">
              <div class="flex gap-1">
                <div
                  v-for="i in 4"
                  :key="i"
                  :class="[
                    'h-1 flex-1 rounded-full transition-colors',
                    i <= passwordStrength ? 'bg-primary-600' : 'bg-gray-200'
                  ]"
                />
              </div>
              <p class="text-xs text-gray-500 mt-1">{{ passwordStrengthText }}</p>
            </div>
          </div>

          <!-- 确认密码字段 -->
          <div class="form-group">
            <label for="confirmPassword" class="form-label">确认密码</label>
            <input
              id="confirmPassword"
              v-model="formData.confirmPassword"
              type="password"
              class="input-field"
              placeholder="再次输入密码"
              required
              :disabled="authStore.loading"
            />
            <span v-if="errors.confirmPassword" class="form-error">{{ errors.confirmPassword }}</span>
          </div>

          <p class="text-sm text-gray-500">注册后需完成邮箱验证，并等待管理员审核。审核前不能进入管理后台。</p>

          <!-- 注册按钮 -->
          <button
            type="submit"
            class="w-full btn-primary py-3 font-semibold text-lg"
            :disabled="authStore.loading"
          >
            <span v-if="!authStore.loading">创建账户</span>
            <span v-else class="flex items-center justify-center">
              <svg class="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              注册中...
            </span>
          </button>
        </form>

        <!-- 注册后的操作 -->
        <div v-if="registrationSuccess" class="text-center space-y-4">
          <p class="text-gray-700">
            一封验证邮件已发送到 <strong>{{ formData.email }}</strong>
          </p>
          <p class="text-sm text-gray-600">
            请在4小时内点击邮件中的链接来验证你的邮箱。
          </p>
          <router-link
            to="/login"
            class="inline-block btn-primary"
          >
            返回登录页面
          </router-link>
        </div>

        <!-- 分隔线 -->
        <div v-if="!registrationSuccess" class="my-6 flex items-center">
          <div class="flex-1 border-t border-gray-300" />
          <span class="px-3 text-sm text-gray-500">或</span>
          <div class="flex-1 border-t border-gray-300" />
        </div>

        <!-- 登录链接 -->
        <div v-if="!registrationSuccess" class="text-center text-sm">
          已有账户？
          <router-link to="/login" class="text-primary-600 hover:text-primary-700 font-medium">
            立即登录
          </router-link>
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
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const authStore = useAuthStore()
const router = useRouter()

const showPassword = ref(false)
const registrationSuccess = ref(false)
const formData = reactive({
  email: '',
  password: '',
  confirmPassword: '',
  agreeTerms: false,
})
const errors = reactive({
  email: '',
  password: '',
  confirmPassword: '',
  agreeTerms: '',
})

// 计算密码强度
const passwordStrength = computed(() => {
  const pwd = formData.password
  let strength = 0

  if (pwd.length >= 6) strength++
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++
  if (/\d/.test(pwd)) strength++
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd)) strength++

  return strength
})

const passwordStrengthText = computed(() => {
  const texts = ['弱', '一般', '良好', '很强', '非常强']
  return texts[passwordStrength.value] || '未设置'
})

// 验证表单
const validateForm = () => {
  errors.email = ''
  errors.password = ''
  errors.confirmPassword = ''
  errors.agreeTerms = ''

  if (!formData.email) {
    errors.email = '请输入邮箱地址'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
    errors.email = '请输入有效的邮箱地址'
  }

  if (!formData.password) {
    errors.password = '请输入密码'
  } else if (formData.password.length < 6) {
    errors.password = '密码至少需要6位'
  } else if (!/[a-z]/.test(formData.password) || !/[A-Z]/.test(formData.password)) {
    errors.password = '密码必须包含大小写字母'
  } else if (!/\d/.test(formData.password)) {
    errors.password = '密码必须包含数字'
  } else if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(formData.password)) {
    errors.password = '密码必须包含特殊字符'
  }

  if (!formData.confirmPassword) {
    errors.confirmPassword = '请确认密码'
  } else if (formData.password !== formData.confirmPassword) {
    errors.confirmPassword = '两次输入的密码不一致'
  }

  return !errors.email && !errors.password && !errors.confirmPassword
}

// 处理注册
const handleRegister = async () => {
  if (!validateForm()) return

  const result = await authStore.register(formData.email, formData.password)

  if (result.success) {
    registrationSuccess.value = true
  }
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
