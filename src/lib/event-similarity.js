const normalized = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => { const chars = Array.from(s), result = new Map(); for (let i=0;i<chars.length-1;i++) {const g=chars[i]+chars[i+1];result.set(g,(result.get(g)||0)+1);} return result; };
  const x=grams(a),y=grams(b);let shared=0,total=0;
  for(const [g,n] of x){shared+=Math.min(n,y.get(g)||0);total+=n;}
  for(const n of y.values())total+=n;
  return total ? 2*shared/total : 0;
}
const endDate = e => e.attributes?.end_date && e.attributes.end_date >= e.date ? e.attributes.end_date : e.date;
export function findSimilarEvents(events, threshold=0.8) {
  const rows=events.filter(e=>!e.attributes?.admin_deleted_at&&e.date).map(e=>({event:e,title:normalized(e.title),artists:new Set(e.artist_ids||[]),end:endDate(e)})).sort((a,b)=>a.event.date.localeCompare(b.event.date));
  const pairs=[];
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a=rows[i],b=rows[j];if(b.event.date>a.end)break;
    if(a.event.id===b.event.id)continue;
    const title=titleSimilarity(a.title,b.title);if(title<0.6)continue;
    const intersection=[...a.artists].filter(id=>b.artists.has(id)).length;
    const union=new Set([...a.artists,...b.artists]).size;
    const artist=union?intersection/union:0;
    // Dates must overlap. Empty artist lists do not count as a match.
    const score=0.5*title+0.3+0.2*artist;
    if(score+Number.EPSILON>=threshold)pairs.push({key:[a.event.id,b.event.id].sort().join(':'),events:[a.event,b.event],score,percent:Math.floor(score*100+1e-8),titlePercent:Math.round(title*100),artistPercent:Math.round(artist*100)});
  }
  return pairs.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
}
