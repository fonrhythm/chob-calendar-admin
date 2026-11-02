import test from 'node:test';import assert from 'node:assert/strict';import {runOcrSession} from '../src/lib/ocr-session.js';
test('OCR worker failure rejects visibly and releases the worker instead of hanging on a progress message',async()=>{
 let fail,terminated=0;const worker={terminate(){terminated++;}};
 await assert.rejects(runOcrSession(onError=>{fail=onError;return worker;},()=>{fail('模型运行错误');return new Promise(()=>{});} ),/模型运行错误/);assert.equal(terminated,1);
});
test('slow recognition can be stopped and still terminates its worker',async()=>{
 const abort=new AbortController();let terminated=0;
 const promise=runOcrSession(()=>({terminate(){terminated++;}}),()=>{abort.abort();return new Promise(()=>{});},{signal:abort.signal});await assert.rejects(promise,/已停止/);assert.equal(terminated,1);
});
test('timeout also covers initialization and releases a worker that arrives late',async()=>{
 let finish,terminated=0;const promise=runOcrSession(()=>new Promise(resolve=>{finish=resolve;}),()=>'',{timeoutMs:5});await assert.rejects(promise,/超时/);finish({terminate(){terminated++;}});await Promise.resolve();await Promise.resolve();assert.equal(terminated,1);
});
