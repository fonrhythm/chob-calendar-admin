export function createDramaRepository(client) {
 const check = result => {if(result.error)throw Error(result.error.message);return result.data;};
 async function rows(table){return check(await client.from(table).select('*'));}
 return {
  async load(){const [series,notices,events,platforms,drafts]=await Promise.all([rows('drama_series'),rows('drama_notices'),rows('drama_event_links'),rows('drama_platforms'),rows('drama_drafts')]);return {dramas:series.filter(r=>r.state!=='archived').map(r=>({...r.data,id:r.id,_version:r.version})),changes:notices.map(r=>r.change),events:events.map(r=>({...r.data,id:r.id,dramaId:r.series_id,_version:r.version,eventId:r.event_id})),platforms,drafts:drafts.map(r=>({...r.data,id:r.id,_draft:true})),artists:[]};},
  async save(drama){const payload=JSON.parse(JSON.stringify(drama));delete payload._version;delete payload._draft;return check(await client.rpc('chob_drama_save',{payload,expected_version:drama._version||0}));},
  async archive(ids){return check(await client.from('drama_series').update({state:'archived'}).in('id',ids));},
  async saveDraft(drama){return check(await client.from('drama_drafts').upsert({id:drama.id,data:JSON.parse(JSON.stringify(drama)),updated_at:new Date().toISOString()},{onConflict:'id'}));},
  async deleteDraft(id){return check(await client.from('drama_drafts').delete().eq('id',id));},
  async change(slot,form,version){return check(await client.rpc('chob_drama_change',{airing_id:slot.id,new_date:form.date,new_time:form.time,content:form.content,expected_version:version}));},
  async saveEvent(event){const data=JSON.parse(JSON.stringify(event));delete data._version;const payload={series_id:event.dramaId,data};if(event._version){const result=check(await client.from('drama_event_links').update({...payload,version:event._version+1}).eq('id',event.id).eq('version',event._version).select().single());if(!result)throw Error('活动已被更新，请刷新后重试');return result;}return check(await client.from('drama_event_links').insert({id:event.id,...payload}));},
  async createPlatform(platform){return check(await client.from('drama_platforms').insert(platform).select().single());},
  async savePlatform(platform){return check(await client.from('drama_platforms').upsert(platform));}
 };
}
