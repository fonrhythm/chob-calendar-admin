export async function runOcrSession(start, run, {signal, timeoutMs=90000}={}) {
  let worker,finished=false,rejectStop;
  const stopped=new Promise((_,reject)=>{rejectStop=reject;});
  const fail=error=>rejectStop(error instanceof Error?error:new Error(String(error)));
  const cancel=()=>fail(new Error('已停止识别，可以缩小区域或修正文字后重试。'));
  const timer=setTimeout(()=>fail(new Error('识别超时，请缩小文字区域或改用常规识别。')),timeoutMs);
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  const pending=Promise.resolve().then(()=>signal?.aborted?Promise.reject(new Error('已停止识别')):start(fail));
  pending.then(value=>{worker=value;if(finished)Promise.resolve(worker.terminate()).catch(()=>{});},()=>{});
  try {
    worker=await Promise.race([pending,stopped]);
    return await Promise.race([run(worker),stopped]);
  } finally {
    finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    if(worker)await Promise.resolve(worker.terminate()).catch(()=>{});
  }
}
