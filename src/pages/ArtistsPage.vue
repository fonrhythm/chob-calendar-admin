<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/authStore';
import { allRows, rpc } from '@/lib/api';
import {
  artistPayload,
  displayArtistName,
  searchArtist,
  parseCsv,
  rowsToArtists,
  validateImport,
} from '@/lib/artists';
import ModalShell from '@/components/common/ModalShell.vue';
import ArtistMultiSelect from '@/components/ArtistMultiSelect.vue';
import { groupSaveError } from '@/lib/rpc-errors';
import { groupRows, isGroup } from '@/lib/groups';

const auth = useAuthStore(),
  admin = computed(() => auth.userProfile?.role === 'admin');
const artists = ref([]),
  pairs = ref([]),
  error = ref(''),
  notice = ref(''),
  loading = ref(true),
  busy = ref(false),
  loaded = ref(false);
const tab = ref('artists'),
  query = ref(''),
  company = ref(''),
  category = ref(''),
  trash = ref(false),
  page = ref(1);
const modal = ref(''),
  form = ref({}),
  editing = ref(null),
  preview = ref([]),
  filename = ref('');

// 需求1：批量删除相关
const selectedArtists = ref(new Set()),
  selectedPairs = ref(new Set()),
  selectedGroups = ref(new Set());

// 需求5：排序相关
const sortBy = ref('name'),
  sortOrder = ref('asc');

// 需求3：CP配对搜索
const cpSearchQuery = ref(''),
  showCpArtistDropdown = ref({ artist_1_id: false, artist_2_id: false });

const active = computed(() => artists.value.filter((a) => !a.deleted_at));
const groups = computed(() => groupRows(artists.value));
const memberCandidates = computed(() =>
  artists.value.filter((a) => !a.deleted_at && !isGroup(a)),
);
const companies = computed(() =>
  [...new Set(active.value.map((a) => a.company).filter(Boolean))].sort(),
);
const categories = computed(() =>
  [...new Set(active.value.flatMap((a) => a.categories || []))].sort(),
);

// 需求5：排序函数
function sortArtists(list) {
  let sorted = [...list];

  switch (sortBy.value) {
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      break;
    case 'name-en':
      sorted.sort((a, b) => (a.en_name || '').localeCompare(b.en_name || ''));
      break;
    case 'company':
      sorted.sort((a, b) =>
        (a.company || '').localeCompare(b.company || '', 'zh-CN'),
      );
      break;
    case 'category':
      sorted.sort((a, b) =>
        ((a.categories || [])[0] || '').localeCompare(
          (b.categories || [])[0] || '',
          'zh-CN',
        ),
      );
      break;
  }

  if (sortOrder.value === 'desc') sorted.reverse();
  return sorted;
}

const filtered = computed(() => {
  const result = artists.value.filter(
    (a) =>
      !!a.deleted_at === trash.value &&
      searchArtist(a, query.value) &&
      (!company.value || a.company === company.value) &&
      (!category.value || a.categories?.includes(category.value)),
  );
  return sortArtists(result);
});

