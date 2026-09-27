<script setup>
import { computed, ref } from 'vue'
import ModalShell from './common/ModalShell.vue'
import { csvImportRows, readImportRows, previewImport } from '@/lib/event-import'
import { recordLabel } from '@/lib/event-fields'
import { importEventBundles } from '@/lib/events'
const props=defineProps({workspace:Object}),emit=defineEmits(['close','saved'])
const rows=ref([]),filename=ref(''),error=ref(''),busy=ref(false),reading=ref(false),defaults=ref({region:'',condition:''})
const preview=computed(()=>previewImport(rows.value,props.workspace,defaults.value))
const invalid=computed(()=>preview.value.filter(r=>r.problems.length).length)
let readId=0
async function choose(e) {
  const file=e.target.files?.[0]; e.target.value=''; if(!file)return
  const request=++readId;reading.value=true;error.value='';rows.value=[];filename.value=file.name
  try {
    if(file.size>5*1024*1024)throw new Error('文件超过 5 MB，请拆分后导入。')
    let result
    if(/\.xlsx$/i.test(file.name)){ const {readSheet}=await import('read-excel-file/browser'); result=readImportRows(await readSheet(file,1)) }
    else if(/\.csv$/i.test(file.name))result=csvImportRows(await file.text())
    else throw new Error('请选择 UTF-8 CSV 或 XLSX 文件。')
    if(request===readId) rows.value=result
  }catch(e){if(request===readId)error.value=e.message}finally{if(request===readId)reading.value=false}
}
async function submit(){
  if(busy.value || invalid.value || !preview.value.length)return
  busy.value=true;error.value=''
  try{await importEventBundles(preview.value.map(r=>({event:r.event,tasks:r.tasks})));emit('saved')}
  catch(e){error.value=e.message}finally{busy.value=false}
}
function downloadTemplate(){
  const header='date,time,name,activity,venue,city,sale_date,sale_time,ticket_url,ticket_type,price,category,type,note,status,tag,picture_url,thailand,company,region,participation_condition,sale_end_date,sale_end_time\r\n'
  const url=URL.createObjectURL(new Blob(['\uFEFF'+header],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='活动导入模板.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
</script>
<template>
  <ModalShell title="批量导入活动" :busy="busy || reading" @close="emit('close')">
    <div class="space-y-5">
      <p class="text-sm text-gray-600">支持 CSV / Excel（第一个工作表），每批最多 200 条。先校验并预览，全部通过后一次导入为草稿；失败不会只导入一半。</p>
      <div class="flex flex-wrap gap-3"><label class="btn-secondary cursor-pointer">选择 CSV / XLSX<input type="file" accept=".csv,.xlsx" :disabled="busy || reading" class="sr-only" aria-label="选择导入文件" @change="choose"></label><button type="button" class="btn-ghost" @click="downloadTemplate">下载表头模板</button></div>
      <p class="text-sm text-gray-500">name = 艺人名称（多人用分号分隔），activity = 活动名称，type = 艺人类别，category = 活动类型。日期需包含年份。图片用分号分隔，最多 9 张。</p>
      <div class="grid sm:grid-cols-2 gap-4"><label>缺失地区时使用<select v-model="defaults.region" :disabled="busy" aria-label="导入默认地区" class="input-field mt-1"><option value="">请选择</option><option>泰国</option><option>其他国家或地区</option><option>线上</option></select></label><label>缺失参与方式时使用<select v-model="defaults.condition" :disabled="busy" aria-label="导入默认参与方式" class="input-field mt-1"><option value="">请选择</option><option v-for="c in workspace.conditions" :key="c.code" :value="c.code">{{ recordLabel(c) }}</option></select></label></div>
      <p v-if="reading" role="status">正在读取文件…</p><p v-if="error" role="alert" class="text-red-700 bg-red-50 p-3 rounded-lg">{{ error }}</p>
      <template v-if="rows.length"><p class="font-medium">{{ filename }} · {{ rows.length }} 条 · {{ invalid }} 条需修正</p><div class="max-h-72 overflow-auto border rounded-lg"><table class="w-full text-sm text-left"><thead class="bg-gray-50"><tr><th class="p-3">行</th><th class="p-3">艺人 / 活动</th><th class="p-3">日期</th><th class="p-3">检查结果</th></tr></thead><tbody class="divide-y"><tr v-for="r in preview" :key="r.event.id"><td class="p-3">{{ r.line }}</td><td class="p-3"><b>{{ r.names }}</b><p>{{ r.event.title }}</p></td><td class="p-3 whitespace-nowrap">{{ r.event.date || '无效日期' }}</td><td class="p-3"><p v-for="p in r.problems" :key="p" class="text-red-700">{{ p }}</p><p v-for="w in r.warnings" :key="w" class="text-amber-800">{{ w }}</p><span v-if="!r.problems.length && !r.warnings.length" class="text-green-700">可导入</span></td></tr></tbody></table></div><p v-if="invalid" class="text-sm text-gray-500">请在原文件中修正对应行后重新选择文件。姓名仅自动关联唯一的准确匹配，不会擅自新建艺人。</p></template>
      <div class="flex justify-end gap-3"><button class="btn-secondary" :disabled="busy || reading" @click="emit('close')">取消</button><button class="btn-primary" :disabled="busy || reading || !rows.length || !!invalid" @click="submit">{{ busy ? '正在导入…' : `导入 ${rows.length} 条草稿` }}</button></div>
    </div>
  </ModalShell>
</template>
