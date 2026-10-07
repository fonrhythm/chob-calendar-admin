const normalize=value=>String(value||'').normalize('NFKC').trim().toLowerCase();
export function canonicalLink(value){
 try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol))return null;u.hash='';return u.href;}catch{return null;}
}
export function matchEventLinks(facts,events,artistIds=[]) {
 const ticket=canonicalLink(facts.ticket_url),picture=canonicalLink(facts.picture_url);
 const candidates=events.filter(e=>!e.attributes?.admin_deleted_at&&!e.attributes?.merged_into&&(
  ticket&&canonicalLink(e.ticket_url)===ticket||picture&&(e.attributes?.picture_urls||[]).some(p=>canonicalLink(p)===picture)));
 if(!candidates.length)return {kind:'none',candidates:[]};
 if(candidates.length!==1)return {kind:'ambiguous',candidates:candidates.map(e=>e.id)};
 const event=candidates[0],conflicts=[];
 if(facts.date&&event.date&&facts.date!==event.date)conflicts.push('date');
 if(facts.location&&event.location&&normalize(facts.location)!==normalize(event.location))conflicts.push('location');
 if(facts.time&&event.time&&facts.time.slice(0,5)!==event.time.slice(0,5))conflicts.push('time');
 if(artistIds.length&&event.artist_ids?.length&&JSON.stringify([...new Set(artistIds)].sort())!==JSON.stringify([...new Set(event.artist_ids)].sort()))conflicts.push('artists');
 // Shared ticket pages/posters can represent multiple sessions. Require corroboration.
 const corroborated=!!facts.date&&facts.date===event.date&&(artistIds.length>0||!!facts.location&&normalize(facts.location)===normalize(event.location));
 return {kind:conflicts.length?'conflict':corroborated?'unique':'insufficient',event,candidates:[event.id],conflicts};
}
