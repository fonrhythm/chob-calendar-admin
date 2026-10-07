import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareBrowserReviews,importBrowserReviews} from '../src/lib/browser-review-import.mjs';
const batch=JSON.parse(await readFile(new URL('./fixtures/browser-evidence.json',import.meta.url),'utf8'));
test('browser import validates all records before writes and preserves separate images',async()=>{
 const rows=prepareBrowserReviews(batch);assert.equal(rows[2].review.evidence.raw.ocr_texts.length,2);assert.equal(rows[0].source.source_type,'unknown');
 const b=structuredClone(batch);b.records[2].post.account='other';let writes=0;
 await assert.rejects(()=>importBrowserReviews(b,{saveSource:async()=>writes++}),/身份/);assert.equal(writes,0);
 const image=structuredClone(batch);image.records[2].image_transcriptions[0].url+='?other=1';assert.throws(()=>prepareBrowserReviews(image),/图片/);
});
test('partial failures are retryable, existing reviews including resolved ones skip; no event writes',async()=>{
 const sources=new Map(),reviews=new Set();let fail=true;
 const io={saveSource:async s=>{sources.set(s.url,s);return s.url},hasReview:async id=>reviews.has(id),saveReview:async r=>{if(fail&&r.source_id.includes('DomundiTV'))throw Error('offline');reviews.add(r.source_id)}};
 const first=await importBrowserReviews(batch,io);assert.deepEqual(first.map(r=>r.action),['review','failed','review']);fail=false;
 const retry=await importBrowserReviews(batch,io);assert.deepEqual(retry.map(r=>r.action),['duplicate','review','duplicate']);assert.equal(sources.size,3);assert.equal(reviews.size,3);
});
