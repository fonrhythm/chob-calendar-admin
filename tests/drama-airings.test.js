import test from 'node:test';
import assert from 'node:assert/strict';
import {collectAirings} from '../src/drama/airings.js';
const rule={id:'r',platformId:'youtube',premiere:'2026-11-14',totalEpisodes:2,weekdays:[6],episodesPerRelease:1,time:'21:00',timezone:'Asia/Bangkok'};
test('one invalid plan cannot blank the library or remove valid airings',()=>{
 const good={id:'good',titleEn:'Good',rules:[rule]};
 const bad={id:'bad',titleEn:'Bad',rules:[{...rule,totalEpisodes:0}]};
 const result=collectAirings([bad,good]);
 assert.equal(result.slots.length,2); assert.equal(result.errors.length,1);
 assert.equal(result.errors[0].dramaId,'bad');assert.match(result.errors[0].message,/Bad/);
});
test('unknown total count remains editable and produces airings',()=>{
 const premiere=new Date().toISOString().slice(0,10);
 const result=collectAirings([{id:'unknown',titleEn:'Unknown',rules:[{...rule,premiere,weekdays:[new Date(premiere).getUTCDay()],totalEpisodes:null,totalEpisodesUnknown:true}]}]);
 assert.equal(result.errors.length,0);assert.ok(result.slots.length>0);
});
