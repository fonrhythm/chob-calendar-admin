import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/authStore';
import { configurationError, recoveryPending } from '@/config/supabase';

// 页面组件
const LoginPage = () => import('@/pages/LoginPage.vue');
const RegisterPage = () => import('@/pages/RegisterPage.vue');
const ResetPasswordPage = () => import('@/pages/ResetPasswordPage.vue');
const DashboardLayout = () => import('@/layouts/DashboardLayout.vue');
const Dashboard = () => import('@/pages/FoundationDashboard.vue');
const ArtistsPage = () => import('@/pages/ArtistsPage.vue');
const EventsPage = () => import('@/pages/EventsPage.vue');
const TasksPage = EventsPage;
const UsersPage = () => import('@/pages/UsersPage.vue');
const ProfilePage = () => import('@/pages/AccountProfile.vue');
const NotFound = () => import('@/pages/NotFound.vue');

const routes = [
  {
    path: '/account-status',
    name: 'AccountStatus',
    component: () => import('@/pages/AccountStatus.vue'),
  },
  {
    path: '/update-password',
    name: 'UpdatePassword',
    component: () => import('@/pages/UpdatePassword.vue'),
  },
  {
    path: '/login',
    name: 'Login',
    component: LoginPage,
    meta: { requiresAuth: false, title: '登录' },
  },
  {
    path: '/register',
    name: 'Register',
    component: RegisterPage,
    meta: { requiresAuth: false, title: '注册' },
  },
  {
    path: '/reset-password',
    name: 'ResetPassword',
    component: ResetPasswordPage,
    meta: { requiresAuth: false, title: '重置密码' },
  },
  {
    path: '/',
    component: DashboardLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: 'community',
        name: 'Community',
        component: () => import('@/pages/CommunityPage.vue'),
        meta: { title: '消息与核实', adminOnly: true },
      },
      {
        path: 'logs',
        name: 'Logs',
        component: () => import('@/pages/AuditPage.vue'),
        meta: { title: '操作记录', adminOnly: true },
      },
      {
        path: '',
        name: 'Dashboard',
        component: Dashboard,
        meta: { title: '首页' },
      },
      {
        path: 'artists',
        name: 'Artists',
        component: ArtistsPage,
        meta: { title: '艺人管理', adminOnly: true },
      },
      {
        path: 'events',
        name: 'Events',
        component: EventsPage,
        meta: { title: '活动管理', editorAllowed: true },
      },
      {
        path: 'tasks',
        name: 'Tasks',
        component: TasksPage,
        meta: { title: '事项管理', editorAllowed: true },
      },
      {
        path: 'users',
        name: 'Users',
        component: UsersPage,
        meta: { title: '用户管理', adminOnly: true },
      },
      {
        path: 'profile',
        name: 'Profile',
        component: ProfilePage,
        meta: { title: '个人资料' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: NotFound,
    meta: { title: '页面不存在' },
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

// 全局路由守卫
router.beforeEach(async (to, from, next) => {
  if (configurationError) {
    next();
    return;
  }
  const authStore = useAuthStore();
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth);
  const adminOnly = to.matched.some((record) => record.meta.adminOnly);
  const editorAllowed = to.matched.some((record) => record.meta.editorAllowed);

  // 检查认证状态
  if (!authStore.user) {
    await authStore.checkAuth();
  }

  // Complete SDK callback processing before routing, including Site URL fallback.
  if (recoveryPending.value && to.name !== 'UpdatePassword') {
    next({ name: 'UpdatePassword', replace: true });
    return;
  }

  // 如果需要认证但未登录
  if (requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'Login', query: { redirect: to.fullPath } });
    return;
  }

  // 如果已登录但访问登录页
  if (requiresAuth && !authStore.ready) {
    next({ name: 'AccountStatus' });
    return;
  }
  if (
    authStore.isAuthenticated &&
    (to.name === 'Login' || to.name === 'Register')
  ) {
    next({ name: 'Dashboard' });
    return;
  }

  // 检查管理员权限
  if (adminOnly && authStore.userProfile?.role !== 'admin') {
    next({ name: 'Dashboard' });
    return;
  }
  if (editorAllowed && !['admin', 'collaborator_fan'].includes(authStore.userProfile?.role)) {
    next({ name: 'Dashboard' });
    return;
  }

  // 设置页面标题
  document.title = `${to.meta.title || '页面'} - Chob Calendar Admin`;

  next();
});

export default router;
