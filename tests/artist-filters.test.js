import {test} from 'node:test';
import assert from 'node:assert/strict';
import {artistTypeKey, matchesArtistTypes, normalizeSearch} from '../src/lib/artistFilters.js';
test('artist filters map all seven backend types without case sensitivity',()=>{
 for(const [raw,label] of [['ACTOR','演员'],['BL','泰腐'],['GL','泰百'],['GROUP','男女团'],['goup','男女团'],['OTHER','其他'],['SINGER','歌手'],['band','乐队']]) assert.equal(artistTypeKey(raw),artistTypeKey(label));
});
test('mixed event types match any selected category, including catalog members',()=>{
 const event={artist_types:['BL','GL','演员'],category:'other'};
 for(const type of ['bl','gl','actor']) assert(matchesArtistTypes(event,[],[type]));
 assert(!matchesArtistTypes(event,[],['singer']));
 assert(!matchesArtistTypes(event,[],['__none__']));assert(matchesArtistTypes(event,[],[]));
 assert(matchesArtistTypes({artist_ids:['a']},[{id:'a',categories:['SINGER']}],['singer']));
 assert(matchesArtistTypes({artist_ids:['g']},[{id:'g',group_kind:'band',group_member_ids:['a']},{id:'a',categories:['ACTOR']}],['actor']));
 assert(matchesArtistTypes({category:'bl'},[],['bl']));
});
test('search normalizes mixed case, fullwidth letters and extra whitespace',()=>{
 assert.equal(normalizeSearch(' Ｄａｏｕ  OFFROAD '),normalizeSearch('daou offroad'));
 assert(normalizeSearch('Charlotte Austin').includes(normalizeSearch('CHARLOTTE')));
});

test('ensemble is an additional artist type, separate from the existing group label',()=>{
 assert.equal(artistTypeKey('组合'),'ensemble');assert.equal(artistTypeKey('ENSEMBLE'),'ensemble');
 assert.equal(artistTypeKey('男女团'),'group');assert.equal(artistTypeKey('GROUP'),'group');
});
test('group selections and their member types are available on linked events',()=>{
 const catalog=[{id:'team',group_kind:'group',categories:['GROUP'],group_member_ids:['person']},{id:'person',categories:['ACTOR']}];
 const event={artist_ids:['person'],artist_selections:['team']};
 assert(matchesArtistTypes(event,catalog,['ensemble']));assert(matchesArtistTypes(event,catalog,['actor']));assert(matchesArtistTypes(event,catalog,['group']));
 assert(!matchesArtistTypes({artist_ids:['person']},catalog,['ensemble']));
 assert(matchesArtistTypes({artist_types:['组合']},[],['ensemble']));
 assert(!matchesArtistTypes({artist_ids:['band']},[{id:'band',group_kind:'band',categories:['BAND']}],['ensemble']));
 assert(!matchesArtistTypes({artist_ids:['cp:x']},[{id:'cp:x',categories:['CP'],member_ids:['p1','p2']}],['ensemble']));
 assert(!matchesArtistTypes(event,catalog,['__none__']));assert(matchesArtistTypes(event,catalog,[]));
});

test('legacy GROUP labels do not turn solo members into structural groups',()=>{assert(!matchesArtistTypes({artist_ids:['p'],artist_types:['组合']},[{id:'p',categories:['GROUP']}],['ensemble']));assert(matchesArtistTypes({artist_ids:['p'],artist_types:['组合']},[{id:'p',categories:['GROUP']}],['group']));});
