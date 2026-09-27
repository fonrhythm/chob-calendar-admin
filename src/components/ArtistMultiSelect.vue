<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { searchArtist, displayArtistName } from '@/lib/artists'
const props = defineProps({ modelValue: { type: Array, default: () => [] }, artists: { type: Array, default: () => [] }, invalid: Boolean, required: { type: Boolean, default: true } })
const emit = defineEmits(['update:modelValue'])
const query = ref(''), open = ref(false), root = ref(null), input = ref(null), highlighted = ref(0), listId = useId()
const candidates = computed(() => props.artists.filter(a => !a.deleted_at && !props.modelValue.includes(a.id) && searchArtist(a, query.value)).slice(0, 50))
function remove(id) { emit('update:modelValue', props.modelValue.filter(x => x !== id)) }
function choose(artist) { if (!artist) return; emit('update:modelValue', [...props.modelValue, artist.id]); query.value=''; highlighted.value=0; input.value?.focus() }
function outside(e) { if (!root.value?.contains(e.target)) open.value=false }
function keys(e) {
  if (['ArrowDown','ArrowUp'].includes(e.key)) { e.preventDefault(); open.value=true; highlighted.value=Math.max(0,Math.min(candidates.value.length-1,highlighted.value+(e.key==='ArrowDown'?1:-1))) }
  if (e.key === 'Enter') { e.preventDefault(); if (open.value) choose(candidates.value[highlighted.value]); else open.value=true }
  if (e.key === 'Escape' && open.value) { e.preventDefault(); e.stopPropagation(); open.value=false }
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
<template>
  <div ref="root" class="artist-picker" @focusout="e => { if (!root.contains(e.relatedTarget)) open = false }">
    <div class="artist-input" :class="{ 'artist-invalid': invalid }">
      <div class="artist-values">
        <span v-for="id in modelValue" :key="id" class="artist-chip">{{ displayArtistName(artists.find(a => a.id === id)) || '未找到的艺人' }}<button type="button" :aria-label="`移除 ${displayArtistName(artists.find(a => a.id === id)) || id}`" @click="remove(id)">×</button></span>
        <input ref="input" v-model="query" role="combobox" aria-label="艺人名称" :aria-required="required" aria-autocomplete="list" :aria-expanded="open" :aria-controls="listId" :aria-activedescendant="open && candidates.length ? `${listId}-${highlighted}` : undefined" :aria-invalid="invalid || undefined" placeholder="输入名称匹配，或点击右侧下拉选择" @focus="open=true" @input="open=true; highlighted=0" @keydown="keys">
      </div>
      <button type="button" class="artist-toggle" :aria-expanded="open" aria-label="展开或收起艺人选项" @click="open=!open; highlighted=0"><svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" :style="{ transform: open ? 'rotate(180deg)' : '' }"><path d="m5 7 5 5 5-5"/></svg></button>
    </div>
    <ul v-if="open" :id="listId" role="listbox" aria-label="艺人候选" class="artist-options">
      <li v-for="(artist,index) in candidates" :id="`${listId}-${index}`" :key="artist.id" role="option" :aria-selected="index === highlighted" :class="{highlight:index===highlighted}" @pointerdown.prevent="choose(artist)">{{ displayArtistName(artist) }} <small v-if="artist.en_name && artist.en_name !== artist.name">{{ artist.name }}</small></li>
      <li v-if="!candidates.length" class="artist-empty">没有匹配项，请先在艺人资料库添加；已选艺人不会重复显示。</li>
      <li v-else-if="candidates.length === 50" class="artist-empty">显示前 50 项，输入名称可缩小范围。</li>
    </ul>
  </div>
</template>
<style scoped>
.artist-picker{position:relative}.artist-input{display:flex;align-items:center;background:#fff;border:1px solid #e1dfdb;border-radius:13px;min-height:54px}.artist-input:focus-within{outline:2px solid #b5b2aa;outline-offset:1px}.artist-values{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:10px 14px;flex:1;min-width:0}.artist-values input{min-width:120px;flex:1;width:100%;outline:none;background:transparent;font-weight:400;font-size:15px}.artist-chip{display:inline-flex;align-items:center;gap:8px;background:#eeede9;padding:4px 9px;border-radius:7px;font-size:13px;font-weight:500}.artist-chip button{font-size:18px;color:#777}.artist-toggle{padding:16px;color:#555;flex-shrink:0}.artist-options{position:relative;z-index:30;margin-top:6px;width:100%;max-height:220px;overflow:auto;border:1px solid #ddd9d1;border-radius:12px;box-shadow:0 8px 24px #0002;background:white;list-style:none;margin:0;padding:6px}.artist-options li{padding:10px 12px;border-radius:7px;cursor:pointer;font-size:15px;font-weight:400}.artist-options li:hover,.artist-options li.highlight{background:#efeeea}.artist-options small{color:#888}.artist-options .artist-empty{color:#888;font-size:13px;cursor:default}.artist-invalid{border-color:#bd4242}
</style>
