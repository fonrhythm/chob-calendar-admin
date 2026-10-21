// Shared allowlisted document format. Never render stored HTML or arbitrary CSS.
const MAX_TEXT = 200000;
const MAX_BLOCKS = 1000;
const MAX_RUNS = 5000;
const textValue = value => String(value ?? '').replace(/\r\n?/g, '\n');

export function normalizeRichText(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.blocks) || value.blocks.length > MAX_BLOCKS) return null;
  let characters = 0, count = 0;
  const runs = input => {
    if (!Array.isArray(input)) throw Error('Invalid runs');
    return input.map(run => {
      if (!run || typeof run.text !== 'string' || ++count > MAX_RUNS) throw Error('Invalid run');
      const text = textValue(run.text);
      if ((characters += text.length) > MAX_TEXT) throw Error('Document too long');
      const result = { text };
      for (const key of ['bold', 'italic', 'underline']) if (run[key] === true) result[key] = true;
      if (typeof run.color === 'string' && /^#[0-9a-f]{6}$/i.test(run.color)) result.color = run.color.toLowerCase();
      return result;
    });
  };
  try {
    const blocks = value.blocks.map(block => {
      if (!block || typeof block !== 'object') throw Error('Invalid block');
      if (block.type === 'p') return { type: 'p', runs: runs(block.runs) };
      if ((block.type === 'ul' || block.type === 'ol') && Array.isArray(block.items) && block.items.length <= MAX_BLOCKS) {
        return { type: block.type, items: block.items.map(item => ({ runs: runs(item?.runs) })) };
      }
      throw Error('Invalid block type');
    });
    return { version: 1, blocks };
  } catch { return null; }
}

export function plainTextToRichText(value) {
  return { version: 1, blocks: [{ type: 'p', runs: [{ text: textValue(value) }] }] };
}

export function richTextPlainText(value) {
  const doc = normalizeRichText(value);
  if (!doc) return '';
  const line = runs => runs.map(run => run.text).join('');
  return doc.blocks.map(block => block.type === 'p' ? line(block.runs) : block.items.map(item => line(item.runs)).join('\n')).join('\n');
}

export function richTextForText(value, plainText) {
  const doc = normalizeRichText(value);
  const text = textValue(plainText);
  // Old importers can update plain fields without touching their formatting.
  return doc && richTextPlainText(doc) === text ? doc : plainTextToRichText(text);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function richTextHtml(value) {
  const doc = normalizeRichText(value);
  if (!doc) return '';
  const line = runs => runs.map(run => {
    let html = escapeHtml(run.text).replace(/\n/g, '<br>');
    if (run.bold) html = '<strong>' + html + '</strong>';
    if (run.italic) html = '<em>' + html + '</em>';
    if (run.underline) html = '<u>' + html + '</u>';
    if (run.color) html = '<span style="color:' + run.color + '">' + html + '</span>';
    return html;
  }).join('') || '<br>';
  return doc.blocks.map(block => block.type === 'p'
    ? '<p>' + line(block.runs) + '</p>'
    : '<' + block.type + '>' + block.items.map(item => '<li>' + line(item.runs) + '</li>').join('') + '</' + block.type + '>').join('');
}
