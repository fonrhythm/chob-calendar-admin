<script setup>
import { publishTimestamp, localDateTime } from '../lib/publishing';
import CatalogPicker from './CatalogPicker.vue';
import ArtistMatchPicker from './ArtistMatchPicker.vue';
import { selectionTypes, selectionCompanies } from '../lib/artist-selection';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ACTIVITY_TYPES, activityCategory } from '@/lib/activity-types';
import { rpc } from '@/lib/api';
import ArtistMultiSelect from './ArtistMultiSelect.vue';
import { newEvent, saveEventWithTasks } from '@/lib/events';
import { eventTime, imageUrls, recordLabel } from '@/lib/event-fields';
import { newTask, TASK_TYPES, taskCategory, safeWebUrl } from '@/lib/tasks';
const props = defineProps({
  event: Object,
  tasks: Array,
  artists: Array,
  types: Array,
  conditions: Array,
  pairs: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'saved']);
const dialog = ref(null),
  previous = document.activeElement;
const form = ref(
  props.event
    ? {
        ...newEvent(),
        ...JSON.parse(JSON.stringify(props.event)),
        artist_ids: [...(props.event.artist_ids || [])],
      }
    : newEvent(),
);
form.value.attributes = { ...(form.value.attributes || {}) };
const tasks = ref(JSON.parse(JSON.stringify(props.tasks || [])));
tasks.value = tasks.value.map((task) => ({
  ...task,
  task_type: taskCategory(task.task_type),
}));
form.value.attributes.activity_category = activityCategory(
  form.value.attributes.activity_category ||
    props.types?.find((t) => t.id === form.value.event_type_id)?.name,
);
form.value.attributes.cp_ids ||= [];
form.value.attributes.artist_types =
  form.value.attributes.artist_types ||
  (form.value.attributes.artist_type
    ? [form.value.attributes.artist_type]
    : []);
const catalog = computed(() => [
  ...(props.artists || []),
  ...props.pairs
    .filter((p) => !p.deleted_at)
    .map((p) => ({
      id: 'cp:' + p.id,
      name: p.cp_name,
      categories: ['CP'],
      member_ids: [p.artist_1_id, p.artist_2_id],
    })),
]);
const cpMembers = new Set(
  props.pairs
    .filter((p) => (form.value.attributes.cp_ids || []).includes(p.id))
    .flatMap((p) => [p.artist_1_id, p.artist_2_id]),
);
const selectedEntities = ref(
  form.value.attributes.artist_selections || [
    ...form.value.artist_ids.filter((id) => !cpMembers.has(id)),
    ...form.value.attributes.cp_ids.map((id) => 'cp:' + id),
  ],
);
const pictureText = ref((form.value.attributes.picture_urls || []).join('\n'));
const timeText = ref(
  form.value.attributes.time_text || form.value.time?.slice(0, 5) || '',
);
const initial = JSON.stringify([
  form.value,
  tasks.value,
  pictureText.value,
  timeText.value,
  selectedEntities.value,
]);
const newDate = ref(form.value.attributes.postponed_to_date || ''),
  datePending = ref(!form.value.attributes.postponed_to_date),
  notifyUsers = ref(false),
  sourceUrl = ref(''),
  publishNotice = ref(false),
  noticeBody = ref(''),
  noticeSource = ref('');
const busy = ref(false),
  error = ref(''),
  tried = ref(false),
  broken = ref({});
