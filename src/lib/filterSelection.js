// null means all options; [] means none; arrays contain explicit choices.
export function toggleFilterSelection(current,value,options){
 const allowed=new Set(options);
 if(!allowed.has(value))return current;
 const selected=new Set((current||options).filter(option=>allowed.has(option)));
 if(current===null||(options.length>0&&options.every(option=>selected.has(option))))return [value];
 selected.has(value)?selected.delete(value):selected.add(value);
 return selected.size===options.length?null:options.filter(option=>selected.has(option));
}
export function toggleSentinelFilter(current,value,options){
 const next=toggleFilterSelection(current.length?current.filter(option=>option!=='__none__'):null,value,options);
 return next===null?[]:next.length?next:['__none__'];
}
