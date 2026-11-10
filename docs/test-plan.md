# M6 全量测试计划（P0+P1 全功能）

> 版本：2026-11-10 · 范围：M0–M5 回归 + M6 十五项新功能（P0×7 + P1×8）
> 执行约束：vitest `fileParallelism: true` + `forks.maxForkThreads: 2`（全程最多 2 并发）
> 自动化标记：`auto·文件名` = vitest 自动化；`manual` = 浏览器人工验证；`auto(已有)` = 既有用例回归

## 0. 环境与公共前置

| 项     | 值                                                                          |
| ------ | --------------------------------------------------------------------------- |
| 测试库 | vitest global-setup 自动创建 `agentpm_test`，push schema + truncate         |
| 隔离   | 每测试文件 `createWorld()`：随机后缀项目 key / 账号 / agent token           |
| 账号   | `admin`（实例管理员）、`user2`（普通 MEMBER）、`bot-*`（AGENT）             |
| HTTP   | `app.inject()`（不起真实端口）；附件/CSV 走同一通道                         |
| 邮件   | SMTP_HOST 缺省=关闭；邮件用例向 `mailer.setMailSender()` 注入假 sender 断言 |

## 1. 认证与会话（AUTH）— `auto(已有) auth.test.ts`

| ID      | 用例                        | 步骤摘要                        | 预期                 |
| ------- | --------------------------- | ------------------------------- | -------------------- |
| AUTH-01 | 注册新用户                  | POST /v1/auth/register 合法载荷 | 201，密码哈希落库    |
| AUTH-02 | 重复注册                    | 同名再注册                      | 409                  |
| AUTH-03 | 登录成功/失败               | 正确与错误密码各一次            | 200 + cookie / 401   |
| AUTH-04 | 未登录访问受保护接口        | 无 cookie GET /v1/projects      | 401                  |
| AUTH-05 | 登出后 cookie 失效          | 登出再用旧 cookie               | 401                  |
| AUTH-06 | 弱密码拒绝                  | `password: '123'`               | 400 VALIDATION       |
| AUTH-07 | mustChangePassword 强制改密 | 管理员建账后登录                | 标记存在，改密后清除 |

## 2. 团队成员管理（USR，M5.5）— `auto(已有) users.test.ts`

| ID     | 用例                                   | 预期                          |
| ------ | -------------------------------------- | ----------------------------- |
| USR-01 | 管理员创建用户（账号/密码/姓名/email） | 201，密码可登录               |
| USR-02 | 重置密码                               | 新密码可登录、旧密码失效      |
| USR-03 | 停用/启用                              | 停用后登录 401、token 不可用  |
| USR-04 | 管理员开关                             | 非管理员拿不到 admin stats    |
| USR-05 | 头像上传 dataURL                       | 落库并回显                    |
| USR-06 | 个人 API Token mint/list/revoke        | 明文只出现一次；revoke 后 401 |
| USR-07 | 普通用户仅能改自己资料                 | 改他人 403                    |
| USR-08 | 搜索/类型过滤                          | q 与 type 参数生效            |

## 3. 项目与成员 RBAC（PRJ）— `auto(已有) projects.test.ts`

| ID     | 用例                     | 预期                                 |
| ------ | ------------------------ | ------------------------------------ |
| PRJ-01 | 创建项目（OWNER）        | 201；初始工作流/workflow 默认生成    |
| PRJ-02 | 加成员四种角色           | OWNER/ADMIN/MEMBER/VIEWER/AGENT 落库 |
| PRJ-03 | 非成员不可见项目         | 404（不泄露存在性）                  |
| PRJ-04 | VIEWER 只读              | 写操作 403                           |
| PRJ-05 | MEMBER 可建 issue/评论   | 200/201                              |
| PRJ-06 | 仅 ADMIN 可改设置/加成员 | MEMBER 403                           |
| PRJ-07 | 移除成员                 | 成员列表更新；其 issue 保留          |
| PRJ-08 | 私有项目可见性           | private 时非成员列表不可见           |

## 4. Issue 生命周期与并发（ISS）— `auto(已有) issues.test.ts`

