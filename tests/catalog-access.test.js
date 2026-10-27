import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const routeSource=fs.readFileSync(new URL('../src/router/index.js',import.meta.url),'utf8');
function routerFor(profile,ready=true){
 const auth={user:{id:'test'},isAuthenticated:true,ready,userProfile:profile};
 const router={beforeEach(fn){this.guard=fn;}};
 const code=routeSource.replace(/^import .*;\r?\n/gm,'').replace('import.meta.env.BASE_URL',"'/'").replace('export default router;', 'result.router=router;');
 const result={};
 vm.runInNewContext(code,{createRouter:options=>{router.options=options;return router;},createWebHistory:()=>({}),useAuthStore:()=>auth,configurationError:'',recoveryPending:{value:false},CommunityPage:{},AuditPage:{},UsersPage:{},MembersPage:{},AccountProfile:{},document:{title:''},result});
 return router;
}
async function navigate(role,ready=true){
 const router=routerFor({role},ready),parent=router.options.routes.find(r=>r.path==='/'),route=parent.children.find(r=>r.path==='artists');
 let destination='allowed';
 await router.guard({...route,fullPath:'/artists',matched:[parent,route]}, {}, value=>{destination=value??'allowed';});
 return destination;
}
function menuFor(role){
 const file=fs.readFileSync(new URL('../src/layouts/DashboardLayout.vue',import.meta.url),'utf8');
 const source=file.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?\n/gm,'');
 const result={};
 vm.runInNewContext(source+'\nresult.items=items.value;',{useAuthStore:()=>({userProfile:{role}}),useRouter:()=>({}),useRoute:()=>({fullPath:'/'}),ref:value=>({value}),computed:fn=>({get value(){return fn();}}),watch:()=>{},result});
 return result.items.map(item=>item.path);
}
test('approved collaborator can open the actual artist route and sees its menu; admin retains access',async()=>{
 for(const role of ['admin','collaborator_fan']){
  assert.equal(await navigate(role),'allowed');
  assert.ok(menuFor(role).includes('/artists'));
 }
 assert.ok(!menuFor('collaborator_fan').includes('/users'));
});
test('artist route still enforces backend approval and excludes other roles',async()=>{
 assert.equal((await navigate('collaborator_fan',false)).name,'AccountStatus');
 for(const role of ['official_account','company_staff','unknown']){
  assert.equal((await navigate(role)).name,'Dashboard');
  assert.ok(!menuFor(role).includes('/artists'));
 }
});
