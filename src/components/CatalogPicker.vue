<script setup>
import { computed, ref } from 'vue';
import { artistTypes, selectionTypes } from '../lib/artist-selection';
const props = defineProps({
    catalog: { type: Array, default: () => [] },
    modelValue: { type: Array, default: () => [] },
  }),
  emit = defineEmits(['update:modelValue']);
const filters = ref([]),
  query = ref(''),
  open = ref(false);
const types = computed(() =>
  artistTypes(
    props.catalog.flatMap((a) =>
      [...(a.categories || []), a.group_kind].filter(Boolean),
    ),
  ),
);
const candidates = computed(() =>
  props.catalog
    .filter(
      (a) =>
        !a.deleted_at &&
        !props.modelValue.includes(a.id) &&
        (!filters.value.length ||
          selectionTypes([a], [a.id]).some((t) => filters.value.includes(t))) &&
        [a.name, a.en_name, a.company, ...(a.aliases || [])].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(query.value.toLowerCase()),
        ),
    )
    .slice(0, 50),
);
const label = (a) => a?.en_name?.trim() || a?.name || '';
function choose(id) {
  emit('update:modelValue', [...new Set([...props.modelValue, id])]);
  query.value = '';
}
</script>
<template>
  <section class="catalog-picker">
    <fieldset>
      <legend>艺人类别筛选</legend>
      <label v-for="type in types" :key="type"
        ><input type="checkbox" v-model="filters" :value="type" />{{
          type
        }}</label
      >
    </fieldset>
    <label class="catalog-search"
      >艺人名称<input
        v-model="query"
        placeholder="输入个人、CP、组合或乐队名称"
        @focus="open = true"
        @input="open = true"
        @keydown.enter.prevent="candidates[0] && choose(candidates[0].id)"
        @keydown.esc="open = false" /></label
    ><button type="button" class="catalog-toggle" @click="open = !open">
      {{ open ? '收起选项' : '展开选项' }} ▾
    </button>
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
    <p class="catalog-types">
      已选艺人属性：{{
        selectionTypes(catalog, modelValue).join(' · ') || '尚未选择'
      }}
    </p>
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
</style>
