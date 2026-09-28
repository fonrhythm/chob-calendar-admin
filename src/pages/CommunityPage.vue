<script setup>
import { ref, computed, onMounted } from 'vue';
import { allRows, rpc } from '@/lib/api';
const reports = ref([]),
  events = ref([]),
  notices = ref([]),
  error = ref(''),
  message = ref(''),
  busy = ref(false),
  tab = ref('corrections'),
  forms = ref({}),
  noticeForms = ref({}),
  editingNotice = ref(''),
  newNotice = ref({ title: '', body: '', source_url: '', event_id: null });
const title = (id) => events.value.find((e) => e.id === id)?.title || '活动';
const pending = computed(() =>
  reports.value.filter((r) => r.status === 'pending'),
);
const unmatched = computed(() =>
  events.value.filter(
    (e) => e.attributes?.unmatched_artist && !e.attributes?.artist_reviewed,
  ),
);
const duplicates = computed(() => {
  const groups = new Map();
  for (const e of events.value.filter(
    (e) => e.status !== 'withdrawn' && !e.attributes?.duplicate_reviewed,
  )) {
    const key = JSON.stringify([
      e.title.trim().toLowerCase(),
      e.date,
      (e.location || '').trim().toLowerCase(),
      [...(e.artist_ids || [])].sort(),
    ]);
    groups.set(key, [...(groups.get(key) || []), e]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
});
const fields = {
  name: '艺人',
  activity: '活动名称',
  date: '日期',
  time: '时间',
  venue: '地点',
  city: '城市',
  company: '公司',
  note: '备注',
  images: '图片链接（每行一条）',
  link: '来源链接',
};
async function load() {
  try {
    [reports.value, events.value, notices.value] = await Promise.all([
      allRows('chob_corrections'),
      allRows('events'),
      allRows('chob_announcements'),
    ]);
    for (const notice of notices.value)
      noticeForms.value[notice.id] = {
        id: notice.id,
        title: notice.title,
        body: notice.body,
        source_url: notice.source_url,
        event_id: notice.event_id,
        published: notice.published,
      };
    for (const r of reports.value)
      forms.value[r.id] ||= {
        decision: 'correct',
        response: '',
        changes: {},
        notify: false,
        source: '',
      };
  } catch (e) {
    error.value = e.message;
  }
}
async function perform(fn) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await fn();
    message.value = '处理已保存。';
    await load();
    return true;
  } catch (e) {
    error.value = e.message;
    return false;
  } finally {
    busy.value = false;
  }
}
function resolve(r) {
  const f = forms.value[r.id],
    changes = { ...f.changes };
  if (changes.images !== undefined)
    changes.images = changes.images
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  return perform(() =>
    rpc('chob_resolve_correction', {
      report_id: r.id,
      decision: f.decision,
      response: f.response,
      changes: f.decision === 'changed' ? changes : {},
      notify_users: f.notify,
      source_url: f.source,
    }),
  );
}
function duplicate(group, action) {
  if (
    !confirm(
      action === 'merge'
        ? '合并到第一条活动？其余记录将撤回，收藏和事项将关联到保留活动。'
        : action === 'withdraw'
          ? '撤回选中的重复活动？记录会保留在后台。'
          : '确认这些记录分别保留？',
    )
  )
    return;
  return perform(() =>
    rpc('chob_review_duplicates', {
      record_ids: group.map((e) => e.id),
      keep_id: group[0].id,
      decision: action,
    }),
  );
}
onMounted(load);
</script>
<template>
  <section class="space-y-5">
    <header>
      <h1 class="text-2xl font-bold">消息与核实</h1>
      <p class="text-gray-500 mt-2">
        处理纠错、新艺人和重复记录；公开公告会同步到前台。
      </p>
    </header>
    <p v-if="error" role="alert" class="text-red-700">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <nav class="flex flex-wrap gap-3">
      <button
        v-for="(label, key) in {
          corrections: '纠错',
          artists: '待匹配艺人',
          duplicates: '疑似重复',
          announcements: '消息 / 公告',
        }"
        :key="key"
        :class="tab === key ? 'btn-primary' : 'btn-secondary'"
        @click="tab = key"
      >
        {{ label }}</button
      ><button class="btn-secondary" @click="load">刷新</button>
    </nav>
    <template v-if="tab === 'corrections'"
      ><article v-for="r in pending" :key="r.id" class="card space-y-4">
        <h2 class="text-lg font-bold">{{ title(r.event_id) }}</h2>
        <p class="whitespace-pre-wrap">{{ r.content }}</p>
        <p class="text-gray-500">
          待核实：{{ r.fields.map((f) => fields[f]).join('、') }}
        </p>
        <form class="space-y-3" @submit.prevent="resolve(r)">
          <label class="block"
            >处理结果<select v-model="forms[r.id].decision" class="input-field">
              <option value="correct">原内容正确</option>
              <option value="changed">提出更正内容</option>
              <option value="other">其他（结束核实）</option>
            </select></label
          ><template v-if="forms[r.id].decision === 'changed'"
            ><label v-for="field in r.fields" :key="field" class="block"
              >{{ fields[field]
              }}<textarea
                v-model="forms[r.id].changes[field]"
                class="input-field"
                :placeholder="'填写核实后的' + fields[field]"
              ></textarea></label></template
          ><label class="block"
            >回复提交用户<textarea
              v-model="forms[r.id].response"
              class="input-field"
              required
              maxlength="4000"
            ></textarea></label
          ><label class="flex gap-2"
            ><input
              v-model="forms[r.id].notify"
              type="checkbox"
            />同时发布变动公告</label
          ><input
            v-if="forms[r.id].notify"
            v-model="forms[r.id].source"
            type="url"
            class="input-field"
            placeholder="消息来源 https://..."
          /><button :disabled="busy" class="btn-primary">完成核实并回复</button>
        </form>
      </article>
      <p v-if="!pending.length">没有待处理纠错。</p></template
    >
    <template v-else-if="tab === 'artists'"
      ><article v-for="e in unmatched" :key="e.id" class="card space-y-3">
        <h2>{{ e.title }}</h2>
        <p>用户填写的艺人：{{ e.attributes.unmatched_artist }}</p>
        <router-link to="/artists" class="underline"
          >前往艺人资料库补全</router-link
        >
        <p class="text-sm text-gray-500">
          补全艺人后，请在活动管理中选择对应艺人，再标记已处理。
        </p>
        <button
          class="btn-secondary"
          :disabled="busy"
          @click="perform(() => rpc('chob_review_artist', { target: e.id }))"
        >
          已匹配并完成处理
        </button>
      </article>
      <p v-if="!unmatched.length">没有待匹配艺人。</p></template
    >
    <template v-else-if="tab === 'duplicates'"
      ><article
        v-for="group in duplicates"
        :key="group[0].id"
        class="card space-y-3"
      >
        <h2>疑似重复活动</h2>
        <p v-for="e in group" :key="e.id">
          {{ e.title }} · {{ e.date }} · {{ e.location }}
          <button
            class="underline"
            :disabled="busy"
            @click="duplicate([e], 'withdraw')"
          >
            撤回此条
          </button>
        </p>
        <div class="flex gap-3">
          <button
            class="btn-primary"
            :disabled="busy"
            @click="duplicate(group, 'merge')"
          >
            合并并保留第一条</button
          ><button
            class="btn-secondary"
            :disabled="busy"
            @click="duplicate(group, 'keep')"
          >
            分别保留
          </button>
        </div>
      </article>
      <p v-if="!duplicates.length">
        没有待核实的重复活动。每天重复的连续活动按独立规则显示。
      </p></template
    >
    <template v-else
      ><form
        class="card space-y-3"
        @submit.prevent="
          perform(() =>
            rpc('chob_save_announcement', { payload: newNotice }),
          )
        "
      >
        <h2 class="font-bold">发布消息 / 公告</h2>
        <input
          v-model="newNotice.title"
          required
          maxlength="200"
          class="input-field"
          placeholder="xxx变动"
        /><textarea
          v-model="newNotice.body"
          required
          class="input-field"
          placeholder="变动内容"
        ></textarea
        ><input
          v-model="newNotice.source_url"
          type="url"
          class="input-field"
          placeholder="消息来源（支持 X 贴文链接）"
        /><select v-model="newNotice.event_id" class="input-field">
          <option :value="null">不关联活动</option>
          <option v-for="e in events" :key="e.id" :value="e.id">
            {{ e.title }} · {{ e.date }}
          </option></select
        ><button class="btn-primary" :disabled="busy">发布公告</button>
      </form>
      <article v-for="n in notices" :key="n.id" class="card space-y-3">
        <template v-if="editingNotice === n.id">
          <h3 class="font-bold">编辑消息 / 公告</h3>
          <label class="block">标题<input v-model="noticeForms[n.id].title" required maxlength="200" class="input-field" /></label>
          <label class="block">内容<textarea v-model="noticeForms[n.id].body" class="input-field" rows="4"></textarea></label>
          <label class="block">消息来源<input v-model="noticeForms[n.id].source_url" type="url" class="input-field" /></label>
          <label class="block">关联活动<select v-model="noticeForms[n.id].event_id" class="input-field"><option :value="null">不关联活动</option><option v-for="e in events" :key="e.id" :value="e.id">{{ e.title }} · {{ e.date }}</option></select></label>
          <label class="flex gap-2"><input v-model="noticeForms[n.id].published" type="checkbox" />前台显示</label>
          <div class="flex gap-3"><button class="btn-primary" :disabled="busy" @click="perform(() => rpc('chob_save_announcement', { payload: noticeForms[n.id] })).then((ok) => { if (ok) editingNotice = '' })">保存修改</button><button class="btn-secondary" @click="editingNotice = ''">取消</button></div>
        </template>
        <template v-else>
          <h3 class="font-bold">{{ n.title }}</h3>
          <p class="whitespace-pre-wrap">{{ n.body }}</p>
          <p class="text-sm text-gray-500">{{ n.published ? '前台显示' : '未公开' }} · {{ title(n.event_id) }}</p>
          <button class="btn-secondary" @click="editingNotice = n.id">编辑</button>
          <button
            v-if="n.event_id && /延期/.test(n.title + n.body) && events.find((e) => e.id === n.event_id)?.attributes?.event_status !== 'postponed'"
            class="btn-secondary ml-2"
            :disabled="busy"
            @click="perform(() => rpc('chob_set_postponement', { target: n.event_id, new_date: null, notify_users: false, source_url: n.source_url }))"
          >标记关联活动延期（日期待定）</button>
        </template>
      </article></template
    >
  </section>
</template>
