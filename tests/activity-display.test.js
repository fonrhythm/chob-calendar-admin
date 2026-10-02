import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvent,filterSortEvents} from '../src/lib/event-fields.js';
const base={title:'Party',date:'2026-10-30',location:'Hall',location_region:'Bangkok',status:'published',artist_ids:['a','b'],participation_condition:'free',attributes:{region:'泰国',end_date:'2026-10-31'}};
test('multi-day dates reject reversed and impossible dates',()=>{assert(!validateEvent(base));for(const end_date of ['2026-10-29','2026-02-30'])assert.match(validateEvent({...base,attributes:{...base.attributes,end_date}}),/结束日期/);});
test('CP search matches selected members without matching unrelated pairs',()=>{const artists=[{id:'a',name:'Daou Pittaya'},{id:'b',name:'Offroad Kantapon'}];const pairs=[{id:'cp',cp_name:'DaouOffroad',artist_1_id:'a',artist_2_id:'b'}];assert.equal(filterSortEvents([base],artists,[],{search:'daouoffroad',pairs}).length,1);assert.equal(filterSortEvents([{...base,artist_ids:['a']}],artists,[],{search:'daouoffroad',pairs}).length,0);});
