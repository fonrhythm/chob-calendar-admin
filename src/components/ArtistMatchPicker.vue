<script setup>
import { computed, ref, watch } from 'vue';
import { displayArtistName, searchArtist } from '../lib/artists';

const props = defineProps({
  catalog: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' },
  originalName: { type: String, required: true },
});
const emit = defineEmits(['update:modelValue']);
const query = ref('');
const open = ref(false);
const selected = computed(() => props.catalog.find((artist) => artist.id === props.modelValue));
const candidates = computed(() =>
  props.catalog
    .filter((artist) => !artist.deleted_at && searchArtist(artist, query.value))
    .slice(0, 30),
);
watch(() => props.modelValue, (id) => {
  if (!id) query.value = '';
});
function choose(artist) {
  emit('update:modelValue', artist.id);
  query.value = '';
  open.value = false;
}
function closeLater() {
  setTimeout(() => { open.value = false; }, 180);
}
</script>

<template>
  <div class="artist-match">
    <label :for="`match-${originalName}`">原始名称：{{ originalName }}</label>
    <div v-if="selected" class="matched">
      <span>已匹配：{{ displayArtistName(selected) }}</span>
      <button type="button" @click="emit('update:modelValue', '')">更换或清除 ×</button>
    </div>
    <div class="search-wrap">
      <input
        :id="`match-${originalName}`"
        v-model="query"
        type="search"
        autocomplete="off"
        placeholder="输入名称搜索，或点击选择 ▾"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="open"
        @focus="open = true"
        @click="open = true"
        @input="open = true"
        @keydown.enter.prevent="candidates[0] && choose(candidates[0])"
        @keydown.esc="open = false"
        @blur="closeLater"
      />
      <div v-if="open" class="options" role="listbox">
        <button v-for="artist in candidates" :key="artist.id" type="button" role="option" @click="choose(artist)">
          {{ displayArtistName(artist) }} <small>{{ artist.company }}</small>
        </button>
        <p v-if="!candidates.length">没有匹配的艺人</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.artist-match { margin: 12px 0; }
.artist-match label { display: block; margin-bottom: 6px; }
.search-wrap { position: relative; }
.search-wrap input { width: 100%; box-sizing: border-box; border: 1px solid #aaa6; border-radius: 10px; padding: 12px; background: var(--surface, #fff); color: inherit; }
.options { position: absolute; z-index: 20; left: 0; right: 0; max-height: 180px; overflow-y: auto; margin-top: 3px; border: 1px solid #aaa6; border-radius: 10px; background: var(--surface, #fff); box-shadow: 0 8px 22px #0002; }
.options button { display: block; width: 100%; padding: 10px 12px; text-align: left; background: transparent; }
.options button:hover, .options button:focus { background: #8882; }
.options small { opacity: .65; }
.options p { padding: 10px 12px; }
.matched { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 13px; }
.matched button { text-decoration: underline; }
</style>
