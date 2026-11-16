// Copy editable content only; identities, publication and lifecycle history are independent.
export function copyEvent(source, id = crypto.randomUUID()) {
 const result={id,status:'draft',updated_at:null,scheduled_publish_at:null,attributes:{}};
 for(const key of ['title','date','time','location','location_region','company','artist_ids','event_type_id','participation_condition','description','ticket_url','venue_id'])
  if(source[key]!==undefined)result[key]=structuredClone(source[key]);
 for(const key of ['region','category','artist_type','artist_types','artist_selections','cp_ids','unmatched_artist','unmatched_import_names','time_text','picture_urls','note','rich_text','spectator_status','isofficial','prefer_activity_name'])
  if(source.attributes?.[key]!==undefined)result.attributes[key]=structuredClone(source.attributes[key]);
 return result;
}
