import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeEventWorkspace} from '../src/lib/submission-events.js';
test('submission management stays separate after approval and across tasks and trash',()=>{
 const w={events:[{id:'own'},{id:'approved',user_submitted:true,status:'published'},{id:'pending',user_submitted:true,status:'draft'}],deletedEvents:[{id:'own-trash'},{id:'user-trash',user_submitted:true}],tasks:[{id:'a',event_id:'own'},{id:'b',event_id:'approved'}],artists:[]};
 const own=scopeEventWorkspace(w,false),submitted=scopeEventWorkspace(w,true);
 assert.deepEqual(own.events.map(e=>e.id),['own']);
 assert.deepEqual(submitted.events.map(e=>e.id),['approved','pending']);
 assert.deepEqual(submitted.tasks.map(t=>t.id),['b']);
 assert.deepEqual(own.deletedEvents.map(e=>e.id),['own-trash']);
 assert.equal(w.events.length,3);
});
