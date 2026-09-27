import {test} from 'node:test';import assert from 'node:assert/strict';
import {displayArtistName,artistPayload,rowsToArtists} from '../src/lib/artists.js';
import {groupSaveError,rpcError} from '../src/lib/rpc-errors.js';
test('optional display name takes priority without modifying canonical identity',()=>{
 assert.equal(displayArtistName({name:'Full Name',en_name:'Nickname'}),'Nickname');
 assert.equal(displayArtistName({name:'Full Name',en_name:'  '}),'Full Name');
 assert.equal(artistPayload({name:'Full Name',en_name:'Nickname'}).name,'Full Name');
 assert.equal(rowsToArtists([['艺人名称','显示名称'],['Full Name','Nickname']])[0].en_name,'Nickname');
});
test('group errors preserve actual permission/validation errors instead of falsely blaming installation',()=>{
 assert.equal(groupSaveError(rpcError({code:'42501',message:'permission denied for function chob_save_group'})),'permission denied for function chob_save_group（42501）');
 assert.match(groupSaveError(rpcError({code:'PGRST203',message:'ambiguous'})),/参数冲突/);
});
