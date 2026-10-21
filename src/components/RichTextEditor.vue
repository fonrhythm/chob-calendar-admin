<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { plainTextToRichText, richTextForText, richTextHtml, richTextPlainText } from '../lib/richText.js';
import { editorColor, richTextFromDom, richTextFromHtml } from '../lib/richTextEditor.js';

const props = defineProps({
  modelValue: Object,
  plainText: { type: String, default: '' },
  label: { type: String, required: true },
  placeholder: { type: String, default: '' },
  disabled: Boolean,
  resetKey: [String, Number],
});
const emit = defineEmits(['update:modelValue', 'update:plainText']);
const root = ref(null), editor = ref(null), issue = ref('');
const color = ref('#20201e');
const active = ref({ bold: false, italic: false, underline: false, ul: false, ol: false });
const colors = ['#20201e', '#bd3f37', '#b36a16', '#2d7560', '#3467a7', '#81559b'];
let selection = null, signature = '', composing = false, ownerDocument = null;

function render(doc) {
  if (!editor.value) return;
  editor.value.innerHTML = richTextHtml(doc);
  signature = JSON.stringify(doc);
  selection = null;
  issue.value = '';
}
function rememberSelection() {
  const current = editor.value?.ownerDocument.getSelection();
  if (!current?.rangeCount || !editor.value.contains(current.getRangeAt(0).commonAncestorContainer)) return;
  selection = current.getRangeAt(0).cloneRange();
  const documentRef = editor.value.ownerDocument;
  try {
    active.value = {
      bold: documentRef.queryCommandState('bold'), italic: documentRef.queryCommandState('italic'), underline: documentRef.queryCommandState('underline'),
      ul: documentRef.queryCommandState('insertUnorderedList'), ol: documentRef.queryCommandState('insertOrderedList'),
    };
    color.value = editorColor(documentRef.queryCommandValue('foreColor')) || color.value;
  } catch { /* Selection still works when a browser omits command-state queries. */ }
}
function restoreSelection() {
  const area = editor.value;
  if (!area) return;
  area.focus({ preventScroll: true });
  const current = area.ownerDocument.getSelection();
  if (!current) return;
  current.removeAllRanges();
  if (selection && area.contains(selection.commonAncestorContainer)) current.addRange(selection);
  else {
    const range = area.ownerDocument.createRange();
    range.selectNodeContents(area);
    range.collapse(false);
    current.addRange(range);
  }
}
function flush() {
  if (!editor.value || composing) return !composing;
  const doc = richTextFromDom(editor.value);
  if (!doc) { issue.value = '内容过长或段落过多，请精简后保存。'; return false; }
  issue.value = '';
  if (JSON.stringify(doc) === signature && richTextPlainText(doc) === String(props.plainText ?? '').replace(/\r\n?/g, '\n')) return true;
  signature = JSON.stringify(doc);
  emit('update:modelValue', doc);
  emit('update:plainText', richTextPlainText(doc));
  return true;
}
function command(name, value = null) {
  if (props.disabled) return;
  restoreSelection();
  editor.value.ownerDocument.execCommand(name, false, value);
  flush();
  rememberSelection();
}
function applyColor(value) {
  const safeColor = editorColor(value);
  if (!safeColor) return;
  color.value = safeColor;
  command('foreColor', safeColor);
}
function insertTransfer(event) {
  event.preventDefault();
  if (props.disabled) return;
  const transfer = event.clipboardData || event.dataTransfer;
  const html = transfer?.getData('text/html') || '';
  const doc = html ? richTextFromHtml(html, editor.value.ownerDocument) : plainTextToRichText(transfer?.getData('text/plain') || '');
  if (!doc) { issue.value = '粘贴内容过长，请分段粘贴。'; return; }
  rememberSelection();
  command('insertHTML', richTextHtml(doc));
}
function normalizeOnLeave(event) {
  if (root.value?.contains(event.relatedTarget) || composing) return;
  if (!flush()) return;
  const doc = richTextFromDom(editor.value);
  if (doc) render(doc);
}
watch(() => [props.modelValue, props.plainText, props.resetKey], (current, previous) => {
  const doc = richTextForText(props.modelValue, props.plainText);
  if (current[2] !== previous?.[2] || JSON.stringify(doc) !== signature) render(doc);
}, { deep: true, flush: 'post' });
onMounted(() => {
  render(richTextForText(props.modelValue, props.plainText));
  ownerDocument = editor.value.ownerDocument;
  ownerDocument.addEventListener('selectionchange', rememberSelection);
});
onUnmounted(() => ownerDocument?.removeEventListener('selectionchange', rememberSelection));
defineExpose({ flush });
</script>