| ID     | 用例                                         | 预期                           |
| ------ | -------------------------------------------- | ------------------------------ |
| ISS-01 | 建号规则 KEY-1 递增                          | 同项目连续编号                 |
| ISS-02 | 更新标题/描述/优先级/标签                    | 200 且审计 `issue.updated`     |
| ISS-03 | 流转受迁移表约束                             | 非法 from→to 400               |
| ISS-04 | 指派产生通知                                 | assignee 收到 `issue.assigned` |
| ISS-05 | 完成（DONE 类别）产生通知                    | watcher 收到 `issue.completed` |
| ISS-06 | watch/unwatch                                | 列表与去重正确                 |
| ISS-07 | claim（AGENT）抢单                           | 未指派→自己；已指派 409        |
| ISS-08 | claim 并发互斥                               | 两个 agent 同抢一个，恰一成功  |
| ISS-09 | 子任务/父子关系                              | parent 校验同项目              |
| ISS-10 | 搜索过滤（q/state/assignee/priority/sprint） | 各参数生效、分页稳定           |
| ISS-11 | 评论 + 关注者通知                            | watcher 收 `comment.added`     |
| ISS-12 | 审计来源记录                                 | WEB/API/MCP 来源落 Activity    |

## 5. M4/M5 回归（WEBHOOK / APPROVAL / MONITOR / AVATAR）— `auto(已有) m4/m5/regression.test.ts`

| ID     | 用例                            | 预期                                   |
| ------ | ------------------------------- | -------------------------------------- |
| WH-01  | webhook 注册+事件投递+重试退避  | 投递记录与签名头存在                   |
| APR-01 | agentPolicy=approval 时动作挂起 | 审批通过后才生效；拒绝则不动           |
| MON-01 | 替身巡检规则触发报告            | 生成 report 并落通知                   |
| REG-01 | 回归用例注册与断言              | 状态/断言结果正确                      |
| AVT-01 | 替身心跳/评分/扣分因子          | 分数变化可追溯                         |
| MCP-01 | MCP stdio 13 工具冒烟           | `pnpm smoke:mcp` 全绿（M6 后 25 工具） |

## 6. M6-P0 新功能

### 6.1 附件（ATT）— `auto m6-attachments.test.ts`

| ID     | 用例           | 前置                                | 步骤                                                     | 预期                                                         |
| ------ | -------------- | ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| ATT-01 | 上传附件       | MEMBER 登录+项目                    | multipart POST /v1/issues/:key/attachments（小文本文件） | 201；记录含 name/size/mime；磁盘 `ATTACHMENTS_DIR/<id>` 存在 |
| ATT-02 | 列表并入详情   | ATT-01 后                           | GET /v1/issues/:key                                      | `attachments[]` 含上传人                                     |
| ATT-03 | 下载           | ATT-01 后                           | GET download                                             | 200；`content-disposition` 带 UTF-8 文件名；内容一致         |
| ATT-04 | 超 20MB 拒绝   | —                                   | 上传 >20MB 流                                            | 400/413，不落盘                                              |
| ATT-05 | 未登录拒绝     | —                                   | 无 cookie 上传                                           | 401                                                          |
| ATT-06 | 非成员拒绝     | 其他项目用户                        | 上传                                                     | 403/404                                                      |
| ATT-07 | 删除权限       | 上传者 MEMBER / 另一 MEMBER / ADMIN | 依次 DELETE                                              | 上传者 200；另一 MEMBER 403；ADMIN 200；磁盘文件删除         |
| ATT-08 | 删除后下载 404 | ATT-07 后                           | GET download                                             | 404                                                          |

### 6.2 CSV 导出/导入（CSV）— `auto m6-csv.test.ts`

