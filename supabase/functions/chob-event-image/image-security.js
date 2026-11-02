export const MAX_BYTES=10*1024*1024;
export function allowedRemote(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&['fbcdn.net','fbsbx.com'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host));}catch{return false;}}
export function imageMime(bytes){
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')return 'image/png';
 if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
 return '';
}
export async function limitedBytes(response){
 if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('图片不能超过 10 MB');
 const reader=response.body?.getReader();if(!reader)throw Error('图片为空');
 const chunks=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES)throw Error('图片不能超过 10 MB');chunks.push(value);}}catch(e){await reader.cancel();throw e;}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
