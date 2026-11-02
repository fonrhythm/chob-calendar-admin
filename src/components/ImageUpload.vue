<script setup>
import {ref} from 'vue';
import {saveImage} from '@/lib/event-images';
const emit=defineEmits(['uploaded']);const busy=ref(false),error=ref('');
async function choose(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;busy.value=true;error.value='';try{emit('uploaded',await saveImage(file));}catch(e){error.value=e.message;}finally{busy.value=false;}}
</script>
<template><div><label class="btn-secondary inline-block cursor-pointer">{{busy?'正在保存图片…':'上传原图到本站'}}<input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="choose" /></label><p v-if="error" role="alert" class="text-red-700">{{error}}</p></div></template>
