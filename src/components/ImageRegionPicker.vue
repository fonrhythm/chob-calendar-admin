<script setup>
import {computed,ref} from 'vue';
const props=defineProps({src:String,modelValue:{type:Object,required:true},disabled:Boolean});
const emit=defineEmits(['update:modelValue']);
const drag=ref(null),start=ref(null),box=ref(null);
const area=computed(()=>drag.value||props.modelValue);
const style=computed(()=>({left:area.value.left+'%',top:area.value.top+'%',width:(area.value.right-area.value.left)+'%',height:(area.value.bottom-area.value.top)+'%'}));
const point=e=>{const r=box.value.getBoundingClientRect();return {x:Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)),y:Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100))};};
function down(e){if(props.disabled)return;start.value=point(e);box.value.setPointerCapture(e.pointerId);}
function move(e){if(!start.value)return;const p=point(e),s=start.value;drag.value={left:Math.min(p.x,s.x),top:Math.min(p.y,s.y),right:Math.max(p.x,s.x),bottom:Math.max(p.y,s.y)};}
function up(e){if(!start.value)return;move(e);if(drag.value&&drag.value.right-drag.value.left>=2&&drag.value.bottom-drag.value.top>=2)emit('update:modelValue',Object.fromEntries(Object.entries(drag.value).map(([k,v])=>[k,Math.round(v)])));start.value=null;drag.value=null;}
function update(key,value){const next={...props.modelValue,[key]:Math.max(0,Math.min(100,Number(value)))};if(next.left<next.right&&next.top<next.bottom)emit('update:modelValue',next);}
</script>
<template><div class="space-y-2">
 <p class="text-sm">在图上拖动，框住一块日期和对应说明，避开人物、大标题和联系方式。多栏排版可分块识别并追加文字。</p>
 <div ref="box" class="region-picker" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="start=null;drag=null">
  <img :src="src" alt="框选月行程文字区域" draggable="false" />
  <div class="region-frame" :style="style" aria-hidden="true"></div>
 </div>
 <div class="grid grid-cols-2 sm:grid-cols-4 gap-2"><label v-for="(label,key) in {left:'左边界',top:'上边界',right:'右边界',bottom:'下边界'}" :key="key">{{label}} %<input type="number" min="0" max="100" :aria-label="label" class="input-field" :value="modelValue[key]" :disabled="disabled" @input="update(key,$event.target.value)" /></label></div>
 <button type="button" class="btn-secondary" :disabled="disabled" @click="emit('update:modelValue',{left:0,top:0,right:100,bottom:100})">重置为整图</button>
</div></template>
<style scoped>
.region-picker{display:inline-block;position:relative;max-width:100%;width:420px;overflow:hidden;touch-action:none;cursor:crosshair;user-select:none}
.region-picker img{display:block;width:100%;height:auto;pointer-events:none}.region-frame{position:absolute;border:2px solid #1d4ed8;box-shadow:0 0 0 1200px #0007;pointer-events:none}
</style>
