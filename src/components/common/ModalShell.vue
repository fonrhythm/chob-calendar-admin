<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
const props = defineProps({ title: String, busy: Boolean })
const emit = defineEmits(['close'])
const dialog = ref(null)
const previous = document.activeElement
function cancel(event) { event.preventDefault(); if (!props.busy) emit('close') }
function onBackdropClick(event) { if (event.target === dialog.value && !props.busy) emit('close') }
onMounted(() => dialog.value.showModal())
onUnmounted(() => previous?.focus?.())
</script>
<template><dialog ref="dialog" @cancel="cancel" @click="onBackdropClick" class="fixed inset-0 m-auto w-[94vw] max-w-3xl max-h-[calc(100dvh-2rem)] rounded-2xl p-0 shadow-xl backdrop:bg-black/40">
<div class="max-h-[88dvh] flex flex-col"><header class="flex justify-between items-center p-5 border-b"><h2 class="text-xl font-bold">{{ title }}</h2><button :disabled="busy" @click="emit('close')" aria-label="关闭" class="text-2xl px-3">×</button></header>
<div class="p-5 overflow-y-auto"><slot /></div></div></dialog></template>
