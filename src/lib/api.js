import { supabase } from '@/config/supabase'
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.code === '23505' ? '名称重复，请核对现有资料后重试。' : error.message)
  return data
}
export async function allRows(table) {
  const rows = []
  for (let offset=0; ; offset+=500) {
    const { data, error } = await supabase.from(table).select('*').order('id').range(offset, offset+499)
    if (error) throw new Error(`读取失败：${error.message}`)
    rows.push(...data)
    if (data.length<500) return rows
  }
}
