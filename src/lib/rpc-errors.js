export function rpcError(error) {
 const result = new Error(error.code === '23505' ? '名称重复，请核对现有资料后重试。' : error.message);
 result.code=error.code; result.details=error.details; result.hint=error.hint; return result;
}
export function groupSaveError(error) {
 if(error.code==='PGRST203') return '数据库存在多个同名组合保存接口，参数冲突。请执行 012_group_save_display.sql 修复接口。';
 if(error.code==='PGRST202') return '数据库尚未找到这组参数对应的组合保存接口。请执行 012_group_save_display.sql，然后刷新。';
 return error.message + (error.code ? '（'+error.code+'）' : '');
}
