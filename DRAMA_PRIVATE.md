# Drama 数据库部署与录入状态

2026-11-08。已按用户本轮明确授权修改 Chobcalendar Supabase 的新增 Drama 结构；没有发布网站、推送 main 或改动既有 Schedule 业务表与策略。

## 已部署并实测

9 张 Drama 表：drama_release、drama_platforms、drama_series、drama_cast、drama_rules、drama_airings、drama_notices、drama_event_links、drama_drafts。

2 个 SECURITY INVOKER 接口：chob_drama_save、chob_drama_change。使用真实现有 chob_private.is_admin() 权限判断，RLS 仅管理员读写。所有新表 RLS 已开启，匿名可读表 0，匿名可执行新增函数 0。发布开关 enabled=false，未建立公开发布路径。

管理员保存会在一个数据库事务内校验剧名/类型/卡司外键/排期并生成播出记录；版本冲突阻止覆盖；有公告历史时阻止覆盖整组排期。改期保留原播出记录，新增替代记录和公告。草稿允许不完整资料，不排播。

真实数据库使用管理员权限上下文，在事务内完成新增、三集排播、改期、旧记录保留、公告和草稿测试，最后整体回滚。复查正式库 series/airings/drafts/notices 均为 0，没有遗留验收样本。原艺人和活动无写入。

现有安全检查警告保持基线；此次复查没有新增 Drama 安全告警。初次验收发现既有 require_admin() 对普通 authenticated 不可执行，已将新增接口修正为直接使用可用的 is_admin() 判断，并重新通过真实库验收；没有扩大旧函数权限。

## 已接入的私有界面

后台私有录入：http://127.0.0.1:4182/drama

这是现有后台应用的本地开发版，必须以原管理员账号登录。剧集/卡司/公司、云端草稿、自动排播、单集改期公告、平台配置、未公开活动关联均接入数据库。读取失败不会替换为示例资料；旧 http://127.0.0.1:4181/drama-preview.html 仍是隔离示例编辑器，不是云端录入入口。

云端私有前端预览：http://127.0.0.1:4180/?dramaSource=cloud#drama

该模式需在前端使用管理员账号登录，才能读云端私有数据。它和原始示例预览分开，不会把测试文件内容导入正式数据库。私有活动只在此模式的 Schedule 中显示，没有写入正式公开 events。

## 验证与边界

前端 97 项测试、后台 88 项测试通过；原前后台构建、两端预览构建通过；管理员页面和数据模块 HTTP 200；真实数据库验收回滚通过。

尚未完成真人账号的浏览器登录与完整录入操作验收。当前没有远程测试网站，此处地址仅本机。数据库接口验收不等于浏览器全流程验收。

前端普通用户投稿仍保存在本机待提交列表，正式投稿/审核尚未接通。公开只读接口、反爬接入、发布权限策略、实际 events 双向同步和最终上线回归仍待完成。不得宣称整个 Drama V1 已可公开上线。

## 回退

新增结构是独立增量。supabase/drama-v1-freeze.sql 可冻结新增接口和表访问，并保留用户录入资料；不自动运行、不删除任何记录。部署定义保存在 supabase/drama-v1.sql，正式迁移历史已由 Supabase 记录。环境文件仅包含公开发布密钥，保持 Git 忽略；无 service-role 密钥进入客户端。
