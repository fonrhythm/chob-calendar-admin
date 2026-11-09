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

export function validateNewPlatform(name,logo='',existing=[]) {
 const cleaned=String(name||'').trim();
 if(!cleaned)throw Error('请填写平台名称');
 if(cleaned.length>100)throw Error('平台名称请控制在 100 字以内');
 const key=v=>String(v||'').normalize('NFKC').trim().toLocaleLowerCase();
 if(existing.some(p=>key(p.name)===key(cleaned)))throw Error('该平台已存在，请直接选择或编辑');
 if(logo){let url;try{url=new URL(logo);}catch{throw Error('Logo 请填写有效图片链接');}if(!['https:','http:'].includes(url.protocol))throw Error('Logo 仅支持 http 或 https 图片链接');}
 return {name:cleaned,logo:String(logo||'').trim()};
}
