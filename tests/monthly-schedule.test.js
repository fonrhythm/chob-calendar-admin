import test from 'node:test';import assert from 'node:assert/strict';
import {parseMonthlyText,BAR_NOTICE,monthlyCandidates,mergeMonthlyLineup} from '../src/lib/monthly-schedule.js';
import {allowedRemote,imageMime,limitedBytes,MAX_BYTES} from '../supabase/functions/chob-event-image/image-security.js';
test('monthly-only parser preserves Thai evidence, validates dates, excludes booking footers and adds bar notice',()=>{
 const rows=parseMonthlyText('03 ร้าน HEY BAR | PRACHA CHUEN\n21 งาน CAT EXPO 13 | SIAM AMAZING PARK\n29 ร้าน OLD TIME CAFE | LAMPANG\n31 invalid\nSHOW BOOKING 081-448-0757\nPR K.FU 080-649-9562','2026-11');
 assert.equal(rows.length,4);assert.equal(rows[0].date,'2026-11-03');assert.equal(rows[0].form,'bar');assert.equal(rows[0].note,BAR_NOTICE);assert.equal(rows[1].form,'festival');assert.equal(rows[1].note,'');assert.equal(rows[3].date,'');assert.equal(rows[0].city,'');assert.ok(!rows[0].reviewed);
 assert.equal(parseMonthlyText('๐๓ ร้าน A | Bangkok','2026-11')[0].date,'2026-11-03');
 assert.equal(parseMonthlyText('O7 งาน Concert | Hall','2026-11')[0].date,'2026-11-07');
});
test('monthly music festival candidates use exact normalized title/date span, never the similar-event algorithm',()=>{
 const event={id:'festival',title:'CAT EXPO 13',date:'2026-11-21',location:'Park',status:'published',attributes:{end_date:'2026-11-22'}};
 assert.equal(monthlyCandidates({title:'Cat Expo 13',date:'2026-11-22',venue:'PARK'},[event])[0].exact,true);
 assert.equal(monthlyCandidates({title:'CAT EXPO 14',date:'2026-11-21',venue:'Park'},[event]).length,0);
 assert.equal(monthlyCandidates({title:'LEO Presents CAT EXPO 13',date:'2026-11-21',venue:'Park'},[event])[0].exact,false);
 assert.equal(monthlyCandidates({title:event.title,date:'2026-11-23',venue:'Park'},[event]).length,0);
 assert.equal(monthlyCandidates({title:event.title,date:event.date,venue:'Park'},[{...event,attributes:{admin_deleted_at:'now'}}]).length,0);
});
test('adding a lineup is idempotent and preserves existing festival details, poster, status and artist selections',()=>{
 const event={id:'e',title:'Festival',artist_ids:['old'],status:'published',description:'Full details',ticket_url:'https://tickets.example',attributes:{artist_selections:['old'],picture_urls:['https://poster.example'],note:'Original'}};
 const row={date:'2026-11-21',time:'',form:'festival'},common={artistId:'new',month:'2026-11',sourceUrl:'https://facebook.com/post',imageUrl:'https://saved.example/poster'};
 const merged=mergeMonthlyLineup(event,row,common,[{id:'new',categories:['BAND']}]);
 assert.deepEqual(merged.artist_ids,['old','new']);assert.equal(merged.description,event.description);assert.equal(merged.ticket_url,event.ticket_url);assert.deepEqual(merged.attributes.picture_urls,event.attributes.picture_urls);assert.equal(merged.attributes.note,'Original');assert.equal(merged.status,'published');
 assert.equal(mergeMonthlyLineup(merged,row,common,[]).attributes.monthly_lineups.length,1);assert.deepEqual(event.artist_ids,['old']);
});
test('remote image fetch rejects SSRF hosts/credentials/ports and checks actual image bytes and size',async()=>{
 assert.ok(allowedRemote('https://scontent.fbcdn.net/a.jpg?token=abc'));
 for(const url of ['http://scontent.fbcdn.net/a','https://fbcdn.net.evil.test/a','https://127.0.0.1/a','https://u:p@scontent.fbcdn.net/a','https://scontent.fbcdn.net:8443/a','file:///a'])assert.equal(allowedRemote(url),false);
 assert.equal(imageMime(new Uint8Array([255,216,255,0])),'image/jpeg');assert.equal(imageMime(new TextEncoder().encode('<svg onload="alert(1)">')),'');
 await assert.rejects(limitedBytes(new Response('x',{headers:{'content-length':MAX_BYTES+1}})),/10 MB/);
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_BYTES));c.enqueue(new Uint8Array(1));c.close();}});await assert.rejects(limitedBytes(new Response(stream)),/10 MB/);
});
