<script setup>
import { ACTIVITY_TYPES } from '@/lib/activity-types';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { loadEventWorkspace, EVENT_STATUSES } from '@/lib/events';
import {
  bangkokDate,
  compareTasks,
  taskCategory,
  TASK_TYPES,
  taskActiveOn,
  taskLabel,
} from '@/lib/tasks';
import EventFormModal from '@/components/EventFormModal.vue';
import EventImportModal from '@/components/EventImportModal.vue';
import {
  eventArtistNames,
  filterSortEvents,
  recordLabel,
} from '@/lib/event-fields';
const route = useRoute(),
  router = useRouter();
const workspace = ref({
  events: [],
  tasks: [],
  artists: [],
  types: [],
  conditions: [],
});
const loading = ref(true),
  error = ref(''),
  notice = ref(''),
  ready = ref(false),
  modal = ref(false),
  editing = ref(null);
const importOpen = ref(false),
  company = ref(''),
  eventType = ref(''),
  artistType = ref(''),
  sort = ref('date-asc');
const companies = computed(() =>
  [
    ...new Set(workspace.value.events.map((e) => e.company).filter(Boolean)),
  ].sort(),
);
const artistTypes = computed(() =>
  [
    ...new Set(
      workspace.value.events
        .flatMap(
          (e) => e.attributes?.artist_types || [e.attributes?.artist_type],
        )
        .filter(Boolean),
    ),
  ].sort(),
);
const search = ref(''),
  status = ref(''),
  page = ref(1),
  taskType = ref(''),
  date = ref(bangkokDate());
