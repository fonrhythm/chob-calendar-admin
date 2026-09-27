export function configurationProblem(url,key) {
  if (!url || !key) return '请填写 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY 后重新启动。'
  try { if (new URL(url).protocol !== 'https:') return 'Supabase项目地址应为HTTPS地址。' }
  catch { return 'Supabase项目地址格式不正确。' }
  if (key.startsWith('sb_publishable_')) return ''
  if (key.startsWith('sb_secret_')) return '网页只能使用publishable key，不能使用secret key。'
  try {
    const body=key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')
    if (JSON.parse(atob(body)).role==='anon') return ''
  } catch { /* Legacy keys are accepted only with the anon role. */ }
  return '请使用publishable key或旧版anon key，不能使用service_role等管理员密钥。'
}