| ID     | 用例             | 步骤                              | 预期                                                                                                                       |
| ------ | ---------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| CSV-01 | 导出全列         | 建多类型 issue 后 GET /issues.csv | 200；表头含 key/type/title/description/state/priority/assignee/labels/parent/sprint/storyPoints/dueDate/release；UTF-8 BOM |
| CSV-02 | RFC4180 转义     | 标题含逗号/引号/换行              | 导出可被 parseCsv 还原；导入后再导出内容一致                                                                               |
| CSV-03 | 过滤参数生效     | /issues.csv?priority=P1           | 仅 P1 行                                                                                                                   |
| CSV-04 | 导入新建         | POST /issues/import（合法 3 行）  | `created:3, failed:[]`；issue 落库                                                                                         |
| CSV-05 | 坏行不回滚       | 第 2 行缺标题                     | `failed:[{row:2}]`；第 1/3 行成功                                                                                          |
| CSV-06 | 导入类型校验     | priority=BAD                      | 该行报 VALIDATION                                                                                                          |
| CSV-07 | VIEWER 导入拒绝  | VIEWER cookie                     | 403                                                                                                                        |
| CSV-08 | 导出→导入幂等    | 同项目重导入导出件                | 全部行新建成功（新 key），字段等值                                                                                         |
| CSV-09 | 动态自定义字段列 | 定义字段+填值+导出                | 出现 `field:名称` 列且值正确                                                                                               |

### 6.3 批量操作（BULK）— `auto m6-bulk.test.ts`

| ID      | 用例                 | 步骤                          | 预期                                       |
| ------- | -------------------- | ----------------------------- | ------------------------------------------ |
| BULK-01 | 批量指派             | 3 issue → assign user2        | 全部 ok；assignee 正确；逐条审计           |
| BULK-02 | 批量优先级           | 3 issue → P0                  | 全部 ok                                    |
| BULK-03 | 批量流转             | 3 issue → 进行中              | 全部 ok；审计 `issue.transitioned`         |
| BULK-04 | 逐项独立失败         | 混入 1 个非法 key             | 该项 `ok:false` 带错误；其余成功；HTTP 200 |
| BULK-05 | 非法 action/参数组合 | action=assign 无 assigneeName | 400 VALIDATION                             |
| BULK-06 | 数量上限             | issueKeys 101 个              | 400                                        |
| BULK-07 | VIEWER 拒绝          | VIEWER cookie                 | 403                                        |
| BULK-08 | 批量 sprint          | action=sprint 指定 sprintId   | ok 且 issue 在 sprint 内                   |

### 6.4 我的工作（MYW）— `auto m6-mywork.test.ts`

| ID     | 用例           | 步骤                              | 预期                                             |
| ------ | -------------- | --------------------------------- | ------------------------------------------------ |
| MYW-01 | 指派分组       | user2 被 assign 2 个 issue        | `assigned` 含 2 条且带 projectKey                |
| MYW-02 | 关注分组       | user2 watch 他人 issue            | `watching` 含该 issue                            |
| MYW-03 | 报告分组       | user2 创建 issue（reporter=自己） | `reported` 含该 issue                            |
| MYW-04 | 未完成优先排序 | assigned 混合 DONE/TODO           | 非完成在前，其余 updatedAt desc                  |
| MYW-05 | 跨项目聚合     | 两个项目各有 issue                | 均出现且项目字段正确                             |
| MYW-06 | 只见自己的     | user1 与 user2 数据隔离           | user1 响应不含 user2 专属 issue（除非关注/报告） |
| MYW-07 | 未登录拒绝     | 无 cookie                         | 401                                              |

### 6.5 评论 @提及（MEN）— `auto m6-mentions-mail.test.ts`

| ID     | 用例             | 步骤                                 | 预期                                                         |
| ------ | ---------------- | ------------------------------------ | ------------------------------------------------------------ |
| MEN-01 | 提及项目成员     | 评论含 `@user2`                      | user2 收 `comment.mentioned`；payload 带 issueKey/projectKey |
| MEN-02 | 提及非成员不通知 | 评论含 `@ghost`（非项目成员/不存在） | 无通知产生                                                   |
| MEN-03 | 多人提及         | `@user2 @bot-*`                      | 各收一条（项目成员范围内）                                   |
| MEN-04 | 无提及不误报     | 普通评论                             | 只有 comment.added 逻辑，无 mentioned                        |
| MEN-05 | 提及样式边界     | 邮箱 `a@b.c`、`@@`、代码块内         | 不误匹配                                                     |

