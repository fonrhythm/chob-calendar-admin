import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogRowFacets, matchesCatalogRow, MISSING } from '../src/lib/catalogFilters.js';
const artists = [
  {id:'a',name:'Alice',company:'GMMTV',categories:['GL','ACTOR']},
  {id:'b',name:'Bob',company:'Genie',categories:['SINGER']},
  {id:'c',name:'Cathy',company:'GNEST',categories:['IDOL']},
  {id:'d',name:'Dan',company:'Other',categories:['BL']},
  {id:'e',name:'Empty',company:null,categories:[]},
];
const filters = {query:'',companies:null,categories:null,trash:false};
test('three selected companies include all three and exclude other companies',()=>{
  const found=artists.filter(a=>matchesCatalogRow(a,'artists',artists,{...filters,companies:['gmmtv','genie','gnest']}));
  assert.deepEqual(found.map(a=>a.id),['a','b','c']);
});
test('multiple categories use OR, company and category use AND; no selection differs from all',()=>{
  assert.equal(matchesCatalogRow(artists[0],'artists',artists,{...filters,companies:['gmmtv'],categories:['gl','singer']}),true);
  assert.equal(matchesCatalogRow(artists[1],'artists',artists,{...filters,companies:['gmmtv'],categories:['gl','singer']}),false);
  assert.equal(matchesCatalogRow(artists[0],'artists',artists,{...filters,companies:[]}),false);
  assert.equal(matchesCatalogRow(artists[4],'artists',artists,filters),true);
  assert.equal(matchesCatalogRow(artists[4],'artists',artists,{...filters,companies:[MISSING],categories:[MISSING]}),true);
});
test('CP company and type filters follow members and support member name searches',()=>{
  const cp={cp_name:'Together',artist_1_id:'a',artist_2_id:'b'};
  assert.deepEqual(catalogRowFacets(cp,'cp',artists).companies,['gmmtv','genie']);
  assert.equal(matchesCatalogRow(cp,'cp',artists,{...filters,companies:['genie'],categories:['gl']}),true);
  assert.equal(matchesCatalogRow(cp,'cp',artists,{...filters,companies:['gnest']}),false);
  assert.equal(matchesCatalogRow(cp,'cp',artists,{...filters,query:'Alice'}),true);
  assert.equal(matchesCatalogRow(cp,'cp',artists,{...filters,query:'unmatched'}),false);
});
test('groups filter their own identity rather than member professions; recycle bin remains isolated',()=>{
  const group={id:'g',name:'Music Duo',company:'Genie',categories:['GROUP'],group_kind:'group',group_member_ids:['a','b']};
  assert.equal(matchesCatalogRow(group,'group',artists,{...filters,companies:['genie'],categories:['group'],query:'Bob'}),true);
  assert.equal(matchesCatalogRow(group,'group',artists,{...filters,categories:['idol']}),false);
  assert.equal(matchesCatalogRow({...group,deleted_at:'2026-10-28'},'group',artists,filters),false);
  assert.equal(matchesCatalogRow({...group,deleted_at:'2026-10-28'},'group',artists,{...filters,trash:true}),true);
});
