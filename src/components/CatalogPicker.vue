<script setup>
import { normalizeSearch } from '../lib/artistFilters';
import { computed, ref } from 'vue';
import { searchArtist } from '../lib/artists';
const props = defineProps({
    catalog: { type: Array, default: () => [] },
    modelValue: { type: Array, default: () => [] },
  }),
  emit = defineEmits(['update:modelValue']);
const query = ref(''),
  open = ref(false);
const candidates = computed(() =>
  props.catalog
    .filter(
      (a) =>
        !a.deleted_at &&
        !props.modelValue.includes(a.id) &&
        (searchArtist(a, query.value) ||
          normalizeSearch(a.company).includes(normalizeSearch(query.value))),
    )
    .slice(0, 50),
);
const label = (a) => a?.en_name?.trim() || a?.name || '';
function closeLater() {
  setTimeout(() => {
    open.value = false;
  }, 180);
}
function choose(id) {
  emit('update:modelValue', [...new Set([...props.modelValue, id])]);
  query.value = '';
  open.value = false;
}
</script>
<template>
  <section class="catalog-picker">
    <label class="catalog-search"
      >艺人名称 <small>可多选</small
      ><input
        v-model="query"
        placeholder="输入名称搜索，或点击选择 ▾"
        @focus="open = true"
        @click="open = true"
        @input="open = true"
        @keydown.enter.prevent="candidates[0] && choose(candidates[0].id)"
        @keydown.esc="open = false"
        @blur="closeLater"
    /></label>
    <div class="catalog-selected">
      <button
        v-for="id in modelValue"
        :key="id"
        type="button"
        @click="
          emit(
            'update:modelValue',
            modelValue.filter((v) => v !== id),
          )
        "
      >
        {{ label(catalog.find((a) => a.id === id)) || '未找到艺人' }} ×
      </button>
    </div>
    <div v-if="open" class="catalog-options">
      <button
        v-for="a in candidates"
        :key="a.id"
        type="button"
        @click="choose(a.id)"
      >
        {{ label(a) }} <small>{{ a.company }}</small>
      </button>
      <p v-if="!candidates.length">没有匹配的艺人</p>
    </div>
  </section>
</template>
<style scoped>
.catalog-picker {
  width: 100%;
  min-width: 0;
}
.catalog-picker fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 12px;
  border: 0;
  padding: 0;
}
.catalog-picker fieldset label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 400;
}
.catalog-picker input[type='checkbox'] {
  width: 16px;
  height: 16px;
  min-height: 0;
  margin: 0;
  flex: none;
}
.catalog-search {
  display: grid;
  gap: 6px;
}
.catalog-search input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #aaa6;
  border-radius: 10px;
  padding: 12px;
  background: transparent;
  color: inherit;
}
.catalog-toggle {
  font-size: 12px;
  padding: 8px 0;
}
.catalog-selected {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.catalog-selected button {
  border: 1px solid #aaa6;
  border-radius: 12px;
  padding: 5px 9px;
}
.catalog-options {
  max-height: 180px;
  overflow: auto;
  border: 1px solid #aaa6;
  border-radius: 10px;
  margin-top: 6px;
}
.catalog-options button {
  display: block;
  text-align: left;
  width: 100%;
  padding: 10px;
  background: transparent;
}
.catalog-options button:hover {
  background: #8882;
}
.catalog-options small {
  opacity: 0.65;
}
.catalog-types {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 8px;
}
.catalog-kind {
  display: grid;
  gap: 6px;
  margin-bottom: 8px;
}
.catalog-kind select {
  width: 100%;
  padding: 12px;
  border: 1px solid #aaa6;
  border-radius: 10px;
  background: var(--surface, #fff);
  color: inherit;
}
.catalog-kind small,
.catalog-search small {
  display: inline;
  font-size: 12px;
  font-weight: 400;
}
.catalog-search input {
  background: var(--surface, #fff);
  padding-right: 32px;
}
.catalog-search {
  margin-top: 16px;
}
</style>
