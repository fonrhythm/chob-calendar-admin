<script setup>
import { computed, ref } from 'vue';
import ModalShell from './common/ModalShell.vue';
import {
  csvImportRows,
  readImportRows,
  previewImport,
} from '@/lib/event-import';
import { recordLabel } from '@/lib/event-fields';
import { importEventBundles } from '@/lib/events';
const props = defineProps({ workspace: Object }),
  emit = defineEmits(['close', 'saved', 'imported']);
const completed = ref(0),
  editingId = ref('');
const editFields = {
  name: '艺人（多人用 / 分隔）',
  activity: '活动名称',
  date: '日期',
  time: '时间',
  venue: '场地',
  city: '城市',
  category: '活动类型',
  region: '地区',
  participation_condition: '参与方式',
  picture_url: '图片链接',
  ticket_url: '票务链接',
  note: '备注',
  sale_date: '开票日期',
  sale_time: '开票时间',
  sale_end_date: '开票结束日期',
  sale_end_time: '开票结束时间',
};
const rows = ref([]),
  filename = ref(''),
  error = ref(''),
  busy = ref(false),
  reading = ref(false),
  defaults = ref({ region: '', condition: '' });
const preview = computed(() =>
  previewImport(rows.value, props.workspace, defaults.value),
);
const invalid = computed(
  () => preview.value.filter((r) => r.problems.length).length,
);
let readId = 0;
async function choose(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const request = ++readId;
  reading.value = true;
  error.value = '';
  rows.value = [];
  filename.value = file.name;
  try {
    if (file.size > 5 * 1024 * 1024)
      throw new Error('文件超过 5 MB，请拆分后导入。');
    let result;
    if (/\.xlsx$/i.test(file.name)) {
      const { readSheet } = await import('read-excel-file/browser');
      result = readImportRows(await readSheet(file, 1));
    } else if (/\.csv$/i.test(file.name))
      result = csvImportRows(await file.text());
    else throw new Error('请选择 UTF-8 CSV 或 XLSX 文件。');
    if (request === readId) rows.value = result;
  } catch (e) {
    if (request === readId) error.value = e.message;
  } finally {
    if (request === readId) reading.value = false;
  }
}
async function submit() {
  const valid = preview.value.filter((r) => !r.problems.length);
  if (busy.value || !valid.length) return;
  busy.value = true;
  error.value = '';
  try {
    await importEventBundles(
      valid.map((r) => ({ event: r.event, tasks: r.tasks })),
    );
    const ids = new Set(valid.map((r) => r.event.id));
    rows.value = rows.value.filter((r) => !ids.has(r.id));
    completed.value += valid.length;
    emit('imported');
    if (!rows.value.length) emit('saved');
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function downloadTemplate() {
  const a = document.createElement('a');
  a.href = import.meta.env.BASE_URL + 'templates/events-import.xlsx';
  a.download = '活动导入模板.xlsx';
  a.click();
}
</script>
<template>
  <ModalShell
    title="批量导入活动"
    :busy="busy || reading"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <p class="text-sm text-gray-600">
        支持 CSV / Excel（第一个工作表），每批最多 200
        条。先校验并预览，可在预览中修正，或先导入通过校验的行；剩余行保留供继续修改。
      </p>
      <div class="flex flex-wrap gap-3">
        <label class="btn-secondary cursor-pointer"
          >选择 CSV / XLSX<input
            type="file"
            accept=".csv,.xlsx"
            :disabled="busy || reading"
            class="sr-only"
            aria-label="选择导入文件"
            @change="choose" /></label
        ><button type="button" class="btn-ghost" @click="downloadTemplate">
          下载 Excel 模板
        </button>
      </div>
      <p class="text-sm text-gray-500">
        请删除模板中的提示行和示例活动后填写真实内容。未匹配艺人可先导入为待匹配草稿；日期、链接等错误需修正后再导入。
      </p>
      <div class="grid sm:grid-cols-2 gap-4">
        <label
          >缺失地区时使用<select
            v-model="defaults.region"
            :disabled="busy"
            aria-label="导入默认地区"
            class="input-field mt-1"
          >
            <option value="">请选择</option>
            <option>泰国</option>
            <option>其他国家或地区</option>
            <option>线上</option>
          </select></label
        ><label
          >缺失参与方式时使用<select
            v-model="defaults.condition"
            :disabled="busy"
            aria-label="导入默认参与方式"
            class="input-field mt-1"
          >
            <option value="">请选择</option>
            <option
              v-for="c in workspace.conditions"
              :key="c.code"
              :value="c.code"
            >
              {{ recordLabel(c) }}
            </option>
          </select></label
        >
      </div>
      <p v-if="completed" role="status">
        已导入 {{ completed }} 条，剩余 {{ rows.length }} 条待处理。
      </p>
      <p v-if="reading" role="status">正在读取文件…</p>
      <p
        v-if="error"
        role="alert"
        class="text-red-700 bg-red-50 p-3 rounded-lg"
      >
        {{ error }}
      </p>
      <template v-if="rows.length"
        ><p class="font-medium">
          {{ filename }} · {{ rows.length }} 条 · {{ invalid }} 条需修正
        </p>
        <div class="max-h-72 overflow-auto border rounded-lg">
          <table class="w-full text-sm text-left">
            <thead class="bg-gray-50">
              <tr>
                <th class="p-3">行</th>
                <th class="p-3">艺人 / 活动</th>
                <th class="p-3">日期</th>
                <th class="p-3">检查结果</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="r in preview" :key="r.event.id">
                <td class="p-3">{{ r.line }}</td>
                <td class="p-3">
                  <b>{{ r.names }}</b
                  ><button
                    class="btn-ghost"
                    @click="
                      editingId = editingId === r.event.id ? '' : r.event.id
                    "
                  >
                    修正此行
                  </button>
                  <div v-if="editingId === r.event.id" class="import-editor">
                    <label v-for="(label, key) in editFields" :key="key"
                      >{{ label
                      }}<input
                        v-model="rows.find((x) => x.id === r.event.id).raw[key]"
                        :aria-label="label"
                        :disabled="busy"
                    /></label>
                  </div>
                  <p>{{ r.event.title }}</p>
                </td>
                <td class="p-3 whitespace-nowrap">
                  {{ r.event.date || '无效日期' }}
                </td>
                <td class="p-3">
                  <p v-for="p in r.problems" :key="p" class="text-red-700">
                    {{ p }}
                  </p>
                  <p v-for="w in r.warnings" :key="w" class="text-amber-800">
                    {{ w }}
                  </p>
                  <span
                    v-if="!r.problems.length && !r.warnings.length"
                    class="text-green-700"
                    >可导入</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="invalid" class="text-sm text-gray-500">
          点击“修正此行”即可直接修改。无法匹配的艺人会保留原始名称，导入后在后台完成匹配才能发布。
        </p></template
      >
      <div class="flex justify-end gap-3">
        <button
          class="btn-secondary"
          :disabled="busy || reading"
          @click="emit('close')"
        >
          取消</button
        ><button
          class="btn-primary"
          :disabled="busy || reading || rows.length === invalid"
          @click="submit"
        >
          {{
            busy ? '正在导入…' : `导入 ${rows.length - invalid} 条可导入草稿`
          }}
        </button>
      </div>
    </div>
  </ModalShell>
</template>

<style scoped>
.import-editor {
  display: grid;
  gap: 8px;
  min-width: 260px;
  max-height: 320px;
  overflow: auto;
}
.import-editor label {
  display: grid;
  gap: 3px;
}
.import-editor input {
  border: 1px solid #bbb;
  border-radius: 6px;
  padding: 6px;
}
</style>