### 6.6 邮件通知（MAIL）— `auto m6-mentions-mail.test.ts`（假 sender）

| ID      | 用例             | 步骤                                       | 预期                                                                      |
| ------- | ---------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| MAIL-01 | 通知外发邮件     | 注入假 sender；user2 有 email；触发 assign | sender 收到 1 封；收件人=user2 email；标题含类型中文；正文含 APP_URL 链接 |
| MAIL-02 | AGENT 不发邮件   | 收件人为 agent                             | sender 未收到                                                             |
| MAIL-03 | 无 email 不发    | 收件人 email 空                            | 不发送且不报错                                                            |
| MAIL-04 | SMTP 未配置不发  | 默认环境（SMTP_HOST 空）                   | 不发送                                                                    |
| MAIL-05 | 发送失败静默     | 假 sender 抛错                             | notify 不 reject；通知仍落库                                              |
| MAIL-06 | admin stats 回报 | GET /v1/admin/stats                        | `mailConfigured` 反映 SMTP_HOST 有无                                      |

## 7. M6-P1 新功能

### 7.1 自定义字段（FLD）— `auto m6-fields.test.ts`

| ID     | 用例             | 步骤                         | 预期                                  |
| ------ | ---------------- | ---------------------------- | ------------------------------------- |
| FLD-01 | 创建四类字段     | text/number/date/select 各一 | 201；列表可见                         |
| FLD-02 | 同名拒绝         | 同项目重名                   | 409/400                               |
| FLD-03 | select 必带选项  | type=select 无 options       | 400                                   |
| FLD-04 | 值类型校验       | number 字段填 "abc"          | 400 VALIDATION                        |
| FLD-05 | date 校验        | 填 "not-a-date"              | 400                                   |
| FLD-06 | select 限选项    | 填不在 options 的值          | 400                                   |
| FLD-07 | upsert 写值      | set 两次同字段               | 单条值记录（unique issueId+fieldId）  |
| FLD-08 | 清空值           | 传 null                      | 记录清空                              |
| FLD-09 | 详情带出         | GET issue                    | `fields[]` 含 name/type/value/options |
| FLD-10 | MEMBER 不可管理  | MEMBER 建/删字段             | 403（读写值仍可）                     |
| FLD-11 | 删除字段级联清值 | 删字段后查 issue             | fields 不再出现该字段                 |
| FLD-12 | 改名/改选项      | PATCH                        | 生效且已存值保留                      |

### 7.2 版本（REL）— `auto m6-releases.test.ts`

| ID     | 用例              | 步骤                      | 预期                               |
| ------ | ----------------- | ------------------------- | ---------------------------------- |
| REL-01 | 创建/列表         | 建 2 版本                 | 列表含 totalIssues/doneIssues 统计 |
| REL-02 | 同项目同名拒绝    | 重名                      | 400                                |
| REL-03 | 状态流转          | planned→released→archived | PATCH 生效                         |
| REL-04 | issue 归版本      | updateIssue releaseId     | detail.release 正确                |
| REL-05 | 跨项目版本拒绝    | 其他项目 releaseId        | 400                                |
| REL-06 | 过滤 releaseId    | search?releaseId=         | 命中该版本；`none` 命中未归版      |
| REL-07 | CSV 含 release 列 | 导出                      | release 名称出现在对应行           |
| REL-08 | 删除版本 SetNull  | 删 release 后查 issue     | releaseId 为 null，issue 不受影响  |
| REL-09 | 完成度统计        | 版本下 2 issue 完成 1     | doneIssues=1                       |

### 7.3 工作流编辑器（WFE）— `auto m6-workflow-editor.test.ts`

