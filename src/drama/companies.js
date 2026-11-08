export function productionCompanyOptions(catalog=[],selected='') {
 const names=new Map();
 for(const artist of catalog){if(artist.deleted_at)continue;for(const part of String(artist.company||'').split('/')){const name=part.trim();if(name&&!names.has(name.toLocaleLowerCase()))names.set(name.toLocaleLowerCase(),name);}}
 // Preserve a previously selected company even if its source artist is archived.
 if(selected&&!names.has(selected.toLocaleLowerCase()))names.set(selected.toLocaleLowerCase(),selected);
 return [...names.values()].sort((a,b)=>a.localeCompare(b));
}