<template>
  <div ref="root" class="rich-text-editor" :class="{ disabled }" @focusout="normalizeOnLeave">
    <div class="editor-toolbar" role="toolbar" :aria-label="`${label}格式`" @pointerdown.capture="rememberSelection">
      <button type="button" :disabled="disabled" :aria-pressed="active.bold" aria-label="加粗" title="加粗" @pointerdown.prevent @click="command('bold')"><strong>B</strong></button>
      <button type="button" :disabled="disabled" :aria-pressed="active.italic" aria-label="斜体" title="斜体" @pointerdown.prevent @click="command('italic')"><em>I</em></button>
      <button type="button" :disabled="disabled" :aria-pressed="active.underline" aria-label="下划线" title="下划线" @pointerdown.prevent @click="command('underline')"><u>U</u></button>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <button type="button" :disabled="disabled" :aria-pressed="active.ul" aria-label="无序列表" title="无序列表" @pointerdown.prevent @click="command('insertUnorderedList')">• 列表</button>
      <button type="button" :disabled="disabled" :aria-pressed="active.ol" aria-label="有序列表" title="有序列表" @pointerdown.prevent @click="command('insertOrderedList')">1. 列表</button>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <div class="preset-colors" role="group" aria-label="文字预设颜色">
        <button v-for="value in colors" :key="value" type="button" class="color-swatch" :disabled="disabled" :aria-label="`文字颜色 ${value}`" :title="`文字颜色 ${value}`" :style="{ '--swatch-color': value }" @pointerdown.prevent @click="applyColor(value)"></button>
      </div>
      <label class="custom-color" title="自定义文字颜色"><span>颜色</span><input type="color" :value="color" :disabled="disabled" :aria-label="`${label}自定义文字颜色`" @input="applyColor($event.target.value)" /></label>
      <button type="button" class="clear-format" :disabled="disabled" aria-label="清除文字格式" title="清除加粗、斜体、下划线及颜色" @pointerdown.prevent @click="command('removeFormat')">清除格式</button>
    </div>
    <div ref="editor" class="editor-content" role="textbox" :aria-label="label" aria-multiline="true" :aria-disabled="disabled" :aria-invalid="!!issue" :contenteditable="!disabled" :data-placeholder="placeholder" spellcheck="false" @input="!composing && flush()" @paste="insertTransfer" @drop="insertTransfer" @compositionstart="composing = true" @compositionend="composing = false; flush()" @keyup="rememberSelection" @mouseup="rememberSelection"></div>
    <p v-if="issue" class="editor-problem" role="alert">{{ issue }}</p>
  </div>
</template>

<style scoped>
.rich-text-editor { margin-top: 10px; border: 1px solid #dedbd5; border-radius: 13px; background: #fff; overflow: hidden; font-weight: 400; }
.rich-text-editor:focus-within { outline: 2px solid #b5b2aa; outline-offset: 1px; }
.editor-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 8px; border-bottom: 1px solid #e8e5df; background: #f8f7f4; }
.editor-toolbar button { min-width: 34px; min-height: 34px; padding: 6px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #3f413b; font: inherit; font-size: 13px; cursor: pointer; }
.editor-toolbar button:hover { background: #eeece6; }
.editor-toolbar button[aria-pressed="true"] { border-color: #a5ada1; background: #e2e8df; color: #253b2a; }
.editor-toolbar button:focus-visible, .custom-color:focus-within { outline: 2px solid #657a60; outline-offset: 1px; }
.toolbar-divider { height: 20px; width: 1px; margin: 0 3px; background: #ddd9d1; }
.preset-colors { display: flex; align-items: center; gap: 0; }
.editor-toolbar .color-swatch { min-width: 26px; min-height: 32px; padding: 4px; }
.color-swatch::before { content: ''; display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--swatch-color); border: 1px solid rgb(0 0 0 / 12%); }
.custom-color { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 4px; border-radius: 5px; cursor: pointer; }
.custom-color input { width: 26px; height: 26px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.editor-content { min-height: 130px; max-height: 480px; padding: 12px 16px; overflow: auto; outline: none; line-height: 1.65; font-size: 15px; font-weight: 400; overflow-wrap: anywhere; white-space: pre-wrap; }
.editor-content:empty::before { content: attr(data-placeholder); color: #9a9c96; pointer-events: none; }
.editor-content :deep(p) { margin: 0 0 0.55em; }
.editor-content :deep(p:last-child) { margin-bottom: 0; }
.editor-content :deep(ul), .editor-content :deep(ol) { margin: 0.4em 0; padding-left: 1.6em; }
.editor-content :deep(ul) { list-style: disc; }
.editor-content :deep(ol) { list-style: decimal; }
.editor-content :deep(li) { margin: 0.15em 0; }
.editor-content :deep(strong), .editor-content :deep(b) { font-weight: 700; }
.editor-content :deep(em), .editor-content :deep(i) { font-style: italic; }
.editor-problem { margin: 0; padding: 7px 12px; color: #ac342c; font-size: 13px; background: #fff3f0; }
.disabled { opacity: 0.65; }
.disabled .editor-toolbar button, .disabled .custom-color input { cursor: default; }
@media (max-width: 600px) { .editor-toolbar { gap: 2px; padding: 6px; } .editor-toolbar button { min-height: 36px; } .preset-colors { flex-wrap: wrap; } .toolbar-divider { margin: 0 1px; } .editor-content { padding: 10px 12px; min-height: 120px; } .clear-format { margin-left: auto; } }
</style>
