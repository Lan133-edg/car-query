# 四方分工查询（网页版）

输入车号或修车工作号，即可查询车辆的分工分配情况（木件、铁件、车窗、卧铺、玻璃钢、钢门、塞拉门检修等工序的外协厂家）。

内置 **532 辆**真实分车数据（分车表.xls + 表外.xls，重叠车号以分车表为准）。

## 文件说明

| 文件 | 作用 |
|---|---|
| index.html | 页面 + 样式（搜索 / 结果卡 / 管理员登录 / 数据管理） |
| data.js | 内置车辆数据（532 辆，由小程序版 seed-data.js 转换） |
| app.js | 查询、CSV/Excel 解析、管理员逻辑 |

## 发布到 GitHub Pages（3 分钟，免费）

1. 打开 github.com 登录，点右上角 **+ → New repository**
2. 仓库名随意（如 `car-query`），选 **Public**，点 Create repository
3. 在新仓库页面点 **uploading an existing file**（或 Add file → Upload files）
4. 把本目录的 **3 个文件**（index.html、data.js、app.js）一起拖进去，点 **Commit changes**
5. 进入 **Settings → Pages**（左侧栏），在 Branch 处选 **main** + **/(root)**，点 Save
6. 等 1~2 分钟，页面顶部会出现访问地址：
   `https://你的用户名.github.io/car-query/`
7. 把这个链接发到群里，所有人点开即查，无需安装任何东西

> 更新数据时：改好 data.js 后回到仓库 → Add file → Upload files → 覆盖上传 → Commit，1 分钟后自动生效。

## 数据管理（管理员）

- 首页底部「🔒 数据管理」→ 账号 `sfcl` / 密码 `1234567890`
- 支持上传 Excel/CSV 或直接粘贴表格（第一行表头，必须含「车号」列）
- 两种导入模式：**覆盖全部** / **追加更新**（同车号以新数据为准）
- ⚠️ 注意：管理员导入的数据只保存在**当前浏览器**（localStorage），仅本机生效。要让所有人看到更新，请把新表发给维护者重新生成 data.js 并覆盖上传（同时把 index.html 里 `WEB_DATA_VERSION` 加 1，保证大家浏览器里的旧数据自动换新）

## 安全提醒

管理员账号密码写在前端 app.js 中（`ADMIN_USER / ADMIN_PASS`），仅用于防止误操作，**不是真正的安全防护**——懂技术的人打开源码就能看到。内部分工数据如涉密，请勿把仓库设为 Private 以外的公开范围（当前方案要求 Public 才能免费开 Pages；若数据敏感可改用 GitHub Pro 私有仓库 + Pages，或联系维护者调整方案）。

## 已上线

- GitHub 仓库：https://github.com/Lan133-edg/car-query
- 访问地址（GitHub Pages）：**https://lan133-edg.github.io/car-query/**
- 首次部署于 2026-10-30；更新数据时重生成 data.js 并推送到 main 分支，1 分钟后全群自动生效（记得 WEB_DATA_VERSION + 1）。
