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
