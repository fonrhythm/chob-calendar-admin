<script setup>
import { computed, ref, watch } from 'vue';
import { COMPLETION_OPTIONS } from '../lib/task-completion-actions.js';
const props = defineProps({ modelValue: { type: String, default: 'open' }, label: { type: String, default: '事项状态' }, disabled: Boolean, automaticLabel: { type: String, default: '' } });
const emit = defineEmits(['update:modelValue']);
const selected = ref('open');
const automaticallyClosed = computed(() => props.modelValue === 'open' && !!props.automaticLabel);
watch(() => [props.modelValue, props.disabled, props.automaticLabel], () => {
  selected.value = automaticallyClosed.value ? 'automatic' : props.modelValue;
}, { immediate: true });
</script>
<template>
  <label class="task-completion-control" @click.stop>
    <span>{{ label }}</span>
    <select v-model="selected" :aria-label="label" :disabled="disabled" @change="selected !== 'automatic' && emit('update:modelValue', selected)">
      <option v-if="automaticallyClosed" value="automatic" disabled>{{ automaticLabel }}</option>
      <option v-for="option in COMPLETION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </label>
</template>
<style scoped>
.task-completion-control { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; }
select { padding: 8px 12px; border: 1px solid #d9dbd4; border-radius: 8px; background: #fff; color: #292e25; font: inherit; min-width: 140px; }
select:focus-visible { outline: 2px solid #6b805d; outline-offset: 2px; }
select:disabled { opacity: .6; }
</style>
