import { pinyin } from 'pinyin-pro';
export const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
export const splitValues = (value) => [
  ...new Set(
    String(value || '')
      .split(/[;；|、]/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];
export function artistPayload(row) {
  return {
    name: String(row.name || '').trim(),
    full_name: String(row.full_name || '').trim(),
    en_name: String(row.en_name || '').trim(),
    company: String(row.company || '').trim(),
    categories: Array.isArray(row.categories)
      ? row.categories
      : splitValues(row.categories || row.type),
    aliases: Array.isArray(row.aliases)
      ? row.aliases
      : splitValues(row.aliases),
  };
}
export function searchArtist(artist, query) {
  const needle = normalize(query);
  if (!needle) return true;
  const words = [artist.name, artist.en_name, ...(artist.aliases || [])].filter(
    Boolean,
  );
  return words.some(
    (word) =>
      normalize(word).includes(needle) ||
      normalize(pinyin(word, { toneType: 'none' }))
        .replace(/ /g, '')
        .includes(needle.replace(/ /g, '')),
  );
}
// RFC-style quoted fields, embedded newlines, UTF-8 BOM, and CRLF.
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [],
    field = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
      closed = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      closed = false;
    } else if (closed || c === '"')
      throw new Error('CSV引号格式不正确，请另存为UTF-8 CSV后重试。');
    else field += c;
  }
  if (quoted) throw new Error('CSV有未闭合的引号。');
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim()));
}
const columns = {
  name: 'name',
  艺人名称: 'name',
  姓名: 'name',
  en_name: 'en_name',
  英文名: 'en_name',
  company: 'company',
  公司: 'company',
  full_name: 'full_name',
  全名: 'full_name',
  categories: 'categories',
  type: 'categories',
  类别: 'categories',
  aliases: 'aliases',
  别名: 'aliases',
};
export function rowsToArtists(rows) {
  if (rows.length < 2) throw new Error('表格至少需要表头和一行资料。');
  const headers = rows[0].map((v) => columns[normalize(v)]);
  if (!headers.includes('name')) throw new Error('缺少“艺人名称”或“name”列。');
  const recognized = headers.filter(Boolean);
  if (new Set(recognized).size !== recognized.length)
    throw new Error('表头存在重复含义的列，请保留一列。');
  const result = rows
    .slice(1)
    .filter((r) => r.some((v) => v != null && String(v).trim()))
    .map((r) =>
      artistPayload(Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))),
    );
  if (result.length > 200) throw new Error('每次最多200位艺人，请分批导入。');
  return result;
}
export function validateImport(rows, existing) {
  const names = new Set(existing.map((a) => normalize(a.name)));
  const seen = new Set();
  return rows.map((row) => {
    const name = normalize(row.name);
    let problem = !name
      ? '名称必填'
      : row.name.length > 150
        ? '名称最多150字'
        : names.has(name)
          ? '数据库中已有同名艺人'
          : seen.has(name)
            ? '文件中名称重复'
            : '';
    seen.add(name);
    return problem;
  });
}