| ID     | 用例             | 步骤                                       | 预期                                              |
| ------ | ---------------- | ------------------------------------------ | ------------------------------------------------- |
| WFE-01 | GET 默认工作流   | TASK                                       | states（中文初始态）+transitions 完整             |
| WFE-02 | PUT 全量替换     | 新增状态「评审中」+迁移 待办→评审中→进行中 | 保存后 GET 反映新结构                             |
| WFE-03 | 新流程可用       | 按新迁移流转 issue                         | 合法流转成功                                      |
| WFE-04 | 初始态必须恰一个 | 0 个或 2 个 isInitial                      | 400                                               |
| WFE-05 | 状态名唯一       | 重复名                                     | 400                                               |
| WFE-06 | 被占用状态不可删 | 有 issue 处于「评审中」时删除              | 400 STATE_IN_USE，错误信息含状态名与占用数        |
| WFE-07 | 未占用状态可删   | 删掉刚加的空状态                           | 成功                                              |
| WFE-08 | 类型互相独立     | 改 TASK 不影响 BUG                         | BUG 工作流不变                                    |
| WFE-09 | MEMBER 拒绝      | MEMBER PUT                                 | 403                                               |
| WFE-10 | 看板列即时反映   | 保存后 GET project                         | workflows 含新状态（前端列即时变化，manual 复核） |

### 7.4 保存的过滤器（FLT）— `auto m6-filters.test.ts`

| ID     | 用例            | 步骤                                  | 预期                  |
| ------ | --------------- | ------------------------------------- | --------------------- |
| FLT-01 | 创建            | user2 保存 {priority:P1,shared:false} | 201；owner 正确       |
| FLT-02 | 私有仅本人可见  | admin GET filters                     | 不含 user2 私有过滤器 |
| FLT-03 | shared 全员可见 | user2 建 shared 过滤器                | admin 可见            |
| FLT-04 | 同名拒绝        | user2 重名再建                        | 400                   |
| FLT-05 | query 往返      | 保存 {q:'xx',assignee:'user2'} 后 GET | query 等值            |
| FLT-06 | 删除权限        | 他人 MEMBER 删 / ADMIN 删 / 本人删    | 403 / 200 / 200       |
| FLT-07 | 应用过滤器      | 按 FLT-05 query 调 issues 搜索        | 结果与预期一致        |

### 7.5 敏捷报表（AGI）— `auto m6-agile-reports.test.ts`

| ID     | 用例             | 步骤                               | 预期                                                 |
| ------ | ---------------- | ---------------------------------- | ---------------------------------------------------- |
| AGI-01 | 周期时间         | issue 待办→进行中→完成（间隔可控） | cycleTimes 含该 issue，cycleDays=完成日-进入进行中日 |
| AGI-02 | 只有完成的进周期 | 完成 2 个、留 1 个未完成           | cycleTimes 含已完成的、不含未完成的                  |
| AGI-03 | CFD 逐日计数     | 建 3 issue、完成 1                 | cfd 末日 todo/inProgress/done 计数正确               |
| AGI-04 | CFD 带守恒       | 任一日三态之和=当时 issue 总数     | 相等                                                 |
| AGI-05 | Epic 递归        | epic→story→task 完成               | epic 统计含孙辈 done                                 |
| AGI-06 | 多 Epic 分组     | 2 个 epic 各带子                   | 各自独立统计                                         |
| AGI-07 | MCP report.agile | MCP 工具调用                       | 返回同结构数据                                       |
| AGI-08 | 空项目不炸       | 无 issue 项目调报表                | 200 空数组                                           |

### 7.6 工时（WKL）— `auto m6-worklogs.test.ts`

| ID     | 用例         | 步骤                        | 预期                      |
| ------ | ------------ | --------------------------- | ------------------------- |
| WKL-01 | 登记工时     | POST worklogs {minutes:90}  | 201；审计 `worklog.added` |
| WKL-02 | spentAt 缺省 | 不传 spentAt                | 落当天                    |
| WKL-03 | 列表与合计   | 登记两条 90+30              | worklogTotal=120          |
| WKL-04 | minutes 边界 | 0 或 100001                 | 400                       |
| WKL-05 | 预估工时     | updateIssue estimateMinutes | detail 带出               |
| WKL-06 | VIEWER 拒绝  | VIEWER 登记                 | 403                       |
| WKL-07 | 登记人展示   | GET detail                  | worklogs[].actor=登记人   |

### 7.7 管理统计（ADM）— `auto m6-admin-stats.test.ts`

