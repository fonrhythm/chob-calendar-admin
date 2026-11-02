import {runOcrSession} from './ocr-session.js';
export async function recognizeMonthlyImage(image, progress, options = {}) {
  const {createWorker,PSM}=await import('tesseract.js');
  const root=new URL(import.meta.env.BASE_URL+'ocr/',location.origin).href;
  return runOcrSession(errorHandler=>createWorker(options.language==='eng'?['eng']:options.language==='tha'?['tha']:['tha','eng'],1,{workerPath:root+'worker.min.js',corePath:root+'core',langPath:root+(options.quality==='fast'?'lang-fast':'lang'),cachePath:options.quality==='fast'?'chob-monthly-fast-v1':'chob-monthly-best-int-v1',logger:m=>progress?.(m),errorHandler}),async worker=>{
    await worker.setParameters({tessedit_pageseg_mode:options.layout==='rows'?PSM.SINGLE_BLOCK:PSM.SPARSE_TEXT,preserve_interword_spaces:'1'});
    const result=await worker.recognize(image,options.rectangle?{rectangle:options.rectangle}:{},{text:true,blocks:true});
    const words=(result.data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>l.words||[]))).filter(w=>w.text?.trim());
    if(!words.length)return result.data.text;
    const rows=[];
    for(const word of words.sort((a,b)=>(a.bbox.y0+a.bbox.y1)-(b.bbox.y0+b.bbox.y1))){
      const center=(word.bbox.y0+word.bbox.y1)/2,height=word.bbox.y1-word.bbox.y0;
      let row=rows.find(row=>Math.abs(row.center-center)<=Math.max(8,Math.min(row.height,height)*.6));
      if(!row){row={center,height,words:[]};rows.push(row);}row.words.push(word);
    }
    return rows.sort((a,b)=>a.center-b.center).map(row=>{
      const words=row.words.sort((a,b)=>a.bbox.x0-b.bbox.x0);let text='';
      words.forEach((word,index)=>{const previous=words[index-1];const gap=previous?word.bbox.x0-previous.bbox.x1:0;
        text+=(index?(index>1&&gap>Math.max(35,row.height*2)?' | ':' '):'')+word.text;});return text;
    }).join('\n');
  },{signal:options.signal});
}
