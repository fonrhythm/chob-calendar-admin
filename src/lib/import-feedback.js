export function importRowSignature(raw, defaults, mode) {
  return JSON.stringify([raw, defaults, mode]);
}
export function locateImportFailure(message, submitted) {
  const match=String(message||'').match(/第\s*(\d+)\s*条/);
  if(!match)return null;
  const index=Number(match[1])-1,row=submitted[index];
  if(!row||index<0)return null;
  const detail=String(message).replace(/第\s*\d+\s*条/,`原表第 ${row.line} 行`);
  return {id:row.event.id,line:row.line,message:detail};
}
