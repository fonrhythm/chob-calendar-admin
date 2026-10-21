import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRichText, plainTextToRichText, richTextPlainText, richTextHtml, richTextForText } from '../src/lib/richText.js';
const doc = { version: 1, blocks: [
  { type: 'p', runs: [{ text: '名额', bold: true, color: '#C62828' }, { text: '与资格', italic: true, underline: true }] },
  { type: 'ol', items: [{ runs: [{ text: '购买产品' }] }, { runs: [{ text: '登记信息' }] }] }
] };
test('formats text and lists without changing the plain compatibility fields', () => {
  const plain = '名额与资格\n购买产品\n登记信息';
  assert.equal(richTextPlainText(doc), plain);
  assert.match(richTextHtml(richTextForText(doc, plain)), /<strong>名额<\/strong>/);
  assert.match(richTextHtml(doc), /<ol><li>购买产品<\/li><li>登记信息<\/li><\/ol>/);
  assert.equal(normalizeRichText(doc).blocks[0].runs[0].color, '#c62828');
});
test('legacy paragraphs, blank lines and stale formatting show the latest text', () => {
  const plain = '原文\r\n\r\n下一行';
  assert.equal(richTextPlainText(plainTextToRichText(plain)), '原文\n\n下一行');
  assert.equal(richTextHtml(richTextForText(doc, '最新备注')), '<p>最新备注</p>');
  assert.equal(richTextHtml(richTextForText(null, plain)), '<p>原文<br><br>下一行</p>');
  assert.equal(richTextPlainText(richTextForText(doc, '')), '');
});
test('stored input cannot introduce markup, attributes, arbitrary CSS or oversized documents', () => {
  const malicious = { version: 1, blocks: [{ type: 'p', onclick: 'alert(1)', runs: [{ text: '<img src=x onerror="bad()">&', color: 'red;background:url(x)', bold: true, style: 'x', html: '<script>bad()</script>' }] }] };
  const html = richTextHtml(malicious);
  assert.equal(html, '<p><strong>&lt;img src=x onerror=&quot;bad()&quot;&gt;&amp;</strong></p>');
  assert.equal(normalizeRichText({ version: 1, blocks: [{ type: 'script', runs: [] }] }), null);
  assert.equal(normalizeRichText(plainTextToRichText('x'.repeat(200001))), null);
  assert.equal(richTextHtml({ version: 2, blocks: [] }), '');
});

