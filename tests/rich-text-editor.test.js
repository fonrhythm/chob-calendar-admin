import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorColor, richTextFromDom } from '../src/lib/richTextEditor.js';
import { richTextHtml, richTextPlainText } from '../src/lib/richText.js';
const text = value => ({ nodeType: 3, nodeName: '#text', nodeValue: value });
const element = (name, children = [], attrs = {}) => ({ nodeType: 1, nodeName: name.toUpperCase(), childNodes: children, getAttribute: key => attrs[key] ?? null });
test('clipboard DOM retains only basic formatting and flat lists', () => {
  const root = element('div', [element('p', [element('b', [text('名额')]), element('span', [text('与资格')], { style: 'color:rgb(189,63,55);font-style:italic;text-decoration:underline;position:fixed', onclick: 'bad()' })]),
    element('ol', [element('li', [text('购买')]), element('li', [text('登记')])])]);
  const doc = richTextFromDom(root), html = richTextHtml(doc);
  assert.equal(richTextPlainText(doc), '名额与资格\n购买\n登记');
  assert.match(html, /<strong>名额<\/strong>/);
  assert.match(html, /color:#bd3f37/);
  assert.match(html, /<u><em>与资格<\/em><\/u>/);
  assert.match(html, /<ol><li>购买<\/li><li>登记<\/li><\/ol>/);
  assert.doesNotMatch(html, /onclick|position|fixed/);
});
test('executable nodes and embedded media are dropped, unknown tags retain harmless text', () => {
  const doc = richTextFromDom(element('div', [element('script', [text('bad()')]), element('iframe', [text('private')]),
    element('svg', [text('bad')]), element('img', [], { onerror: 'bad()' }), element('a', [text('<原文>')], { href: 'javascript:bad()' })]));
  assert.equal(richTextHtml(doc), '<p>&lt;原文&gt;</p>');
  assert.equal(richTextPlainText(richTextFromDom(element('div', [element('p', [text('一')]), element('p', [element('br')]), element('p', [text('二')])]))), '一\n\n二');
});
test('colors are canonical safe hex values and explicit normal styles remove inherited marks', () => {
  for (const value of ['url(x)', 'rgb(999,0,0)', '#12', 'red;background:red', 'var(--x)']) assert.equal(editorColor(value), '');
  assert.equal(editorColor('#AbC'), '#aabbcc');
  const doc = richTextFromDom(element('div', [element('strong', [text('粗'), element('span', [text('普通')], { style: 'font-weight:normal' })])]));
  assert.equal(richTextHtml(doc), '<p><strong>粗</strong>普通</p>');
});
test('browser-created list nested in an existing paragraph survives save and reload', () => {
  const doc = richTextFromDom(element('div', [element('p', [element('ol', [element('li', [element('b', [text('第一步')])]), element('li', [text('第二步')])])])]));
  assert.equal(doc.blocks[0].type, 'ol');
  assert.equal(richTextHtml(doc), '<ol><li><strong>第一步</strong></li><li>第二步</li></ol>');
  assert.equal(richTextPlainText(doc), '第一步\n第二步');
});
