<script setup>
import { eventArtistTypeKeys, artistTypeLabels } from '@/lib/artistFilters';
import { supabase } from '@/config/supabase';
import { allRows, rpc } from '@/lib/api';
import { findSimilarEvents } from '@/lib/event-similarity';
import { ACTIVITY_TYPES } from '@/lib/activity-types';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { loadEventWorkspace, EVENT_STATUSES, manageEvents } from '@/lib/events';
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
  sort = ref('today-first');
const trashOpen = ref(false);
const deletedEvents = computed(() => workspace.value.deletedEvents || []);
const trashDate = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '等待安排';
const selected = ref([]), actionBusy = ref(false);
const selectable = computed(() => filtered.value.map((event) => event.id));
function toggleAll(e) {
  selected.value = e.target.checked ? [...selectable.value] : [];
}
async function runAction(ids, operation) {
  if (!ids.length || actionBusy.value) return;
  const label = operation === 'delete' ? '移入回收站（3天后自动清除）' : operation === 'restore' ? '恢复为草稿' : '即刻发布';
  if (!window.confirm(`确定${label} ${ids.length} 个活动？`)) return;
  actionBusy.value = true;
  error.value = '';
  try {
    if (operation === 'restore') await rpc('chob_restore_events', { event_ids: ids });
    else await manageEvents(ids, operation);
    selected.value = [];
    notice.value = `已${label} ${ids.length} 个活动。`;
    await load();
  } catch (e) { error.value = e.message; }
  finally { actionBusy.value = false; }
}
async function mergePair(pair, keepId) {
  if (actionBusy.value || pair.events.length !== 2) return;
  const keep = pair.events.find(e => e.id === keepId);
  if (!keep || pair.events.some(e => e.date !== keep.date || (e.attributes?.end_date || e.date) !== (keep.attributes?.end_date || keep.date))) {
    error.value = '不同日期或场次请分别保留。'; return;
  }
  if (!window.confirm('确认这两条是同一活动，并已在保留活动中核对完整阵容与信息？\n保留：' + keep.title + '\n另一条将撤回，收藏、事项和来源将关联到保留活动。')) return;
  actionBusy.value = true; error.value = '';
  try {
    await rpc('chob_review_duplicates', {record_ids: pair.events.map(e => e.id), keep_id: keepId, decision: 'merge'});
    selected.value = []; notice.value = '已合并同一活动，收藏、事项和来源关系已保留。'; await load();
  } catch (e) { error.value = e.message; }
  finally { actionBusy.value = false; }
}
const companies = computed(() =>
  [
    ...new Set(workspace.value.events.map((e) => e.company).filter(Boolean)),
  ].sort(),
);
const artistTypes = computed(() =>
  [
    ...new Set(
      workspace.value.events
        .flatMap(e => eventArtistTypeKeys(e, workspace.value.artists))
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
      pairs: workspace.value.pairs || [],
      search: search.value,
      status: status.value,
      company: company.value,
      type: eventType.value,
      artistType: artistType.value,
      sort: sort.value,
    },
  ),
);
const similarPage = ref(1), similarOpen = ref(false);
function onSimilarToggle(event) {
  if (event.target.isConnected) similarOpen.value = event.target.open;
}
const ignoredRecords = ref([]), ignoreBusy = ref(false), ignoredOpen = ref(false), ignoredPage = ref(1);
const ignoredKeys = computed(() => new Set(ignoredRecords.value.map(r => r.event_a + ':' + r.event_b)));
const ignoredPairs = computed(() => ignoredRecords.value.map(r => ({...r, key: r.event_a + ':' + r.event_b, events: [r.event_a,r.event_b].map(id => workspace.value.events.find(e => e.id === id)).filter(Boolean)})).filter(p => p.events.length === 2));
async function setIgnored(pair, ignore) {
  if (ignoreBusy.value) return;
  ignoreBusy.value = true; error.value = '';
  const [a,b] = pair.key.split(':');
  try {
    const result = ignore
      ? await supabase.from('chob_similarity_ignores').insert({event_a:a,event_b:b})
      : await supabase.from('chob_similarity_ignores').delete().eq('event_a',a).eq('event_b',b);
    if (result.error && !(ignore && result.error.code === '23505')) throw result.error;
    ignoredRecords.value = await allRows('chob_similarity_ignores');
    notice.value = ignore ? '已忽略这对活动，可在“已忽略”中恢复。' : '已恢复相似活动检查。';
  } catch(e) { error.value = '操作失败：' + e.message; }
  finally { ignoreBusy.value = false; }
}
const allSimilarPairs = computed(() => findSimilarEvents(workspace.value.events));
const similarPairs = computed(() => {
  const ids = new Set(filtered.value.map(e => e.id));
  return allSimilarPairs.value.filter(p => !ignoredKeys.value.has(p.key) && p.events.some(e => ids.has(e.id)));
});
const visibleSimilar = computed(() => similarPairs.value.slice(0, similarPage.value * 10));

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
  selected.value = [];
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
    const [nextWorkspace, nextIgnored] = await Promise.all([loadEventWorkspace(), allRows('chob_similarity_ignores')]);
    workspace.value = nextWorkspace;
    ignoredRecords.value = nextIgnored;
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
      <section v-if="!isTasks" class="border rounded-xl p-4 space-y-3">
        <button class="btn-secondary" @click="trashOpen = !trashOpen">{{ trashOpen ? '收起' : '打开' }}已删除活动 · 回收站（{{ deletedEvents.length }}）</button>
        <template v-if="trashOpen">
          <p class="text-sm text-gray-500">删除后保留3天，到期自动清除（每5分钟检查）。恢复后活动及事项均为草稿，确认后可重新发布。</p>
          <p v-if="!deletedEvents.length" class="text-gray-500">回收站为空。</p>
          <article v-for="event in deletedEvents" :key="event.id" class="border rounded-lg p-3 flex flex-wrap justify-between gap-3">
            <div><p class="font-semibold">{{ event.title || '未命名活动' }}</p><p class="text-sm">活动日期：{{ event.date }} · 删除时间：{{ trashDate(event.attributes.admin_deleted_at) }}</p><p class="text-sm text-gray-500">自动清除：{{ trashDate(event.trash_expires_at) }}</p></div>
            <button class="btn-secondary" :disabled="actionBusy || new Date(event.trash_expires_at) <= new Date()" @click="runAction([event.id], 'restore')">恢复为草稿</button>
          </article>
        </template>
      </section>
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
            <option value="past">过往活动</option>
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
            <option v-for="t in artistTypes" :key="t" :value="t">{{ artistTypeLabels[t] || t }}</option>
          </select>
          <select v-model="sort" aria-label="排序" class="input-field sm:!w-48">
            <option value="today-first">今天起的活动优先</option>
            <option value="date-asc">活动日期：从近到远</option>
            <option value="date-desc">活动日期：从远到近</option>
            <option value="created_at-desc">录入时间：最新优先</option>
            <option value="artist-asc">艺人名称：升序</option>
            <option value="title-asc">活动名称：升序</option>
            <option value="company-asc">公司：升序</option>
            <option value="type-asc">活动类型：升序</option></select
          ><button class="btn-secondary" @click="load">刷新</button>
        </div>
        <details :open="similarOpen" @toggle="onSimilarToggle" class="bg-white rounded-xl border p-4">
          <summary class="cursor-pointer font-semibold">相似活动（≥80%） · {{ similarPairs.length }} 对</summary>
          <p class="text-sm text-gray-500 my-3">按名称、重叠日期和艺人综合比较，仅供查重参考。保留当前筛选命中的活动及其相似记录；不同日期的独立场次不列入。</p>
          <article v-for="pair in visibleSimilar" :key="pair.key" class="border-t py-4">
            <button class="btn-secondary mb-2" :disabled="ignoreBusy" @click="setIgnored(pair, true)">忽略：不是重复活动</button>
            <p class="font-semibold">相似度 {{ pair.percent }}% <small class="font-normal text-gray-500">名称 {{ pair.titlePercent }}% · 艺人 {{ pair.artistPercent }}% · 日期重叠</small></p>
            <div class="grid md:grid-cols-2 gap-3 mt-2">
              <div v-for="event in pair.events" :key="event.id" class="rounded-lg bg-gray-50 p-3">
                <p class="font-semibold">{{ event.title }}</p>
                <p>{{ eventArtistNames(event, workspace.artists) || '未关联艺人' }}</p>
                <p class="text-sm text-gray-500">{{ event.date }}<span v-if="event.attributes?.end_date"> — {{ event.attributes.end_date }}</span> · {{ event.time || '时间待定' }} · {{ event.location || '场地待定' }} · {{ EVENT_STATUSES[event.status] || event.status }}</p>
                <button class="btn-ghost" @click="edit(event)">编辑</button>
                <button class="btn-ghost" :disabled="actionBusy" @click="mergePair(pair, event.id)">合并并保留此活动</button>
                <button class="btn-ghost text-red-700" :disabled="actionBusy" @click="runAction([event.id], 'delete')">删除</button>
              </div>
            </div>
          </article>
          <p v-if="!similarPairs.length" class="text-gray-500">暂无达到 80% 的相似活动。</p>
          <button v-if="visibleSimilar.length < similarPairs.length" class="btn-secondary mt-3" @click="similarPage++">显示更多</button>
        </details>
        <details :open="ignoredOpen" @toggle="e => { if (e.target.isConnected) ignoredOpen = e.target.open; }" class="bg-white rounded-xl border p-4">
          <summary class="cursor-pointer font-semibold">已忽略 · {{ ignoredPairs.length }} 对</summary>
          <p class="text-sm text-gray-500 my-3">已确认不重复的活动组合，后台成员共享；忽略不会删除活动。</p>
          <article v-for="pair in ignoredPairs.slice(0, ignoredPage * 10)" :key="pair.key" class="border-t py-3">
            <div v-for="event in pair.events" :key="event.id" class="my-2">
              <strong>{{ event.title }}</strong> · {{ event.date }}<span v-if="event.attributes?.end_date"> — {{ event.attributes.end_date }}</span>
              <p class="text-sm text-gray-500">{{ eventArtistNames(event, workspace.artists) }} · {{ event.location || '场地待定' }}</p>
              <button class="btn-ghost" @click="edit(event)">编辑</button>
            </div>
            <button class="btn-secondary" :disabled="ignoreBusy" @click="setIgnored(pair, false)">恢复检查</button>
          </article>
          <p v-if="!ignoredPairs.length" class="text-gray-500 mt-3">暂无已忽略活动。</p>
          <button v-if="ignoredPairs.length > ignoredPage * 10" class="btn-secondary" @click="ignoredPage++">显示更多</button>
        </details>
        <div class="flex flex-wrap items-center gap-3">
          <label><input type="checkbox" :checked="!!selectable.length && selected.length === selectable.length" @change="toggleAll" /> 全选当前筛选结果</label>
          <button class="btn-secondary" :disabled="actionBusy || !selected.length" @click="runAction(selected, 'publish')">批量即刻发布</button>
          <button class="btn-secondary text-red-700" :disabled="actionBusy || !selected.length" @click="runAction(selected, 'delete')">批量删除</button>
        </div>
        <div class="bg-white rounded-xl border overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 text-gray-500">
              <tr>
                <th class="p-4">选择</th>
                <th class="p-4">艺人 / 活动</th>
                <th class="p-4">活动日期</th>
                <th class="p-4">状态</th>
                <th class="p-4">参与事项</th>
                <th class="p-4">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="event in visible" :key="event.id">
                <td class="p-4"><input v-model="selected" type="checkbox" :value="event.id" :aria-label="`选择${event.title}`" /></td>
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
                    >连续多日</small
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
                  <button class="btn-ghost text-red-700" :disabled="actionBusy" @click="runAction([event.id], 'delete')">删除</button>
                </td>
              </tr>
              <tr v-if="!visible.length">
                <td colspan="6" class="p-12 text-center text-gray-500">
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