| ID     | 用例           | 步骤                      | 预期                                                              |
| ------ | -------------- | ------------------------- | ----------------------------------------------------------------- |
| ADM-01 | 管理员可查     | admin GET /v1/admin/stats | 200；users/projects/issues/tokens/attachments/activity7d 字段齐全 |
| ADM-02 | 计数正确       | world 里建 1 项目 2 issue | projects/issues 计数含它们                                        |
| ADM-03 | 附件统计       | 上传 2 个附件             | count=+2、totalBytes 增加                                         |
| ADM-04 | 非管理员拒绝   | user2 GET                 | 403                                                               |
| ADM-05 | mailConfigured | 默认无 SMTP               | false                                                             |

## 8. 权限反例矩阵（贯穿各模块断言）

| 角色       | 读项目 | 建/改 issue | 上传附件 | 导入 CSV | 批量 | 管字段/版本/工作流 | admin stats |
| ---------- | ------ | ----------- | -------- | -------- | ---- | ------------------ | ----------- |
| 未登录     | 401    | 401         | 401      | 401      | 401  | 401                | 401         |
| VIEWER     | 200    | 403         | 403      | 403      | 403  | 403                | 403         |
| MEMBER     | 200    | 200         | 200      | 200      | 200  | 403                | 403         |
| ADMIN      | 200    | 200         | 200      | 200      | 200  | 200                | 403*        |
| 实例管理员 | 200    | 200         | 200      | 200      | 200  | 200                | 200         |

\* 项目 ADMIN≠实例管理员：`/v1/admin/stats` 仅实例管理员（isAdmin）可访问。

## 9. 浏览器人工用例（manual，测试报告阶段执行）

| ID     | 用例                 | 步骤                               | 预期                                              |
| ------ | -------------------- | ---------------------------------- | ------------------------------------------------- |
| GUI-01 | 登录→首页工作台卡    | 打开 /                             | 三张卡数字与 /my 一致                             |
| GUI-02 | /my 三列表跳转       | 点击任一 issue                     | 跳到对应项目且抽屉自动打开该 issue                |
| GUI-03 | 附件上传下载往返     | 抽屉传文件→下载                    | 内容一致；删除后消失                              |
| GUI-04 | Markdown 渲染        | 描述写 `**粗体** \`code\``         | 抽屉渲染为富文本                                  |
| GUI-05 | @提及通知            | A 评论 @B                          | B 铃铛出现「有人在评论里 @ 了你」，点击跳 issue   |
| GUI-06 | CSV 文件导入         | 选 .csv 文件上传                   | 提示「导入完成：新建 N 个」                       |
| GUI-07 | 批量操作条           | Backlog 勾选 3 条改优先级          | 浮条提示「成功 3」                                |
| GUI-08 | 设置页字段全流程     | 建字段→抽屉填值→列表显示           | 行内编辑保存生效                                  |
| GUI-09 | 设置页版本全流程     | 建版本→issue 归版本→版本完成度变化 | 进度条更新                                        |
| GUI-10 | 工作流编辑器保存闭环 | TASK 加状态+迁移→保存→看板         | 看板出现新列；issue 可流转到新状态                |
| GUI-11 | 敏捷报表渲染         | Overview 滚动到底                  | 周期散点/P50/P85、CFD 堆叠、Epic 进度、速率柱渲染 |
| GUI-12 | 保存过滤器 chips     | 看板设置过滤→保存→点击 chip        | 条件应用、列表刷新                                |
| GUI-13 | 团队页实例概览       | 管理员开 /team                     | 概览卡数字正确；非管理员不可见                    |
| GUI-14 | 工时登记             | 抽屉登记 60 分钟                   | 合计与列表即时更新                                |
| GUI-15 | 通知铃铛全类型       | 触发各类通知                       | 中文标签+图标正确                                 |
| GUI-16 | 评论 @成员联想       | 评论框输入 @ 或 @ 后继续输入       | 弹出成员建议（匹配账号/姓名）；↑↓ 选择、Enter/Tab 补全、Esc 关闭；补全为 @完整账号+空格且光标落其后 |
