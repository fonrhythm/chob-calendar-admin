export function safeImageUrl(value){try{const u=new URL(String(value).trim());return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
export function dramaImages(drama={}){const raw=Array.isArray(drama.images)?drama.images:typeof drama.images==='string'?drama.images.split(/\r?\n/):[drama.poster];return [...new Set(raw.map(safeImageUrl).filter(Boolean))];}
export function validateDramaImages(drama){const raw=Array.isArray(drama.images)?drama.images:[drama.poster];if(raw.some(url=>String(url||'').trim()&&!safeImageUrl(url)))throw Error('请填写有效的 http 或 https 图片链接');}
