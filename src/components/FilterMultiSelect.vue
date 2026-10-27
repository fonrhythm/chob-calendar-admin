<script setup>
import { computed, ref } from 'vue';
const props = defineProps({
  modelValue: { type: Array, default: null },
  options: { type: Array, required: true },
  label: { type: String, required: true },
});
const emit = defineEmits(['update:modelValue']);
const query = ref('');
const selected = computed(() => props.modelValue === null ? props.options.map(o => o.value) : props.modelValue);
const count = computed(() => props.options.filter(o => selected.value.includes(o.value)).length);
const all = computed(() => props.options.length > 0 && count.value === props.options.length);
const visible = computed(() => props.options.filter(o => o.label.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
const summary = computed(() => props.modelValue === null || all.value ? `全部${props.label}` : count.value === 0 ? `未选择${props.label}` : props.options.filter(o => selected.value.includes(o.value)).map(o => o.label).join('、'));
function toggle(value, checked) {
  const next = new Set(selected.value);
  checked ? next.add(value) : next.delete(value);
  emit('update:modelValue', props.options.every(o => next.has(o.value)) ? null : [...next]);
}
</script>

<template>
  <details name="catalog-filter" class="relative min-w-0" @keydown.esc="$event.currentTarget.removeAttribute('open')">
    <summary :aria-label="`${label}筛选：${summary}`" class="input-field cursor-pointer flex items-center justify-between gap-2 list-none">
      <span class="truncate">{{ label }}：{{ summary }}</span><span aria-hidden="true">▾</span>
    </summary>
    <div :aria-label="`${label}筛选选项`" role="group" class="absolute z-20 top-full mt-1 w-full min-w-60 rounded-lg border border-gray-200 bg-white shadow-lg p-3 space-y-3">
      <input v-model="query" :aria-label="`搜索${label}选项`" :placeholder="`搜索${label}`" class="input-field text-sm" />
      <div class="flex items-center justify-between gap-3 text-sm border-b border-gray-100 pb-2">
        <label class="flex gap-2 items-center"><input type="checkbox" :aria-label="`全选${label}`" :checked="all" :indeterminate="count > 0 && !all" @change="emit('update:modelValue', $event.target.checked ? null : [])" />全选</label>
        <button type="button" class="text-primary-600" @click="emit('update:modelValue', [])">全不选</button>
      </div>
      <div class="max-h-64 overflow-y-auto space-y-1">
        <label v-for="option in visible" :key="option.value" class="flex gap-2 items-center rounded px-2 py-2 hover:bg-gray-50 cursor-pointer text-sm">
          <input type="checkbox" :checked="selected.includes(option.value)" @change="toggle(option.value, $event.target.checked)" />{{ option.label }}
        </label>
        <p v-if="!visible.length" class="text-sm text-gray-500 py-2">没有匹配选项</p>
      </div>
      <p class="text-xs text-gray-500">已选 {{ count }} / {{ options.length }} 项</p>
    </div>
  </details>
</template>