const isTasks = computed(() => route.name === 'Tasks');
const filtered = computed(() =>
  filterSortEvents(
    workspace.value.events,
    workspace.value.artists,
    workspace.value.types,
    {
      search: search.value,
      status: status.value,
      company: company.value,
      type: eventType.value,
      artistType: artistType.value,
      sort: sort.value,
    },
  ),
);
const visible = computed(() =>
  filtered.value.slice((page.value - 1) * 20, page.value * 20),
);
const totalPages = computed(() =>
  Math.max(1, Math.ceil(filtered.value.length / 20)),
);
const tasksForDate = computed(() =>
  workspace.value.tasks
    .filter(
      (t) =>
        taskActiveOn(t, date.value) &&
        (!taskType.value || taskCategory(t.task_type) === taskType.value),
    )
    .filter((t) => {
      const e = workspace.value.events.find((e) => e.id === t.event_id);
      return (
        e &&
        e.status === 'published' &&
        !e.cancelled_at &&
        (!e.scheduled_publish_at ||
          new Date(e.scheduled_publish_at) <= new Date())
      );
    })
    .sort(compareTasks),
);
const editingTasks = computed(() =>
  editing.value
    ? workspace.value.tasks.filter((t) => t.event_id === editing.value.id)
    : [],
);
watch([search, status, company, eventType, artistType, sort], () => {
  page.value = 1;
});
function edit(event = null) {
  editing.value = event;
  modal.value = true;
}
async function load() {
  loading.value = true;
  error.value = '';
  ready.value = false;
  try {
    workspace.value = await loadEventWorkspace();
    ready.value = true;
    page.value = Math.min(page.value, totalPages.value);
  } catch (e) {
    error.value = `读取失败：${e.message}。请确认已执行 004_event_form_import.sql。`;
  } finally {
    loading.value = false;
  }
}
async function saved() {
  modal.value = false;
  importOpen.value = false;
  notice.value = '活动与参与事项已一起保存。';
  await load();
}
function parentEvent(task) {
  return workspace.value.events.find((e) => e.id === task.event_id);
}
function openFromTask(task) {
  edit(parentEvent(task));
}
onMounted(load);
</script>
<template>
  <div class="space-y-6">
    <header class="flex flex-wrap gap-4 items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">
          {{ isTasks ? '事项展示预览' : '活动管理' }}
        </h1>
        <p class="text-gray-500 mt-2">
          {{
            isTasks
              ? '按泰国日期预览公开事项，点击卡片编辑所属活动。'
              : '管理活动与提前参与步骤，一处录入，关联展示。'
          }}
        </p>
      </div>
      <div class="flex gap-3">
        <button
          class="btn-secondary"
          :disabled="!ready || loading"
          @click="importOpen = true"
        >
          批量导入</button
        ><button
          class="btn-primary"
          :disabled="!ready || loading"
          @click="edit()"
        >
          ＋ 新建活动
        </button>
      </div>
    </header>
    <p
      v-if="notice"
      role="status"
      class="bg-green-50 text-green-800 p-3 rounded-lg"
    >
      {{ notice }}
    </p>
    <div
      v-if="error"
      role="alert"
      class="bg-red-50 text-red-700 p-4 rounded-lg"
    >
      {{ error }} <button class="underline ml-2" @click="load">重试</button>
    </div>
    <p v-if="loading" role="status" class="p-8 text-gray-500">
      正在加载活动与事项…
    </p>
    <template v-else-if="ready">
      <template v-if="!isTasks">
        <div class="flex flex-wrap gap-3">
          <input
            v-model="search"
            aria-label="搜索活动"
            placeholder="搜索艺人、活动、场地、公司"
            class="input-field sm:!w-80"
          /><select
            v-model="status"
            aria-label="活动状态"
            class="input-field sm:!w-44"
          >
            <option value="">全部状态</option>
            <option
              v-for="(label, value) in EVENT_STATUSES"
              :key="value"
              :value="value"
            >
              {{ label }}
            </option></select
          ><select
            v-model="company"
            aria-label="公司筛选"
            class="input-field sm:!w-44"
          >
            <option value="">全部公司</option>
            <option v-for="c in companies" :key="c">{{ c }}</option>
          </select>
          <select
            v-model="eventType"
            aria-label="活动类型筛选"
            class="input-field sm:!w-44"
          >
            <option value="">全部活动类型</option>
            <option v-for="t in ACTIVITY_TYPES" :key="t.id" :value="t.id">
              {{ recordLabel(t) }}
            </option>
          </select>
          <select
            v-model="artistType"
            aria-label="艺人类别筛选"
            class="input-field sm:!w-44"
          >
            <option value="">全部艺人类别</option>
            <option v-for="t in artistTypes" :key="t">{{ t }}</option>
          </select>
          <select v-model="sort" aria-label="排序" class="input-field sm:!w-48">
            <option value="date-asc">活动日期：从近到远</option>
            <option value="date-desc">活动日期：从远到近</option>
            <option value="created_at-desc">录入时间：最新优先</option>
            <option value="artist-asc">艺人名称：升序</option>
            <option value="title-asc">活动名称：升序</option>
            <option value="company-asc">公司：升序</option>
            <option value="type-asc">活动类型：升序</option></select
          ><button class="btn-secondary" @click="load">刷新</button>
        </div>
        <div class="bg-white rounded-xl border overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 text-gray-500">
              <tr>
                <th class="p-4">艺人 / 活动</th>
                <th class="p-4">活动日期</th>
                <th class="p-4">状态</th>
                <th class="p-4">参与事项</th>
                <th class="p-4">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="event in visible" :key="event.id">
                <td class="p-4">
                  <p class="font-semibold">
                    {{
                      eventArtistNames(event, workspace.artists) || '未关联艺人'
                    }}
                  </p>
                  <p class="mt-1">{{ event.title }}</p>
                  <p class="text-gray-500 mt-1">
                    {{ event.location || '场地待定' }}
                  </p>
                </td>
                <td class="p-4 whitespace-nowrap">
                  {{ event.date || '日期待定' }}<br /><span
                    class="text-gray-500"
                    >{{
                      event.attributes?.time_text || event.time?.slice(0, 5)
                    }}</span
                  >
                </td>
                <td class="p-4">
                  <span
                    class="badge"
                    :class="
                      event.status === 'published'
                        ? 'badge-success'
                        : 'badge-warning'
                    "
                    >{{
                      event.cancelled_at ||
                      event.attributes?.event_status === 'cancelled'
                        ? '已取消'
                        : event.attributes?.event_status === 'postponed'
                          ? '已延期'
                          : EVENT_STATUSES[event.status] || event.status
                    }}</span
                  ><small
                    v-if="event.attributes?.recurring_daily"
                    class="block mt-1"
                    >每天重复</small
                  >
                </td>
                <td class="p-4">
                  {{
                    workspace.tasks.filter((t) => t.event_id === event.id)
                      .length
                  }}
                  条
                </td>
                <td class="p-4">
                  <button
                    class="btn-ghost whitespace-nowrap"
                    @click="edit(event)"
                  >
                    编辑
                  </button>
                </td>
              </tr>
              <tr v-if="!visible.length">
                <td colspan="5" class="p-12 text-center text-gray-500">
                  {{
                    workspace.events.length
                      ? '没有符合条件的活动。'
                      : '还没有活动。点击“新建活动”开始录入。'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex justify-between items-center text-sm">
          <span>共 {{ filtered.length }} 个活动</span>
          <div class="flex gap-3 items-center">
            <button class="btn-secondary" :disabled="page <= 1" @click="page--">
              上一页</button
            ><span>{{ page }} / {{ totalPages }}</span
            ><button
              class="btn-secondary"
              :disabled="page >= totalPages"
              @click="page++"
            >
              下一页
            </button>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="flex flex-wrap gap-3">
          <label
            >查看日期<input
              v-model="date"
              type="date"
              class="input-field mt-1" /></label
          ><label
            >事项分类<select v-model="taskType" class="input-field mt-1">
              <option value="">全部分类</option>
              <option v-for="t in TASK_TYPES" :key="t.value" :value="t.value">
                {{ t.label }}
              </option>
            </select></label
          >
        </div>
        <p class="text-sm text-gray-500">
          事项分类：消费、填表、开票、其他。同类按截止时间排序；此处显示当天覆盖的事项，包括当天已经截止的事项。
        </p>
        <div class="grid lg:grid-cols-2 gap-4">
          <button
            v-for="task in tasksForDate"
            :key="task.id"
            class="card-hover text-left space-y-3"
            @click="openFromTask(task)"
          >
            <span class="badge badge-primary">{{
              taskLabel(task.task_type)
            }}</span>
            <h2 class="font-bold text-lg">{{ task.title }}</h2>
            <p class="font-semibold">
              {{ eventArtistNames(parentEvent(task), workspace.artists) }}
            </p>
            <p>{{ parentEvent(task)?.title }}</p>
            <p class="text-sm text-gray-600">
              办理期间：{{ task.start_date }}
              {{ task.start_time?.slice(0, 5) }} — {{ task.end_date }}
              {{ task.end_time?.slice(0, 5) }}
            </p>
            <p class="text-sm font-semibold">
              活动举行：{{ parentEvent(task)?.date || '待定' }}
            </p>
            <span class="text-primary-600 text-sm"
              >编辑所属活动与参与规则 →</span
            >
          </button>
        </div>
        <div v-if="!tasksForDate.length" class="card text-gray-500">
          该日期没有公开事项。草稿、已撤回事项，以及未公开活动下的事项不会显示。<button
            class="text-primary-600 underline ml-2"
            @click="router.push('/events')"
          >
            前往活动管理
          </button>
        </div>
      </template>
    </template>
    <EventImportModal
      v-if="importOpen"
      :workspace="workspace"
      @close="importOpen = false"
      @imported="load"
      @saved="saved"
    />
    <EventFormModal
      v-if="modal"
      :event="editing"
      :tasks="editingTasks"
      :artists="workspace.artists"
      :types="workspace.types"
      :conditions="workspace.conditions"
      :pairs="workspace.pairs"
      @close="modal = false"
      @saved="saved"
    />
  </div>
</template>
