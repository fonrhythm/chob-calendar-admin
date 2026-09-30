import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { supabase, setRememberMe, recoveryPending } from '@/config/supabase';

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null),
    userProfile = ref(null),
    loading = ref(false),
    error = ref('');
  const isAuthenticated = computed(() => !!user.value);
  const ready = computed(
    () => !!userProfile.value?.is_active && !!userProfile.value?.email_verified &&
      (userProfile.value?.backend_approved === true ||
        (userProfile.value?.backend_approved == null && userProfile.value?.role === 'admin')),
  );
  let initialization, subscription, profileRequest, profileId;
  async function fetchUserProfile(id) {
    if (profileRequest && profileId === id) return profileRequest;
    profileId = id;
    const request = (async () => {
      const { data, error: problem } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (user.value?.id !== id) return null;
      userProfile.value = problem ? null : data;
      error.value = problem
        ? `读取账号资料失败：${problem.message}`
        : !data
          ? '账号资料尚未建立，请先执行数据库初始化脚本。'
          : !data.is_active
            ? '此账号已停用，请联系管理员。'
            : !data.email_verified
              ? '请先完成邮箱验证。'
              : data.backend_review_status === 'rejected'
                ? '后台访问申请未通过，请联系管理员。'
                : data.backend_review_status === 'revoked'
                  ? '后台访问权限已撤销，请联系管理员。'
                  : !data.backend_approved && data.role !== 'admin'
                    ? '账号待管理员审核，审核通过后才能进入后台。'
              : '';
      return userProfile.value;
    })();
    profileRequest = request;
    try {
      return await request;
    } finally {
      if (profileRequest === request) profileRequest = null;
    }
  }
  async function checkAuth() {
    if (initialization) return initialization;
    initialization = (async () => {
      const { data, error: problem } = await supabase.auth.getSession();
      if (problem) {
        error.value = problem.message;
        return false;
      }
      user.value = data.session?.user || null;
      if (user.value && !recoveryPending.value)
        await fetchUserProfile(user.value.id);
      else userProfile.value = null;
      return !!user.value;
    })();
    try {
      return await initialization;
    } finally {
      initialization = null;
    }
  }
  function setupAuthListener() {
    if (subscription) return;
    subscription = supabase.auth.onAuthStateChange((event, session) => {
      const id = session?.user.id;
      if (user.value?.id !== id) userProfile.value = null;
      user.value = session?.user || null;
      if (id)
        setTimeout(() => {
          if (user.value?.id === id)
            fetchUserProfile(id).catch((e) => {
              error.value = e.message;
            });
        }, 0);
    }).data.subscription;
  }
  async function perform(action) {
    loading.value = true;
    error.value = '';
    try {
      return await action();
    } catch (e) {
      error.value = e.message;
      return { success: false, error: e.message };
    } finally {
      loading.value = false;
    }
  }
  const login = (email, password, remember = true) =>
    perform(async () => {
      setRememberMe(remember);
      const { data, error: problem } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (problem) throw problem;
      user.value = data.user;
      await fetchUserProfile(data.user.id);
      return { success: true };
    });
  const register = (email, password) =>
    perform(async () => {
      const { data, error: problem } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: new URL(import.meta.env.BASE_URL, location.origin)
            .href,
        },
      });
      if (problem) throw problem;
      return { success: true, data };
    });
  const logout = () =>
    perform(async () => {
      const { error: problem } = await supabase.auth.signOut();
      if (problem) throw problem;
      user.value = null;
      userProfile.value = null;
      return { success: true };
    });
  const resetPassword = (email) =>
    perform(async () => {
      const { error: problem } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: new URL(
            import.meta.env.BASE_URL + 'update-password',
            location.origin,
          ).href,
        },
      );
      if (problem) throw problem;
      return { success: true };
    });
  return {
    user,
    userProfile,
    loading,
    error,
    ready,
    isAuthenticated,
    login,
    register,
    logout,
    resetPassword,
    fetchUserProfile,
    checkAuth,
    setupAuthListener,
  };
});
