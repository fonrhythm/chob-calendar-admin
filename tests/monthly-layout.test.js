import test from 'node:test';import assert from 'node:assert/strict';import {parseMonthlyText} from '../src/lib/monthly-schedule.js';
test('Pui-style mixed Thai/English poster groups date, description and @ venue into two activities',()=>{
 const text='NOVEMBER 2026\n05 Nov\nร่วมงาน in-cosmetics Asia\n@ BITEC BANGNA\n13 Nov\nถ่ายรายการ\nBOOKING SHOW\n093-192-9669 (คุณป๊อง)\n081-234-5966';
 const rows=parseMonthlyText(text,'2026-11');assert.equal(rows.length,2);
 assert.equal(rows[0].date,'2026-11-05');assert.equal(rows[0].title,'ร่วมงาน in-cosmetics Asia');assert.equal(rows[0].venue,'BITEC BANGNA');assert.equal(rows[0].category,'interaction');
 assert.equal(rows[1].date,'2026-11-13');assert.equal(rows[1].title,'ถ่ายรายการ');assert.equal(rows[1].venue,'');assert.equal(rows[1].category,'broadcast');assert.ok(!rows[1].original.includes('9669'));assert.equal(rows[0].reviewed,false);
});
test('date-only anchors and wrapped descriptions keep content together without inventing locations',()=>{
 const rows=parseMonthlyText('05\nร่วมงาน\nin-cosmetics Asia\n＠ BITEC BANGNA\n13 Nov\nถ่ายรายการ','2026-11');
 assert.equal(rows.length,2);assert.equal(rows[0].title,'ร่วมงาน in-cosmetics Asia');assert.equal(rows[0].venue,'BITEC BANGNA');assert.equal(rows[1].city,'');
});
test('OCR spaces inside Thai words are joined before classification and bar detection',()=>{
 const rows=parseMonthlyText('05 Nov\nร่วมงาน in-cosmetics Asia\n@ BITEC BANGNA\n13 Nov\nถ่ า ย ร า ย ก า ร\n14 ร ้ า น HEY BAR | Bangkok','2026-11');assert.equal(rows[1].title,'ถ่ายรายการ');assert.equal(rows[1].category,'broadcast');assert.equal(rows[2].form,'bar');
});
test('actual mixed-language OCR output keeps both date blocks and flags the corrected Thai phrase',()=>{
 const rows=parseMonthlyText('05 Nov\nร ่ ว ม ง า น in-cosmetics Asia\n@ BITEC BANGNA\n13 Nov\nถ่ า ย ธา ย ก า ร','2026-11');assert.equal(rows.length,2);assert.equal(rows[0].title,'ร่วมงาน in-cosmetics Asia');assert.equal(rows[1].title,'ถ่ายรายการ');assert.equal(rows[1].category,'broadcast');assert.ok(rows[1].parseWarnings.some(w=>w.includes('请对照原图核对')));assert.ok(rows[1].original.includes('ธา'));
});
test('month label and venue wrapped onto separate lines do not become the activity name',()=>{
 const rows=parseMonthlyText('05\nNov\nร่วมงาน in-cosmetics Asia\n@ BITEC\nBANGNA\n13 Nov\nถ่ายรายการ','2026-11');assert.equal(rows[0].title,'ร่วมงาน in-cosmetics Asia');assert.equal(rows[0].venue,'BITEC BANGNA');assert.equal(rows.length,2);
});
test('contradicting month and date without any description stay visibly incomplete',()=>{
 const rows=parseMonthlyText('05 Dec\nConcert\n13 Nov','2026-11');assert.equal(rows[0].date,'');assert.ok(rows[0].parseWarnings.length);assert.equal(rows[1].title,'');assert.ok(rows[1].parseWarnings.length);
});
test('same-line DEPT schedule still splits its title and venue and retains the monthly bar notice',()=>{
 const rows=parseMonthlyText('03 ร้าน HEY BAR | PRACHA CHUEN\n21 งาน CAT EXPO 13 | SIAM AMAZING PARK','2026-11');assert.equal(rows.length,2);assert.equal(rows[0].title,'HEY BAR');assert.equal(rows[0].venue,'PRACHA CHUEN');assert.ok(rows[0].note.includes('温馨提示'));assert.equal(rows[1].title,'CAT EXPO 13');
});
