# CHOB Calendar 管理后台

当前版本包含艺人、CP、组合与乐队、活动与事项管理、表格导入、纠错审核、公告、重复活动处理及 Supabase 升级脚本。

## 本地启动与部署

使用 Node.js 24.15.0，执行 npm ci、npm run dev。生产构建执行 npm run build，输出目录 dist。部署至静态站点服务时配置 SPA 路由回退到 index.html。

环境变量：VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY；本地复制 .env.example 为 .env.local 后填写公开连接参数。不要放入 service_role 或 secret key。线上构建需要在托管服务单独设置这两项。

## 已有数据库升级

当前项目用户已执行004、005。只执行 supabase/upgrade_006_009.sql；不要对已有数据重新运行初始化脚本。升级脚本在事务中执行，先保留数据库备份。测试使用独立内存 PostgreSQL，不修改线上数据库。

后台仓库上传不等于后台已部署。前台演示数据独立于 Supabase，后台删除活动不会改变前台演示样例；前台切换 VITE_DATA_SOURCE=supabase 后才显示后台发布的数据。

验证：npm test（16项）；npm run build。

---

以下为早期阶段安装记录，功能范围描述已被上述当前版本说明取代。已有数据库不要按早期初始化步骤重建。

# Chob 艺人行程后台 · 第一阶段

本阶段已实现登录、邮箱注册、密码重置、管理员艺人管理、CP配对、CSV/Excel艺人导入预览、回收站和操作记录。

活动与事项管理、活动导入匹配/合并、定时发布、用户邀请与资料编辑、多维统计仍在后续阶段，当前不会展示模拟业务数据。公开日历网站没有改动。

## 先做什么

当前交付的是独立工作副本。原来的 `C:\software\chob-admin` 没有被覆盖。

建议先把压缩包解压到新的 `C:\software\chob-admin-stage1`，打开包含 `package.json` 的项目目录，完成下面的数据库和账号步骤，再测试网站。不要把这个源码压缩包直接当作 Cloudflare 的静态网站包上传。

### 1. 初始化数据库

进入你的 Supabase 项目，在 SQL Editor 新建查询。

打开本项目的 `supabase/001_foundation.sql`，复制**全部内容**到 SQL Editor，执行一次。

该脚本适用于你确认的7张空业务表，会保留原表，补齐账号关联、艺人字段、CP与日志，以及第一阶段所需权限。已有 Authentication 用户会获得普通的合作粉丝资料，不会自动变为管理员。脚本不会改邮箱验证有效期和密码规则。

如果提示“初始化前检测到业务资料”，请停在这里把错误发给我；不要删表。脚本在一个事务内执行，任意错误都会回滚。成功后重复执行也不会清空已有资料。

脚本不负责把所有后续需求一次建完；尤其不会开放活动/事项/邀请/会话/密码重置业务表的浏览器写入权限。

### 2. 建立网站登录账号

Supabase控制台账号和网站账号是两回事。

在 Supabase 的 **Authentication → Users** 中检查是否已有你准备用于网站登录的邮箱。如果没有，用 Add user / Create new user 创建。密码由你自己填写，不需要发给我。确保邮箱处于已验证状态；也可以通过网站注册并完成邮箱验证。

此时 `public.users` 会生成同一ID的用户资料，角色默认为 `collaborator_fan`。

### 3. 设置第一位管理员

打开 `supabase/002_first_admin.sql`，只把下面这行的占位文字换成刚创建的网站登录邮箱：

```sql
administrator_email text := '请替换为你的网站登录邮箱';
```

然后把整个文件复制到新查询中执行。这个脚本只设置第一位管理员，不开放任何人自行提升角色的接口。执行成功后退出网站重新登录。

### 4. 配置本地网站

把 `.env.example` 复制为 `.env.local`，填写项目的 **publishable key**（形如 `sb_publishable_...`）。项目URL已经填好。不要填写 secret 或 service_role key，也不要把 `.env.local` 上传到 GitHub。

在项目目录运行：

```powershell
npm.cmd ci
npm.cmd run dev
```

打开终端显示的网址，默认是 `http://127.0.0.1:5190`。登录后应看到真实的艺人、CP数量。

如果需要使用注册验证或重置密码邮件，在 Supabase **Authentication → URL Configuration** 中添加：

- `http://127.0.0.1:5190/`
- `http://127.0.0.1:5190/update-password`

