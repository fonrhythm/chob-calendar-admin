import { createClient } from '@supabase/supabase-js'
import { configurationProblem } from '../lib/configuration.js'
const url = import.meta.env.VITE_SUPABASE_URL || ''
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
export const configurationError = configurationProblem(url,key)
export function setRememberMe(remember) {
  localStorage.setItem('chob-remember', remember ? 'yes' : 'no')
}
const storage = {
  getItem: name => sessionStorage.getItem(name) ?? localStorage.getItem(name),
  setItem(name, value) {
    const keep = localStorage.getItem('chob-remember') !== 'no'
    ;(keep ? sessionStorage : localStorage).removeItem(name)
    ;(keep ? localStorage : sessionStorage).setItem(name, value)
  },
  removeItem(name) { localStorage.removeItem(name); sessionStorage.removeItem(name) },
}
export const supabase = configurationError ? null : createClient(url, key, { auth: { storage } })
export default supabase
