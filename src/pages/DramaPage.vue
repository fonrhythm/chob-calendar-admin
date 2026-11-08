<script setup>
import {onMounted,ref} from 'vue';
import {allRows} from '@/lib/api';
import Manager from '@/drama/DramaManager.vue';
const artists=ref([]),error=ref('');
onMounted(async()=>{try{artists.value=await allRows('artists');}catch(e){error.value=e.message;}});
</script>
<template><p v-if="error" role="alert">公司资料加载失败：{{error}}</p><Manager :schedule-artists="artists" /></template>