部署完成后把 Site URL 设为正式网站地址，并添加正式网站对应的上述两个路径。邮件跳转地址必须在允许列表中。[Supabase说明](https://supabase.com/docs/guides/auth/redirect-urls)

## 艺人资料怎么准备

先准备10～20位真实艺人用于测试。页面可下载空白CSV模板，也可以使用项目中的 `templates/艺人导入模板.csv`。

| 列名 | 填写方式 |
| --- | --- |
| 艺人名称 / name | 必填；建议统一名字写法 |
| 英文名 / en_name | 可选，参与搜索 |
| 公司 / company | 可选，公司名称保持统一 |
| 类别 / categories | 可填多项，例如 `歌手;演员;BL演员` |
| 别名 / aliases | 可填多项，用分号隔开 |

目前一位艺人的公司是单个名称；一场活动的多家公司以后从多位关联艺人汇总。不要为了混合公司活动重复创建艺人。

支持UTF-8 CSV和 `.xlsx`；Excel读取**第一个工作表**。每批最多200位、文件不超过2MB。旧版 `.xls` 请先另存为 `.xlsx`。表头要放第一行。

导入时先显示预览，可以修改字段。缺名、重名会阻止提交，数据库已有同名艺人应去编辑原资料。点击确认才会写入；整批失败会回滚。此阶段的艺人建库导入不做活动的模糊匹配或合并，那属于后续活动导入流程。

艺人导入完成后，切到“CP配对”，输入CP名称，再选择两位不同艺人。关联了有效CP、活动或事项的艺人不能直接删除，需要先处理关联。

## 本次上线前验收

1. 管理员登录后，能新增、修改艺人；刷新后资料还在。
2. CSV与Excel预览中的中文、多类别显示正确，确认后数量更新。
3. 拼音、别名能找到相应艺人；公司、类别筛选正确。
4. 两位不同艺人能组成CP；相同成员不能组成CP。
5. 无关联的艺人可删除，并从回收站恢复；操作记录包含修改前后内容。
6. 普通账号能查看有效艺人，但看不到新增、编辑、导入按钮和操作日志。
7. 手机菜单可用，页面没有横向溢出。

本地已验证5组自动化测试（含PostgreSQL权限和事务测试），以及模拟接口下的桌面和390px手机浏览器流程。线上Supabase登录、邮件和Cloudflare部署尚需按此说明完成真实验收，未在你的数据库执行这些脚本。

## Cloudflare Pages 部署

少量资料测试通过后再部署。本项目是Vue静态应用，数据库仍在同一个Supabase项目中，部署不会搬走或清空资料。

推荐把这个**独立后台项目**放入新的GitHub仓库，再在Cloudflare的Workers & Pages里创建Pages项目并连接仓库。

构建配置：

| 配置 | 值 |
| --- | --- |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 根目录 | 仓库根目录（如果package.json在子目录，选那个子目录） |
| NODE_VERSION | `22` |
| VITE_SUPABASE_URL | 项目URL |
| VITE_SUPABASE_PUBLISHABLE_KEY | 项目的publishable key |

部署环境变量改变后需要重新构建。`public/_redirects` 已提供单页应用路由回退，部署后应测试直接刷新 `/artists` 能否正常打开。[Cloudflare Vue部署说明](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vue-site/)、[构建配置](https://developers.cloudflare.com/pages/configuration/build-configuration/)

本交付不包含 `.env.local`、`node_modules` 或 `dist`，需要安装依赖并构建。不要把数据库管理员密钥放进任何 `VITE_` 变量。

## 主要文件位置

| 文件 | 修改内容 |
| --- | --- |
| `src/pages/ArtistsPage.vue` | 艺人列表、筛选、编辑、CP、导入预览 |
| `src/lib/artists.js` | CSV解析、导入字段、拼音搜索和重复检查 |
| `src/lib/api.js` | 数据读取和受控写入请求 |
| `src/stores/authStore.js` | 登录、账号资料、认证状态 |
| `src/config/supabase.js` | 连接Supabase与登录保存方式 |
| `src/pages/UpdatePassword.vue` | 邮件跳转后的新密码表单 |
| `src/layouts/DashboardLayout.vue` | 电脑侧栏、手机导航 |
| `src/pages/FoundationDashboard.vue` | 本阶段真实数量首页 |
| `src/pages/AuditPage.vue` | 最近200条操作记录 |
| `src/main.css` / `tailwind.config.js` | 颜色、按钮、公共样式 |
| `supabase/001_foundation.sql` | 数据库结构、权限与受控写入函数 |
| `supabase/002_first_admin.sql` | 第一位管理员初始化 |
| `tests/foundation.test.js` | 导入和数据库权限测试 |

数据库函数遵循Supabase建议，限制调用权限并固定安全搜索路径；用户资料通过Auth触发器同步。[数据库函数](https://supabase.com/docs/guides/database/functions)、[用户资料关联](https://supabase.com/docs/guides/auth/managing-user-data)
