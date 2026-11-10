import test from 'node:test';import assert from 'node:assert/strict';import {toggleFilterSelection,toggleSentinelFilter} from '../src/lib/filterSelection.js';
const options=['BL','GL','BG'];
test('clicking an option from all isolates it, then supports additive selection and deselection',()=>{
 assert.deepEqual(toggleFilterSelection(null,'BL',options),['BL']);
 assert.deepEqual(toggleFilterSelection(options,'BL',options),['BL']);
 assert.deepEqual(toggleFilterSelection(['BL'],'GL',options),['BL','GL']);
 assert.deepEqual(toggleFilterSelection(['BL','GL'],'BL',options),['GL']);
 assert.deepEqual(toggleFilterSelection(['BL'],'BL',options),[]);
 assert.deepEqual(toggleFilterSelection([],'BL',options),['BL']);
 assert.equal(toggleFilterSelection(['BL','GL'],'BG',options),null);
});
test('frontend all/none sentinels keep the same click semantics',()=>{
 assert.deepEqual(toggleSentinelFilter([],'BL',options),['BL']);
 assert.deepEqual(toggleSentinelFilter(['__none__'],'BL',options),['BL']);
 assert.deepEqual(toggleSentinelFilter(['BL'],'BL',options),['__none__']);
 assert.deepEqual(toggleSentinelFilter(['BL','GL'],'BG',options),[]);
});
