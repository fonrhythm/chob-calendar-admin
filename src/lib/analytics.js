export const csvCell=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,"'"+'$&').replaceAll('"','""')+'"';
export const csvText=rows=>'\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
export const percent=(n,total)=>total?((n/total)*100).toFixed(1)+'%':'—';
