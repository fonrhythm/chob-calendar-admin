import test from 'node:test';import assert from 'node:assert/strict';
import {locateImportFailure,importRowSignature} from '../src/lib/import-feedback.js';
test('server batch ordinal maps to original spreadsheet row after skipped rows and partial import',()=>{
 const submitted=[{line:4,event:{id:'a'}},{line:11,event:{id:'b'}},{line:29,event:{id:'c'}}];
 assert.deepEqual(locateImportFailure('第 2 条与已有活动的艺人、类型、地址和日期重复。',submitted),{id:'b',line:11,message:'原表第 11 行与已有活动的艺人、类型、地址和日期重复。'});
 assert.equal(locateImportFailure('第 3 条已存在，请刷新列表核对。',submitted).id,'c');
});
test('connection failures and invalid server ordinals are not attributed to an arbitrary row',()=>{
 const submitted=[{line:7,event:{id:'a'}}];
 for(const message of ['网络失败','第 0 条无效','第 2 条无效'])assert.equal(locateImportFailure(message,submitted),null);
});
test('row-specific server feedback expires when row content or shared import settings change',()=>{
 const a=importRowSignature({name:'A',date:'2026-11-01'},{region:'泰国'},'draft');
 assert.equal(a,importRowSignature({name:'A',date:'2026-11-01'},{region:'泰国'},'draft'));
 assert.notEqual(a,importRowSignature({name:'A',date:'2026-11-02'},{region:'泰国'},'draft'));
 assert.notEqual(a,importRowSignature({name:'A',date:'2026-11-01'},{region:'中国'},'draft'));
 assert.notEqual(a,importRowSignature({name:'A',date:'2026-11-01'},{region:'泰国'},'published'));
});
