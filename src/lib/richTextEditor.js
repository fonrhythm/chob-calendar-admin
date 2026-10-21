import { normalizeRichText } from './richText.js';

const DROP_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'SVG', 'MATH', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);
const BLOCK_ELEMENTS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'ADDRESS', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'TR']);
const NAMED_COLORS = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', purple: '#800080', orange: '#ffa500', gray: '#808080', grey: '#808080' };

export function editorColor(value) {
  const color = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) return '#' + [...color.slice(1)].map(c => c + c).join('');
  const rgb = color.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (rgb && rgb.slice(1).every(v => Number(v) <= 255)) return '#' + rgb.slice(1).map(v => Number(v).toString(16).padStart(2, '0')).join('');
  return NAMED_COLORS[color] || '';
}

function elementFormat(node, inherited) {
  const format = { ...inherited };
  const tag = String(node.nodeName || '').toUpperCase();
  if (tag === 'B' || tag === 'STRONG') format.bold = true;
  if (tag === 'I' || tag === 'EM') format.italic = true;
  if (tag === 'U') format.underline = true;
  if (tag === 'FONT') {
    const color = editorColor(node.getAttribute?.('color'));
    if (color) format.color = color;
  }
  for (const declaration of String(node.getAttribute?.('style') || '').split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const key = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim().toLowerCase().replace(/\s*!important\s*$/, '');
    if (key === 'font-weight') {
      if (value === 'bold' || /^[6-9]00$/.test(value)) format.bold = true;
      else if (value === 'normal' || /^[1-5]00$/.test(value)) delete format.bold;
    } else if (key === 'font-style') {
      if (value === 'italic') format.italic = true;
      else if (value === 'normal') delete format.italic;
    } else if (key === 'text-decoration' || key === 'text-decoration-line') {
      if (value.split(/\s+/).includes('underline')) format.underline = true;
      else if (value === 'none') delete format.underline;
    } else if (key === 'color') {
      const color = editorColor(value);
      if (color) format.color = color;
    }
  }
  return format;
}

// Reads only text, basic inline marks and flat lists. DOM attributes, URLs,
// executable elements, arbitrary CSS, and embedded media never enter the AST.
// The small DOM interface also lets the parser be tested without a browser.
export function richTextFromDom(root) {
  let visited = 0;
  const visit = () => { if (++visited > 30000) throw Error('Document too large'); };
  const children = node => Array.from(node.childNodes || []);
  const append = (runs, text, format) => {
    if (!text) return;
    const run = { text: String(text).replace(/\r\n?/g, '\n'), ...format };
    const previous = runs.at(-1);
    if (previous && ['bold', 'italic', 'underline', 'color'].every(key => previous[key] === run[key])) previous.text += run.text;
    else runs.push(run);
  };
  const inline = (node, format = {}, runs = []) => {
    visit();
    if (node.nodeType === 3) { append(runs, node.nodeValue ?? node.textContent ?? '', format); return runs; }
    if (![1, 9, 11].includes(node.nodeType)) return runs;
    const tag = String(node.nodeName || '').toUpperCase();
    if (DROP_ELEMENTS.has(tag)) return runs;
    if (tag === 'BR') { append(runs, '\n', format); return runs; }
    const nextFormat = elementFormat(node, format);
    const nested = children(node);
    for (let index = 0; index < nested.length; index++) {
      const child = nested[index];
      const childTag = String(child.nodeName || '').toUpperCase();
      if (index > 0 && (BLOCK_ELEMENTS.has(childTag) || childTag === 'LI') && runs.length && !runs.at(-1).text.endsWith('\n')) append(runs, '\n', nextFormat);
      inline(child, nextFormat, runs);
      if (index < nested.length - 1 && (BLOCK_ELEMENTS.has(childTag) || childTag === 'LI') && runs.length && !runs.at(-1).text.endsWith('\n')) append(runs, '\n', nextFormat);
    }
    return runs;
  };
  const blockRuns = (node, format = {}) => {
    const runs = inline(node, format);
    // A lone <br> is the browser's empty editable paragraph placeholder.
    if (runs.length === 1 && runs[0].text === '\n' && children(node).length === 1 && String(children(node)[0].nodeName).toUpperCase() === 'BR') return [];
    return runs;
  };
  try {
    const blocks = [];
    let pending = [];
    const flush = () => { if (pending.length) { blocks.push({ type: 'p', runs: pending }); pending = []; } };
    const collect = (nodes, inherited = {}) => {
    for (const node of nodes) {
      const tag = String(node.nodeName || '').toUpperCase();
      if (node.nodeType === 3 && !String(node.nodeValue ?? '').trim() && !pending.length) continue;
      if (DROP_ELEMENTS.has(tag)) continue;
      if (tag === 'UL' || tag === 'OL') {
        flush();
        visit();
        const items = children(node).filter(child => String(child.nodeName || '').toUpperCase() === 'LI').map(item => ({ runs: blockRuns(item, elementFormat(node, inherited)) }));
        if (items.length) blocks.push({ type: tag.toLowerCase(), items });
      } else if (BLOCK_ELEMENTS.has(tag) || tag === 'LI') {
        flush();
        // Editing engines can put a list inside the original paragraph/div.
        // Preserve that structure instead of flattening it back into text.
        const nested = children(node);
        if (nested.some(child => ['UL', 'OL', ...BLOCK_ELEMENTS].includes(String(child.nodeName || '').toUpperCase()))) {
          visit();
          collect(nested, elementFormat(node, inherited));
          flush();
        } else blocks.push({ type: 'p', runs: blockRuns(node, inherited) });
      } else {
        inline(node, inherited, pending);
      }
    }
    };
    collect(children(root));
    flush();
    return normalizeRichText({ version: 1, blocks: blocks.length ? blocks : [{ type: 'p', runs: [] }] });
  } catch { return null; }
}

export function richTextFromHtml(html, documentRef = globalThis.document) {
  if (!documentRef?.createElement || typeof html !== 'string' || html.length > 2000000) return null;
  // A template remains inert; raw clipboard HTML is never attached to the page.
  const template = documentRef.createElement('template');
  template.innerHTML = html;
  return richTextFromDom(template.content);
}
