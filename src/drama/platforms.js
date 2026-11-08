const catalog = [
 {id:'youtube',aliases:['youtube','yt','油管'],file:'youtube.ico'},
 {id:'iqiyi',aliases:['iqiyi','爱奇艺','愛奇藝','iqiyiinternational','爱奇艺国际版'],file:'iqiyi.ico'},
];
const normalize = value => String(value||'').trim().toLowerCase().replace(/[\s·._-]/g,'');
export function matchedPlatform(platform={}) {
 const name=normalize(platform.name);
 return catalog.find(p=>p.aliases.some(alias=>normalize(alias)===name)) || (!name ? catalog.find(p=>p.id===normalize(platform.id)) : undefined);
}
export function resolvePlatformLogo(platform={},base='/') {
 if(platform.logo){try{const url=new URL(platform.logo);if(['https:','http:'].includes(url.protocol))return url.href;}catch{}}
 const match=matchedPlatform(platform);
 return match?`${base.endsWith('/')?base:base+'/'}platforms/${match.file}`:'';
}