const dirty = computed(
  () =>
    initial !==
    JSON.stringify([
      form.value,
      tasks.value,
      pictureText.value,
      timeText.value,
      selectedEntities.value,
    ]),
);
const pictures = computed(() => imageUrls(pictureText.value));
const artistTypes = computed(() => [
  ...new Set(
    [
      '演员',
      '歌手',
      'CP',
      '组合',
      '乐队',
      ...(props.artists || []).flatMap((a) => a.categories || []),
      form.value.attributes.artist_type,
    ].filter(Boolean),
  ),
]);
const regions = computed(() => [
  ...new Set(
    ['泰国', '其他国家或地区', '线上', form.value.attributes.region].filter(
      Boolean,
    ),
  ),
]);
async function postpone() {
  if (!props.event || busy.value) return;
  if (!window.confirm(datePending.value ? '将原活动标记为延期，日期另行通知？' : '保留原日期的延期记录，并创建或更新关联的新日期活动？')) return;
  busy.value = true;
  error.value = '';
  try {
    await rpc('chob_set_postponement', {
      target: props.event.id,
      new_date: datePending.value ? null : newDate.value,
      notify_users: notifyUsers.value,
      source_url: sourceUrl.value,
    });
    emit('saved');
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function close() {
  if (
    !busy.value &&
    (!dirty.value || window.confirm('关闭后，未保存的修改会丢失。确定关闭？'))
  )
    emit('close');
}
function cancel(e) {
  e.preventDefault();
  close();
}
function removeTask(index) {
  if (window.confirm('移除此事项？保存后生效。')) tasks.value.splice(index, 1);
}
function beforeUnload(e) {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
const publishMode = ref(form.value.scheduled_publish_at ? 'later' : 'now'),
  publishAt = ref(localDateTime(form.value.scheduled_publish_at));
const unresolved = ref(form.value.attributes.unmatched_import_names || []),
  resolutions = ref({});
async function save(status) {
  if (busy.value) return;
  tried.value = true;
  busy.value = true;
  error.value = '';
  let scheduledAt = null;
  try {
    if (status === 'published' && publishMode.value === 'later')
      scheduledAt = publishTimestamp(publishAt.value);
  } catch (e) {
    error.value = e.message;
    busy.value = false;
    return;
  }
  const resolvedIds = Object.values(resolutions.value).filter(Boolean);
  const chosen = [...new Set([...selectedEntities.value, ...resolvedIds])];
  const payload = {
    ...form.value,
    artist_ids: [
      ...new Set(
        chosen.flatMap(
          (id) => catalog.value.find((a) => a.id === id)?.member_ids || [id],
        ),
      ),
    ],
    company: selectionCompanies(catalog.value, chosen),
    status,
    scheduled_publish_at: scheduledAt,
    time: eventTime(timeText.value),
    attributes: {
      ...form.value.attributes,
      unmatched_import_names: unresolved.value.filter(
        (n) => !resolutions.value[n],
      ),
      artist_type: selectionTypes(catalog.value, chosen)[0] || '',
      artist_types: selectionTypes(catalog.value, chosen),
      artist_selections: chosen,
      cp_ids: chosen
        .filter((id) => id.startsWith('cp:'))
        .map((id) => id.slice(3)),
      time_text: timeText.value.trim(),
      picture_urls: pictures.value,
    },
  };
  try {
    await saveEventWithTasks(
      payload,
      tasks.value,
      publishNotice.value && status === 'published' && !scheduledAt
        ? {
            title: payload.title + '变动',
            body: noticeBody.value,
            source_url: noticeSource.value,
          }
        : null,
    );
    emit('saved');
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  dialog.value.showModal();
  window.addEventListener('beforeunload', beforeUnload);
});
onUnmounted(() => {
  previous?.focus?.();
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>
<template>
  <dialog
    ref="dialog"
    @cancel="cancel"
    aria-labelledby="event-dialog-title"
    class="event-dialog"
  >
    <form
      @submit.prevent="save('published')"
      @input="error = ''"
      class="event-form"
    >
      <header>
        <h2 id="event-dialog-title">{{ event ? '编辑活动' : '新增活动' }}</h2>
        <button
          type="button"
          :disabled="busy"
          @click="close"
          aria-label="关闭"
          class="close"
        >
          ×
        </button>
      </header>
      <div class="event-body">
        <fieldset :disabled="busy">
          <CatalogPicker v-model="selectedEntities" :catalog="catalog" />
          <section v-if="unresolved.length">
            <h3>待匹配艺人</h3>
            <ArtistMatchPicker
              v-for="name in unresolved"
              :key="name"
              v-model="resolutions[name]"
              :catalog="catalog"
              :original-name="name"
            />
          </section>
          <label class="field"
            >活动名称 <b>*</b
            ><input
              v-model="form.title"
              aria-label="活动名称"
              required
              maxlength="200"
          /></label>
          <label class="field"
            >活动类型<select
              v-model="form.attributes.activity_category"
              aria-label="活动类型"
            >
              <option value="">请选择</option>
              <option v-for="t in ACTIVITY_TYPES" :key="t.id" :value="t.id">
                {{ recordLabel(t) }}
              </option>
            </select></label
          >
          <label class="field"
            >活动状态<select v-model="form.attributes.event_status">
              <option value="active">正常</option>
              <option value="cancelled">已取消</option>
              <option value="postponed">已延期</option>
            </select></label
          ><label class="field"
            >点名
            <input
              style="
                width: 16px;
                height: 16px;
                min-height: 0;
                display: inline-block;
              "
              type="checkbox"
              v-model="form.attributes.roll_call"
          /></label>
          <section v-if="event" class="task-panel">
            <h3>活动延期</h3>
            <p class="section-help">
              将关联原记录与新记录，已收藏和已添加的个人事项会跟随新日期。请先保存其他字段修改，再操作延期。
            </p>
            <input
              v-model="newDate"
              type="date"
              :disabled="datePending"
              aria-label="延期后的新日期"
            /><label class="block mt-3"><input v-model="datePending" type="checkbox" />日期另行通知</label><label class="block mt-3"
              ><input
                v-model="notifyUsers"
                type="checkbox"
              />同时发布延期公告</label
            ><input
              v-if="notifyUsers"
              v-model="sourceUrl"
              type="url"
              placeholder="消息来源 https://..."
            /><button
              type="button"
              class="add-task mt-3"
              :disabled="busy || (!datePending && !newDate) || dirty"
              @click="postpone"
            >
              保存延期状态
            </button>
          </section>
          <label class="field"
            >日期 <b>*</b
            ><input
              v-model="form.date"
              aria-label="活动日期"
              type="date"
              required
          /></label>
          <label class="field"
            >时间<input
              v-model="timeText"
              aria-label="活动时间"
              maxlength="100"
              placeholder="13:00 / 10:00 - 21:00"
            /><small>按泰国时间填写，支持时间段或“待定”。</small></label
          >
          <label class="field"
            >地区 <b>*</b
            ><select
              v-model="form.attributes.region"
              aria-label="地区"
              required
            >
              <option :value="undefined">请选择</option>
              <option v-for="value in regions" :key="value">{{ value }}</option>
            </select></label
          >
          <label class="field"
            >城市 / 线上直播 <b>*</b
            ><input
              v-model="form.location_region"
              aria-label="城市或线上直播"
              required
              maxlength="200"
              placeholder="填写城市名或“非公开”，如果是线上直播直接填“线上直播”"
          /></label>
          <label class="field"
            >场地 <b>*</b
            ><input
              v-model="form.location"
              aria-label="场地"
              required
              maxlength="200"
              placeholder="填写场地；线上活动填写直播平台"
          /></label>
          <label class="field"
            >参与方式 <b>*</b
            ><select
              v-model="form.participation_condition"
              aria-label="参与方式"
              required
            >
              <option value="">请选择</option>
              <option v-for="c in conditions.filter((item) => !/仅获得资格者/.test(recordLabel(item)) || form.participation_condition === item.code)" :key="c.code" :value="c.code">
                {{ recordLabel(c) }}
              </option>
            </select></label
          >
          <div class="field">
            <label for="event-pictures">活动图片</label
            ><textarea
              id="event-pictures"
              v-model="pictureText"
              rows="3"
              placeholder="每行一条公开图片链接，最多 9 张"
            ></textarea
            ><small :class="{ 'error-text': pictures.length > 9 }"
              >{{ pictures.length }} / 9</small
            >
            <div class="picture-grid">
              <div v-for="url in pictures.slice(0, 9)" :key="url">
                <img
                  v-if="safeWebUrl(url) && !broken[url]"
                  :src="url"
                  alt="活动图片预览"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="broken[url] = true"
                /><span v-else>链接无法预览</span>
              </div>
            </div>
          </div>
          <label class="field"
            >备注<textarea
              v-model="form.attributes.note"
              aria-label="备注"
              rows="3"
            ></textarea>
          </label>
          <label class="field"
            >活动详情与参与规则<textarea
              v-model="form.description"
              aria-label="活动详情与参与规则"
              rows="4"
              placeholder="填写名额、消费计算、参与资格、官方说明等。"
            ></textarea>
          </label>
          <label class="field"
            >活动链接（购票或原文）<input
              v-model="form.ticket_url"
              aria-label="活动链接"
              type="url"
              placeholder="https://..."
          /></label>
          <section class="task-panel">
            <label
              ><input
                v-model="publishNotice"
                type="checkbox"
              />保存后通知用户（发布到消息／公告）</label
            ><template v-if="publishNotice"
              ><label class="field"
                >变动说明<textarea
                  v-model="noticeBody"
                  required
                ></textarea></label
              ><label class="field"
                >消息来源<input
                  v-model="noticeSource"
                  type="url"
                  placeholder="https://..." /></label
            ></template>
          </section>
          <section class="tasks-section">
            <div class="section-heading">
              <h3>参与事项</h3>
              <button
                type="button"
                class="add-task"
                @click="tasks.push(newTask())"
              >
                ＋ 添加事项
              </button>
            </div>
            <p class="section-help">
              事项分为消费、填表、开票、其他四类。每条事项有独立办理日期，点击后关联本活动详情。
            </p>
            <p v-if="!tasks.length" class="empty-tasks">
              暂无事项，无需提前办理的活动可以不添加。
            </p>
            <article
              v-for="(task, index) in tasks"
              :key="task.id"
              class="task-panel"
            >
              <div class="section-heading">
                <h4>事项 {{ index + 1 }}</h4>
                <button
                  type="button"
                  class="remove-task"
                  @click="removeTask(index)"
                >
                  移除
                </button>
              </div>
              <label class="field"
                >事项标题<input
                  v-model="task.title"
                  :aria-label="`事项${index + 1}标题`"
                  required
                  maxlength="200"
              /></label>
              <div class="task-grid">
                <label class="field"
                  >分类<select
                    v-model="task.task_type"
                    :aria-label="`事项${index + 1}分类`"
                  >
                    <option
                      v-for="t in TASK_TYPES"
                      :key="t.value"
                      :value="t.value"
                    >
                      {{ t.label }}
                    </option>
                  </select></label
                ><label class="field"
                  >状态<select
                    v-model="task.status"
                    :aria-label="`事项${index + 1}状态`"
                  >
                    <option value="draft">草稿</option>
                    <option value="published">发布</option>
                    <option value="withdrawn">撤回</option>
                  </select></label
                >
                <label class="field"
                  >开始日期<input
                    v-model="task.start_date"
                    :aria-label="`事项${index + 1}开始日期`"
                    type="date"
                    :required="
                      task.status === 'published' || !!task.start_time
                    " /></label
                ><label class="field"
                  >开始时间<input
                    v-model="task.start_time"
                    type="time"
                    step="1"
                  /><small>不填为当天 00:00</small></label
                ><label class="field"
                  >结束日期（开票可留空，售完即止）<input
                    v-model="task.end_date"
                    :aria-label="`事项${index + 1}结束日期`"
                    type="date"
                    :required="
                      (task.status === 'published' &&
                        task.task_type !== 'ticketing') ||
                      !!task.end_time
                    " /></label
                ><label class="field"
                  >结束时间<input
                    v-model="task.end_time"
                    type="time"
                    step="1"
                  /><small>不填为当天结束</small></label
                >
              </div>
              <label class="field"
                >操作链接<input
                  v-model="task.action_url"
                  type="url"
                  placeholder="https://..." /></label
              ><label class="field"
                >步骤说明<textarea
                  v-model="task.description"
                  rows="2"
                ></textarea>
              </label>
            </article>
          </section>
          <p class="section-help">
            待匹配艺人可以保存草稿；完成匹配后方可发布。事项是否公开取决于各自状态。仅供用户查看，无完成勾选。
          </p>
          <p v-if="form.cancelled_at" class="error-text">
            此活动已取消，提交仍保留取消状态。
          </p>
        </fieldset>
      </div>
      <div v-if="error" role="alert" class="form-problem">{{ error }}</div>
      <div class="publish-options">
        <label
          ><input
            type="radio"
            v-model="publishMode"
            value="now"
          />即刻发布</label
        ><label
          ><input
            type="radio"
            v-model="publishMode"
            value="later"
          />稍后发布</label
        ><label v-if="publishMode === 'later'"
          >发布时间（{{
            Intl.DateTimeFormat().resolvedOptions().timeZone
          }}）<input
            type="datetime-local"
            v-model="publishAt"
            :required="publishMode === 'later'"
        /></label>
      </div>
      <footer>
        <button
          type="button"
          class="draft"
          :disabled="busy"
          @click="save('draft')"
        >
          存草稿</button
        ><button type="button" class="cancel" :disabled="busy" @click="close">
          取消</button
        ><button type="submit" class="submit" :disabled="busy">
          {{
            busy ? '保存中…' : publishMode === 'later' ? '稍后发布' : '即刻发布'
          }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
<style scoped>
.artist-kind-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.artist-kind-options label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 400;
}
.event-dialog {
  width: min(780px, 94vw);
  max-height: 94dvh;
  padding: 0;
  border: 0;
  border-radius: 26px;
  background: #eeede9;
  color: #171817;
  box-shadow: 0 24px 90px #0003;
  margin: auto;
}
.event-dialog::backdrop {
  background: #0005;
  backdrop-filter: blur(3px);
}
.event-form {
  display: flex;
  flex-direction: column;
  max-height: 94dvh;
}
.event-form header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28px 32px 22px;
  flex-shrink: 0;
}
.event-form h2 {
  font-size: 25px;
  font-weight: 750;
}
.close {
  font-size: 32px;
  font-weight: 300;
  color: #8d8f88;
  line-height: 1;
  padding: 4px 12px;
}
.event-body {
  padding: 12px 32px 8px;
  overflow-y: auto;
  min-height: 0;
  scrollbar-gutter: stable;
}
.field {
  display: block;
  margin-bottom: 26px;
  font-weight: 650;
  font-size: 16px;
}
.field > input,
.field > select,
.field > textarea {
  display: block;
  width: 100%;
  background: white;
  border: 1px solid #e2dfd9;
  border-radius: 13px;
  padding: 14px 16px;
  margin-top: 10px;
  font-weight: 400;
  font-size: 16px;
  min-height: 54px;
  outline: none;
}
.field > input:focus,
.field > select:focus,
.field > textarea:focus {
  outline: 2px solid #b5b2aa;
  outline-offset: 1px;
}
.field > label {
  display: block;
  margin-bottom: 10px;
}
.field b {
  color: #e84d48;
}
.field small {
  display: block;
  color: #90908b;
  font-weight: 400;
  font-size: 13px;
  margin-top: 8px;
}
.event-form footer {
  display: flex;
  gap: 14px;
  padding: 16px 32px 22px;
  flex-shrink: 0;
}
.event-form footer button {
  flex: 1;
  padding: 15px 10px;
  border-radius: 15px;
  font-size: 16px;
}
.draft {
  background: #9b9c98;
  color: white;
}
.cancel {
  background: white;
  border: 1px solid #e2dfd9;
}
.submit {
  background: #6e706a;
  color: white;
}
.event-form button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.section-heading h3 {
  font-size: 20px;
  font-weight: 700;
}
.section-heading h4 {
  font-weight: 650;
}
.add-task {
  border: 1px solid #cbc8c0;
  border-radius: 10px;
  padding: 8px 12px;
  background: white;
  font-size: 14px;
}
.section-help,
.empty-tasks {
  color: #777970;
  font-size: 13px;
  line-height: 1.7;
  margin-bottom: 20px;
}
.task-panel {
  padding: 18px;
  background: #e5e3dd;
  border: 1px solid #d9d6ce;
  border-radius: 15px;
  margin-bottom: 20px;
}
.task-panel .field {
  margin-bottom: 16px;
  font-size: 14px;
}
.task-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}
.remove-task {
  color: #a34b43;
  font-size: 13px;
}
.picture-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 12px;
}
.picture-grid > div {
  aspect-ratio: 1;
  background: #deddd7;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 400;
}
.picture-grid img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.error-text {
  color: #b33b34 !important;
}
.form-problem {
  background: #fbe5e1;
  color: #9d332c;
  padding: 10px 24px;
  font-size: 14px;
  flex-shrink: 0;
}
.tasks-section {
  border-top: 1px solid #d7d4cc;
  padding-top: 24px;
}
@media (max-width: 520px) {
  .event-dialog {
    width: 96vw;
    border-radius: 20px;
  }
  .event-form header {
    padding: 20px 18px 14px;
  }
  .event-body {
    padding: 8px 18px;
  }
  .event-form footer {
    padding: 12px 18px 16px;
    gap: 8px;
  }
  .event-form h2 {
    font-size: 22px;
  }
  .task-grid {
    grid-template-columns: 1fr;
  }
  .field {
    margin-bottom: 22px;
  }
}
.publish-options {
  padding: 12px 24px;
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.publish-options label {
  display: flex;
  gap: 6px;
  align-items: center;
}
.publish-options input[type='radio'] {
  width: 16px;
  height: 16px;
}
</style>