const visible = computed(() =>
  filtered.value.slice((page.value - 1) * 20, page.value * 20),
);
const filteredPairs = computed(() =>
  pairs.value.filter(
    (c) =>
      !!c.deleted_at === trash.value &&
      c.cp_name.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const filteredGroups = computed(() =>
  groups.value.filter(
    (g) => !!g.deleted_at === trash.value && searchArtist(g, query.value),
  ),
);

const rows = computed(() => preview.value.map(artistPayload));
const problems = computed(() => validateImport(rows.value, active.value));

// 需求3：CP 配对搜索的候选列表
const cpArtistCandidates = computed(() => {
  if (!cpSearchQuery.value) return [];
  return active.value
    .filter(
      (a) =>
        a.name.toLowerCase().includes(cpSearchQuery.value.toLowerCase()) ||
        (a.en_name || '')
          .toLowerCase()
          .includes(cpSearchQuery.value.toLowerCase()) ||
        (a.aliases || []).some((al) =>
          al.toLowerCase().includes(cpSearchQuery.value.toLowerCase()),
        ),
    )
    .slice(0, 10);
});

watch([query, company, category, trash, tab], () => {
  page.value = 1;
  selectedArtists.value.clear();
  selectedPairs.value.clear();
  selectedGroups.value.clear();
});
const allGroupsSelected = computed(
  () =>
    filteredGroups.value.length > 0 &&
    filteredGroups.value.every((g) => selectedGroups.value.has(g.id)),
);
function selectAllGroups(checked) {
  selectedGroups.value = new Set(
    checked ? filteredGroups.value.map((g) => g.id) : [],
  );
}

async function load() {
  loading.value = true;
  error.value = '';
  loaded.value = false;
  try {
    [artists.value, pairs.value] = await Promise.all([
      allRows('artists'),
      allRows('cp_pairs'),
    ]);
    loaded.value = true;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function action(fn) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
    modal.value = '';
    await load();
    if (loaded.value) notice.value = '已保存到数据库。';
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

function editArtist(a = null) {
  error.value = '';
  editing.value = a;
  form.value = a
    ? {
        ...a,
        name: a.base_name || a.name,
        categories: (a.categories || []).join('; '),
        aliases: (a.aliases || []).join('; '),
      }
    : { name: '', en_name: '', company: '', categories: '', aliases: '' };
  modal.value = 'artist';
}

function editPair(c = null) {
  error.value = '';
  editing.value = c;
  form.value = c ? { ...c } : { cp_name: '', artist_1_id: '', artist_2_id: '' };
  cpSearchQuery.value = '';
  showCpArtistDropdown.value = { artist_1_id: false, artist_2_id: false };
  modal.value = 'cp';
}

function editGroup(g = null) {
  error.value = '';
  editing.value = g;
  form.value = g
    ? { ...g, members: g.members || [] }
    : {
        name: '',
        en_name: '',
        company: '',
        aliases: [],
        type: '组合',
        members: [],
      };
  modal.value = 'group';
}

function saveArtist() {
  return action(() =>
    rpc('chob_save_artist', {
      payload: artistPayload(form.value),
      record_id: editing.value?.id || null,
      expected_updated_at: editing.value?.updated_at || null,
    }),
  );
}

function savePair() {
  return action(() =>
    rpc('chob_save_cp', {
      payload: form.value,
      record_id: editing.value?.id || null,
      expected_updated_at: editing.value?.updated_at || null,
    }),
  );
}

function saveGroup() {
  return action(async () => {
    try {
      return await rpc('chob_save_group_v2', {
        payload: form.value,
        record_id: editing.value?.id || null,
        expected_updated_at: editing.value?.updated_at || null,
      });
    } catch (e) {
      throw new Error(groupSaveError(e));
    }
  });
}
function remove(entity, row) {
  const deleted = !row.deleted_at;
  if (
    !window.confirm(
      `${deleted ? '删除' : '恢复'}"${row.name || row.cp_name}"？${deleted ? '删除后可在回收站恢复。' : ''}`,
    )
  )
    return;
  return action(() =>
    rpc(entity === 'groups' ? 'chob_set_group_deleted' : 'chob_set_deleted', {
      ...(entity === 'groups' ? {} : { entity }),
      record_id: row.id,
      deleted,
    }),
  );
}

// 需求1：批量删除函数
async function batchDelete(entity) {
  const selected =
    entity === 'artists'
      ? selectedArtists.value
      : entity === 'cp_pairs'
        ? selectedPairs.value
        : selectedGroups.value;
  if (busy.value || trash.value || selected.size === 0) return;

  if (
    !window.confirm(
      `确定删除选中的 ${selected.size} 项吗？删除后可在回收站恢复。`,
    )
  )
    return;

  try {
    busy.value = true;
    error.value = '';

    let removed = 0;
    for (const id of [...selected]) {
      await rpc(entity === 'groups' ? 'chob_set_group_deleted' : 'chob_set_deleted', {
        ...(entity === 'groups' ? {} : { entity }),
        record_id: id,
        deleted: true,
      });
      selected.delete(id);
      removed++;
    }

    if (entity === 'artists') selectedArtists.value.clear();
    else if (entity === 'cp_pairs') selectedPairs.value.clear();
    else selectedGroups.value.clear();

    await load();
    notice.value = '已删除';
  } catch (e) {
    const failure =
      '批量操作未全部完成：' +
      e.message +
      '。已成功的项目已取消勾选，其余可重试。';
    await load();
    error.value = failure;
  } finally {
    busy.value = false;
  }
}

// 需求2：删除导入预览中的一行
function removeFromPreview(index) {
  preview.value.splice(index, 1);
}

async function chooseFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  busy.value = true;
  error.value = '';
  preview.value = [];
  try {
    if (file.size > 2 * 1024 * 1024)
      throw new Error('请使用2MB以内的文件，每批最多200位艺人。');
    let grid;
    if (/\.csv$/i.test(file.name)) grid = parseCsv(await file.text());
    else if (/\.xlsx$/i.test(file.name)) {
      const { readSheet } = await import('read-excel-file/browser');
      grid = await readSheet(file, 1);
    } else
      throw new Error('请选择UTF-8 CSV或.xlsx文件；旧版.xls请先另存为.xlsx。');
    preview.value = rowsToArtists(grid).map((a) => ({
      ...a,
      categories: a.categories.join('; '),
      aliases: a.aliases.join('; '),
    }));
    filename.value = file.name;
    modal.value = 'import';
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

function importRows() {
  if (!rows.value.length || problems.value.some(Boolean)) return;
  return action(() =>
    rpc('chob_import_artists', { rows: rows.value, file_name: filename.value }),
  );
}

function downloadTemplate() {
  const blob = new Blob(['\uFEFF艺人名称,显示名称,公司,类别,别名\r\n'], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = '艺人导入模板.csv';
  a.click();
  URL.revokeObjectURL(url);
}

const artistName = (id) =>
  displayArtistName(artists.value.find((a) => a.id === id)) || '未找到艺人';

function closeCpDropdown(field) {
  setTimeout(() => {
    showCpArtistDropdown.value[field] = false;
  }, 200);
}
onMounted(load);
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">艺人资料库</h1>
        <p class="text-gray-500 mt-1">CP 配对与组合成员关系独立：同一艺人可以同时参与两者，删除配对或组合不会删除个人艺人。</p>
      </div>
      <div v-if="admin && loaded" class="flex flex-wrap gap-2">
        <button class="btn-secondary px-4 py-2" @click="downloadTemplate">
          下载模板
        </button>
        <label class="btn-secondary px-4 py-2 cursor-pointer"
          >{{ busy ? '处理中…' : '导入CSV / Excel'
          }}<input
            type="file"
            class="sr-only"
            accept=".csv,.xlsx"
            :disabled="busy"
            @change="chooseFile"
        /></label>
        <button
          class="btn-primary px-4 py-2"
          :disabled="busy"
          @click="
            tab === 'artists'
              ? editArtist()
              : tab === 'cp'
                ? editPair()
                : editGroup()
          "
        >
          {{
            tab === 'artists'
              ? '新增艺人'
              : tab === 'cp'
                ? '新增CP'
                : '新增组合'
          }}
        </button>
      </div>
    </div>

    <p
      v-if="error && !modal"
      role="alert"
      class="p-4 bg-red-50 text-red-700 rounded-lg"
    >
      {{ error }} <button class="underline" @click="load">重新读取</button>
    </p>
    <p
      v-if="notice"
      role="status"
      class="p-3 bg-green-50 text-green-800 rounded-lg"
    >
      {{ notice }}
    </p>

    <div class="flex gap-3">
      <button
        :class="tab === 'artists' ? 'btn-primary' : 'btn-secondary'"
        class="px-4 py-2"
        @click="tab = 'artists'"
      >
        艺人
      </button>
      <button
        :class="tab === 'cp' ? 'btn-primary' : 'btn-secondary'"
        class="px-4 py-2"
        @click="tab = 'cp'"
      >
        CP配对
      </button>
      <button
        :class="tab === 'group' ? 'btn-primary' : 'btn-secondary'"
        class="px-4 py-2"
        @click="tab = 'group'"
      >
        组合/乐队
      </button>
      <label v-if="admin" class="ml-auto flex gap-2 items-center"
        ><input v-model="trash" type="checkbox" />回收站</label
      >
    </div>

    <div class="grid sm:grid-cols-3 gap-3">
      <input
        aria-label="搜索"
        v-model="query"
        class="input-field"
        :placeholder="
          tab === 'artists'
            ? '搜索名字、显示名称、别名或拼音'
            : tab === 'cp'
              ? '搜索CP名称'
              : '搜索组合名称'
        "
      />
      <template v-if="tab === 'artists'">
        <select aria-label="公司筛选" v-model="company" class="input-field">
          <option value="">全部公司</option>
          <option v-for="c in companies" :key="c">{{ c }}</option>
        </select>
        <select aria-label="类别筛选" v-model="category" class="input-field">
          <option value="">全部类别</option>
          <option v-for="c in categories" :key="c">{{ c }}</option>
        </select>
      </template>
    </div>

    <!-- 需求5：艺人排序按钮 -->
    <div
      v-if="tab === 'artists' && loaded && !trash"
      class="flex gap-2 flex-wrap items-center"
    >
      <span class="text-sm text-gray-600">排序：</span>
      <button
        :class="sortBy === 'name' ? 'btn-primary' : 'btn-secondary'"
        class="px-3 py-1 text-sm"
        @click="sortBy = 'name'"
      >
        按名字
      </button>
      <button
        :class="sortBy === 'name-en' ? 'btn-primary' : 'btn-secondary'"
        class="px-3 py-1 text-sm"
        @click="sortBy = 'name-en'"
      >
        按显示名称
      </button>
      <button
        :class="sortBy === 'company' ? 'btn-primary' : 'btn-secondary'"
        class="px-3 py-1 text-sm"
        @click="sortBy = 'company'"
      >
        按公司
      </button>
      <button
        :class="sortBy === 'category' ? 'btn-primary' : 'btn-secondary'"
        class="px-3 py-1 text-sm"
        @click="sortBy = 'category'"
      >
        按类型
      </button>
      <button
        :class="sortOrder === 'asc' ? 'btn-primary' : 'btn-secondary'"
        class="px-3 py-1 text-sm"
        @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
      >
        {{ sortOrder === 'asc' ? '↑升序' : '↓降序' }}
      </button>
    </div>

    <!-- 需求1：批量删除按钮 -->
    <div
      v-if="admin && loaded && tab === 'artists' && selectedArtists.size > 0"
      class="flex gap-2 items-center bg-blue-50 p-3 rounded-lg"
    >
      <span class="text-gray-600">已选 {{ selectedArtists.size }} 项</span>
      <button
        class="btn-secondary px-3 py-1 text-red-700 hover:text-red-900"
        :disabled="busy || trash"
        @click="batchDelete('artists')"
      >
        批量删除
      </button>
    </div>

    <div
      v-if="admin && loaded && tab === 'cp' && selectedPairs.size > 0"
      class="flex gap-2 items-center bg-blue-50 p-3 rounded-lg"
    >
      <span class="text-gray-600">已选 {{ selectedPairs.size }} 项</span>
      <button
        class="btn-secondary px-3 py-1 text-red-700 hover:text-red-900"
        :disabled="busy || trash"
        @click="batchDelete('cp_pairs')"
      >
        批量删除
      </button>
    </div>

    <div
      v-if="admin && loaded && tab === 'group' && selectedGroups.size > 0"
      class="flex gap-2 items-center bg-blue-50 p-3 rounded-lg"
    >
      <span class="text-gray-600">已选 {{ selectedGroups.size }} 项</span>
      <button
        class="btn-secondary px-3 py-1 text-red-700 hover:text-red-900"
        :disabled="busy || trash"
        @click="batchDelete('groups')"
      >
        批量删除
      </button>
    </div>

    <p v-if="loading">正在读取资料…</p>

    <template v-else-if="loaded">
      <!-- 艺人标签页 -->
      <template v-if="tab === 'artists'">
        <p class="text-gray-500">共 {{ filtered.length }} 位艺人</p>
        <div class="grid lg:grid-cols-2 gap-3">
          <article
            v-for="a in visible"
            :key="a.id"
            :class="
              selectedArtists.has(a.id)
                ? 'bg-blue-50 border-blue-300'
                : 'bg-white border-gray-200'
            "
            class="border rounded-xl p-5 space-y-2"
          >
            <div class="flex gap-3 items-start">
              <input
                v-if="admin && !trash"
                :disabled="busy"
                type="checkbox"
                :checked="selectedArtists.has(a.id)"
                @change="
                  (e) =>
                    e.target.checked
                      ? selectedArtists.add(a.id)
                      : selectedArtists.delete(a.id)
                "
                class="mt-1"
              />
              <div class="flex-1">
                <h2 class="font-bold text-lg">{{ displayArtistName(a) }}</h2>
                <p class="text-gray-500">
                  {{ a.en_name }} · {{ a.company || '未填写公司' }}
                </p>
                <p>{{ a.categories?.join(' / ') || '未填写类别' }}</p>
                <p v-if="a.aliases?.length" class="text-sm text-gray-500">
                  别名：{{ a.aliases.join('、') }}
                </p>
              </div>
            </div>
            <div
              v-if="admin && !selectedArtists.has(a.id)"
              class="flex gap-4 pt-2"
            >
              <button
                v-if="!a.deleted_at"
                class="text-primary-600"
                :disabled="busy"
                @click="editArtist(a)"
              >
                编辑
              </button>
              <button
                class="text-red-700"
                :disabled="busy"
                @click="remove('artists', a)"
              >
                {{ a.deleted_at ? '恢复' : '删除' }}
              </button>
            </div>
          </article>
        </div>
        <div v-if="filtered.length > 20" class="flex items-center gap-4">
          <button
            :disabled="page === 1"
            class="btn-secondary px-3 py-2"
            @click="page--"
          >
            上一页
          </button>
          <span>{{ page }} / {{ Math.ceil(filtered.length / 20) }}</span>
          <button
            :disabled="page * 20 >= filtered.length"
            class="btn-secondary px-3 py-2"
            @click="page++"
          >
            下一页
          </button>
        </div>
        <p v-if="!filtered.length" class="py-10 text-center text-gray-500">
          暂无符合条件的艺人资料。
        </p>
      </template>

      <!-- CP配对标签页 -->
      <template v-else-if="tab === 'cp'">
        <p class="text-gray-500">共 {{ filteredPairs.length }} 组CP</p>
        <article
          v-for="c in filteredPairs"
          :key="c.id"
          :class="
            selectedPairs.has(c.id)
              ? 'bg-blue-50 border-blue-300'
              : 'bg-white border-gray-200'
          "
          class="border rounded-xl p-5 mb-3"
        >
          <div class="flex gap-3 items-start">
            <input
              v-if="admin && !trash"
              :disabled="busy"
              type="checkbox"
              :checked="selectedPairs.has(c.id)"
              @change="
                (e) =>
                  e.target.checked
                    ? selectedPairs.add(c.id)
                    : selectedPairs.delete(c.id)
              "
            />
            <div class="flex-1">
              <h2 class="font-bold">{{ c.cp_name }}</h2>
              <p class="my-2">
                {{ artistName(c.artist_1_id) }} ＋
                {{ artistName(c.artist_2_id) }}
              </p>
            </div>
          </div>
          <div v-if="admin && !selectedPairs.has(c.id)" class="flex gap-4">
            <button
              v-if="!c.deleted_at"
              class="text-primary-600"
              @click="editPair(c)"
            >
              编辑
            </button>
            <button
              class="text-red-700"
              :disabled="busy"
              @click="remove('cp_pairs', c)"
            >
              {{ c.deleted_at ? '恢复' : '删除' }}
            </button>
          </div>
        </article>
        <p v-if="!filteredPairs.length" class="py-10 text-center text-gray-500">
          暂无CP配对。
        </p>
      </template>

      <!-- 需求4：组合/乐队标签页 -->
      <template v-else-if="tab === 'group'">
        <div class="flex gap-3 items-center">
          <p class="text-gray-500">
            共 {{ filteredGroups.length }} 个组合/乐队
          </p>
          <label v-if="admin && !trash"
            ><input
              type="checkbox"
              :disabled="busy"
              :checked="allGroupsSelected"
              :indeterminate="selectedGroups.size > 0 && !allGroupsSelected"
              @change="selectAllGroups($event.target.checked)"
            />
            全选当前筛选结果</label
          ><button
            v-if="selectedGroups.size"
            :disabled="busy"
            @click="selectAllGroups(false)"
          >
            全不选
          </button>
        </div>
        <article
          v-for="g in filteredGroups"
          :key="g.id"
          :class="
            selectedGroups.has(g.id)
              ? 'bg-blue-50 border-blue-300'
              : 'bg-white border-gray-200'
          "
          class="border rounded-xl p-5 mb-3"
        >
          <div class="flex gap-3 items-start">
            <input
              v-if="admin && !trash"
              :disabled="busy"
              type="checkbox"
              :checked="selectedGroups.has(g.id)"
              @change="
                (e) =>
                  e.target.checked
                    ? selectedGroups.add(g.id)
                    : selectedGroups.delete(g.id)
              "
            />
            <div class="flex-1">
              <h2 class="font-bold">{{ displayArtistName(g) }}</h2>
              <p class="text-gray-500 text-sm">{{ g.type }}</p>
              <p v-if="g.members?.length" class="text-sm mt-2">
                成员：{{ g.members.map((id) => artistName(id)).join('、') }}
              </p>
            </div>
          </div>
          <div v-if="admin && !selectedGroups.has(g.id)" class="flex gap-4">
            <button
              v-if="!g.deleted_at"
              class="text-primary-600"
              @click="editGroup(g)"
            >
              编辑
            </button>
            <button
              class="text-red-700"
              :disabled="busy"
              @click="remove('groups', g)"
            >
              {{ g.deleted_at ? '恢复' : '删除' }}
            </button>
          </div>
        </article>
        <p
          v-if="!filteredGroups.length"
          class="py-10 text-center text-gray-500"
        >
          暂无组合/乐队。
        </p>
      </template>
    </template>

    <!-- 模态框 -->
    <ModalShell
      v-if="modal"
      :title="
        modal === 'import'
          ? '确认导入预览'
          : modal === 'cp'
            ? 'CP配对'
            : modal === 'group'
              ? '编辑组合/乐队'
              : editing
                ? '编辑艺人'
                : '新增艺人'
      "
      :busy="busy"
      @close="modal = ''"
    >
      <p v-if="error" role="alert" class="bg-red-50 text-red-700 p-3 mb-4">
        {{ error }}
      </p>

      <!-- 艺人表单 -->
      <form
        v-if="modal === 'artist'"
        @submit.prevent="saveArtist"
        class="space-y-4"
      >
        <label class="block"
          >艺人名称 *<input
            v-model="form.name"
            maxlength="150"
            required
            class="input-field mt-1"
        /></label>
        <label class="block"
          >全名（同公司同名时必填）<input
            v-model="form.full_name"
            maxlength="150"
            class="input-field mt-1"
        /></label>
        <label class="block"
          >显示名称<input v-model="form.en_name" class="input-field mt-1"
        /></label>
        <label class="block"
          >公司<input v-model="form.company" class="input-field mt-1"
        /></label>
        <label class="block"
          >艺人类别（多个用分号隔开）<input
            v-model="form.categories"
            placeholder="歌手;演员;BL演员"
            class="input-field mt-1"
        /></label>
        <label class="block"
          >别名（多个用分号隔开）<input
            v-model="form.aliases"
            class="input-field mt-1"
        /></label>
        <button :disabled="busy" class="btn-primary px-5 py-2">
          {{ busy ? '保存中…' : '保存' }}
        </button>
      </form>

      <!-- 需求3：CP配对表单（支持搜索输入） -->
      <form
        v-else-if="modal === 'cp'"
        @submit.prevent="savePair"
        class="space-y-4"
      >
        <label class="block"
          >CP名称 *<input
            v-model="form.cp_name"
            maxlength="150"
            required
            class="input-field mt-1"
        /></label>

        <label
          v-for="field in ['artist_1_id', 'artist_2_id']"
          :key="field"
          class="block"
        >
          {{ field === 'artist_1_id' ? '第一位艺人' : '第二位艺人' }}
          <div class="relative mt-1">
            <input
              v-model="cpSearchQuery"
              @focus="showCpArtistDropdown[field] = true"
              @blur="closeCpDropdown(field)"
              :placeholder="
                form[field] ? artistName(form[field]) : '输入艺人名字搜索'
              "
              class="input-field w-full"
            />
            <div
              v-if="showCpArtistDropdown[field] && cpArtistCandidates.length"
              class="absolute top-full left-0 right-0 bg-white border border-gray-300 rounded mt-1 z-10 max-h-48 overflow-y-auto shadow-lg"
            >
              <button
                v-for="a in cpArtistCandidates"
                :key="a.id"
                @mousedown.prevent="
                  form[field] = a.id;
                  cpSearchQuery = '';
                  showCpArtistDropdown[field] = false;
                "
                type="button"
                class="w-full text-left px-3 py-2 hover:bg-gray-100 border-b last:border-b-0"
              >
                {{ displayArtistName(a) }}
                <span class="text-gray-500 text-sm">({{ a.company }})</span>
              </button>
            </div>
          </div>
          <p v-if="form[field]" class="text-sm text-gray-600 mt-1">
            已选：{{ artistName(form[field]) }}
          </p>
        </label>

        <button :disabled="busy" class="btn-primary px-5 py-2">保存配对</button>
      </form>

      <!-- 需求4：组合/乐队表单 -->
      <form
        v-else-if="modal === 'group'"
        @submit.prevent="saveGroup"
        class="space-y-4"
      >
        <label class="block"
          >组合/乐队名称 *<input
            v-model="form.name"
            maxlength="150"
            required
            class="input-field mt-1"
        /></label>
        <label class="block"
          >类型<select
            v-model="form.type"
            aria-label="组合类型"
            class="input-field mt-1"
          >
            <option>组合</option>
            <option>乐队</option>
          </select></label
        >
        <label class="block"
          >显示名称（选填）<input v-model="form.en_name" class="input-field mt-1"
        /></label>
        <label class="block"
          >公司<input v-model="form.company" class="input-field mt-1"
        /></label>
        <div>
          <p class="mb-2">成员（可多选）</p>
          <ArtistMultiSelect
            v-model="form.members"
            :artists="memberCandidates"
            :required="false"
          />
          <p class="text-gray-500 text-sm mt-2">
            成员可暂时不填。组合本身会出现在活动的艺人选择中。
          </p>
        </div>
        <button :disabled="busy" class="btn-primary px-5 py-2">保存</button>
      </form>

      <!-- 需求2：导入预览（支持删除行） -->
      <div v-else class="space-y-4">
        <p>
          {{ filename }} · 共
          {{ rows.length }}
          位艺人。Excel读取第一个工作表。可在下方更正；全部通过检查后才能导入。
        </p>
        <div
          v-for="(r, i) in preview"
          :key="i"
          class="border rounded-lg p-3 space-y-2 bg-gray-50"
        >
          <div class="flex items-start justify-between mb-2">
            <p class="font-semibold">第 {{ i + 1 }} 位</p>
            <button
              type="button"
              class="text-red-700 hover:text-red-900 font-bold"
              @click="removeFromPreview(i)"
            >
              ✕ 删除此行
            </button>
          </div>
          <label
            v-for="(label, key) in {
              name: '艺人名称',
              en_name: '显示名称',
              company: '公司',
              categories: '类别（分号分隔）',
              aliases: '别名（分号分隔）',
            }"
            :key="key"
            class="block text-sm"
          >
            {{ label
            }}<input v-model="r[key]" class="input-field mt-1 text-sm" />
          </label>
          <p v-if="problems[i]" class="text-red-700 text-sm font-semibold">
            ⚠️ {{ problems[i] }}
          </p>
        </div>
        <button
          class="btn-primary px-5 py-2"
          :disabled="busy || !rows.length || problems.some(Boolean)"
          @click="importRows"
        >
          {{ busy ? '导入中…' : `确认导入 ${rows.length} 位艺人` }}
        </button>
        <p class="text-sm text-gray-500">
          整批写入；任何一条失败都会回滚，不会只导入一半。
        </p>
      </div>
    </ModalShell>
  </section>
</template>
