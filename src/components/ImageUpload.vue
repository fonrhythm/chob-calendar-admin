<script setup>
import {ref} from 'vue';
import {saveImage} from '@/lib/event-images';
const fileInput=ref(null);
function openPicker(){if(!busy.value)fileInput.value?.click()}
const emit=defineEmits(['uploaded']);const busy=ref(false),error=ref('');
async function choose(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;busy.value=true;error.value='';try{emit('uploaded',await saveImage(file));}catch(e){error.value=e.message;}finally{busy.value=false;}}
</script>
<template><div><button type="button" class="btn-secondary inline-block cursor-pointer" :disabled="busy" @click="openPicker">{{busy?'正在保存图片…':'上传原图到本站'}}</button><input ref="fileInput" hidden style="display:none" tabindex="-1" type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="choose" /><p v-if="error" role="alert" class="text-red-700">{{error}}</p></div></template>
