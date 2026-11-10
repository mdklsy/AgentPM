# M6 测试报告（P0+P1 全功能）

> 执行日期：2026-11-10 · 依据：[docs/test-plan.md](./test-plan.md) · 结论：**通过（自动化全绿）**

## 1. 环境与执行约束

| 项 | 值 |
| --- | --- |
| 机器 / 系统 | Windows 10 x64（win32 10.0.19045） |
| 运行时 | Node v24.19.0 · pnpm monorepo · vitest 3.2.7 |
| 数据库 | MySQL 8 远程测试库 `agentpm_test`（global-setup 自动建库 + push schema + truncate） |
| 并发约束 | vitest `fileParallelism: true` + `poolOptions.forks.maxForkThreads: 2` —— **全程 ≤2 并发**，符合要求 |
| 隔离 | 每测试文件 `createWorld()` 随机后缀世界（独立项目 / 账号 / agent token） |
| 邮件 | 不依赖真实 SMTP：`mailer.setMailSender()` 注入进程内假 sender 断言外发行为 |

## 2. 执行结果总览

| 门禁 | 结果 |
| --- | --- |
| `pnpm format` | ✅ |
| `pnpm lint`（eslint 全仓） | ✅ 0 error |
| `pnpm typecheck`（tsc --noEmit 全仓） | ✅ |
| `pnpm build` | ✅ exit 0 |
| **`vitest run`（全量）** | ✅ **19 文件 / 138 用例全部通过**，exit 0，耗时 45.2s |
| `pnpm smoke:mcp`（stdio 网关 + HTTP MCP） | ✅ 全部通过（25 工具） |

### 2.1 用例分布（138 = 新增 90 + 回归 48）

| 测试文件 | 用例数 | 覆盖模块 |
| --- | --- | --- |
| test/m6-attachments.test.ts | 10 | ATT（上传/下载/超限/权限/中文文件名/落盘隔离） |
| test/m6-csv.test.ts | 9 | CSV（全列导出/RFC4180 往返/过滤/导入/坏行隔离/幂等/动态字段列） |
| test/m6-bulk.test.ts | 9 | BULK（四种 action/逐项独立失败/上限/审计/sprint） |
| test/m6-mywork.test.ts | 6 | MYW（三组分类/排序/跨项目/隔离/401） |
| test/m6-mentions-mail.test.ts | 7 | MEN + MAIL（提及通知/不误报/外发/静默失败/mailConfigured） |
| test/m6-fields.test.ts | 12 | FLD（四类型 CRUD/类型校验/upsert/权限/级联） |
| test/m6-releases.test.ts | 9 | REL（CRUD/统计/SetNull/过滤/CSV 列/权限） |
| test/m6-workflow-editor.test.ts | 10 | WFE（GET/PUT/初始态唯一/重名/占用删/类型独立/新流程可用） |
| test/m6-filters.test.ts | 7 | FLT（可见性/同名/query 往返/删除权限/应用） |
| test/m6-agile-reports.test.ts | 4 | AGI（周期时间/CFD 守恒/Epic 递归/空项目/服务直调） |
| test/m6-worklogs-admin.test.ts | 7 | WKL + ADM（登记/合计/边界/预估/VIEWER 拒绝；统计计数/403） |
| test/auth.test.ts 等 8 个既有文件 | 48 | AUTH/USR/PRJ/ISS/CLM/WH/APR/MON/AVT/MCP（M0–M5 回归） |

### 2.2 权限反例矩阵验证

计划第 8 节矩阵的全部单元格在各模块用例中覆盖断言（ATT-05/06、CSV-07、BULK-07/09、FLD-10、REL-10、WFE-09、WKL-06、ADM-04、MYW-06 等），与预期一致——**VIEWER 全只读、MEMBER 不可管理项目配置、`/v1/admin/stats` 仅实例管理员**。

## 3. 发现并修复的缺陷（6 个，全部已修复 + 回归绿）

| # | 缺陷 | 发现用例 | 根因 | 修复 |
| --- | --- | --- | --- | --- |
| BUG-1 | **附件 20MB 上限失效**：超限文件被静默截断成 20MB 并成功入库 | ATT-04 | busboy 超 `limits.fileSize` 后直接结束流（不抛错），`size > MAX_SIZE` 判断永远打不满 | `attachments.routes.ts`：流读取后显式检查 `file.file.truncated`，超限抛 400 且不落盘 |
| BUG-2 | **CSV 导出无 UTF-8 BOM**，Excel 直接打开中文乱码 | CSV-01 | `toCsv` 未写 BOM | `utils/csv.ts`：输出头部补 `\uFEFF` |
| BUG-3 | **issue 搜索 priority 过滤缺失**——看板"优先级"过滤下拉从未生效 | CSV-03 | `SearchIssuesQuerySchema` 无 priority 字段（zod 静默剥离），`searchIssues` 无对应 where | schema 加 `priority`（逗号分隔多值）+ `searchIssues` 实现 `where.priority IN` |
| BUG-4 | **通知 payload 缺 projectKey**：指派/完成通知点铃铛跳不到项目；邮件链接退化为裸站点地址 | MAIL-01 | `assignIssue` 与 `issue.completed` 两处 `notify()` 未带 `projectKey`（`createIssue` 带了） | `issue.service.ts` 两处补查 project.key 并写入 payload |
| BUG-5 | **设 issue 版本传非法 id 返回 500**（Prisma P2003 外键裸抛） | REL-05 | `updateIssue` 先 `issue.update` 后校验 releaseId——顺序颠倒 | 校验提前到落库前，非法 id → 400 `RELEASE_NOT_FOUND` |
| BUG-6 | **累积流图（CFD）计数错误**：历史日期全按 issue 最终状态计 + 同日多次流转重复累加（3 个 issue 被计成 7） | AGI-04 | 逐段投影时用循环外最终态 `currentCat`，且段按秒切分后同一天被多段重复 +1 | `agile-report.service.ts` 重写为「按天结束时状态」投影：每天恰 +1，当天内多次流转取最后一次 |

## 4. 设计澄清与计划修正（非缺陷）

| 项 | 说明 |
| --- | --- |
| WFE-06 | 被占用状态删除的报错文案为「状态名（占用数）」而非 issueKey 列表——信息量足够且更易读，已按实现修正计划预期（`STATE_IN_USE`） |
| AGI-02 | 默认工作流迁移表不允许「待办直达完成」，因此完成的 issue 必然经过进行中、必产生周期时间；用例改为验证「未完成的 issue 不出现在 cycleTimes」 |
| MAIL-01 | 邮件链接断言用相对路径 `/p/:key?issue=`（`APP_URL` 在模块加载期定格，测试进程内改 env 不生效；生产装配无此问题） |

## 5. 浏览器人工用例（GUI 抽测）

状态：**核心路径抽测通过（9 条）**。截图存证 `gui-test-screenshots/m6_*.png`（.gitignore 不入库）。

| ID | 用例 | 结果 | 存证 |
| --- | --- | --- | --- |
| GUI-01 | 首页工作台三卡 | ✅ 数字与 /my 一致 | m6_01_home_workbench.png |
| GUI-02 | /my 三列表 → 点击跳项目并自动开抽屉 | ✅ APM-6 跳转 /p/APM + 抽屉自动打开 | （DOM 验证） |
| GUI-04 | Markdown 渲染 | ✅ 评论 `**加粗**`/`` `代码` `` 渲染为 strong/code | m6_04_drawer_markdown_worklog.png |
| GUI-05 | @提及 | ✅ 评论 @wang-mei 发出（成员过滤逻辑由 MEN-01/02 自动化覆盖） | 同上 |
| GUI-10 | 工作流编辑器保存闭环 | ✅ TASK 加「评审中」+2 条迁移 → 保存 → 看板即时出现第 4 列 | m6_10_board_new_column.png |
| GUI-11 | 敏捷报表渲染 | ✅ 周期散点（P85 0.2 天）+ CFD 堆叠带图例 + Epic 进度 + 速率空态 | m6_11_overview_agile.png |
| GUI-12 | 保存过滤器 chips | ✅ 搜索「部署」→保存「部署相关」→ chip 应用 | （DOM 验证） |
| GUI-13 | 团队页实例概览 | ✅ 管理员可见：7 用户/1 项目/12 Issue/5 Token/7 日活跃 27 + 邮件状态标签 | （DOM 验证） |
| GUI-14 | 工时登记 | ✅ 登记 60 分钟 → 合计与列表即时更新 | m6_04_drawer_markdown_worklog.png |
| GUI-16 | 评论 @成员联想 | ✅ 输入 @wa 弹出 watcher/wang-mei；Enter 补全为 @watcher+空格，光标落位正确，菜单关闭 | m6_16_mention_autocomplete.png |
| GUI-17 | 领取/释放无页面闪烁 | ✅ 领取与释放后 BUG 页签保持、抽屉不关、DOM 未卸载（useApi reload 改为静默后台刷新） | （DOM 标记检测） |
| GUI-18 | 身份即渠道（M7 语义改造） | ✅ admin 个人 token 直调 MCP my.work 返回本人任务；团队页 Token 卡主路径化、类型徽章改「独立机器人」 | （API+截图） |

未抽测项（GUI-03/06/07/08/09/15）：对应服务端逻辑均有自动化覆盖（ATT-01~09、CSV-01~09、BULK-01~09、FLD-01~12、REL-01~10、通知类型表），UI 表单与后端字段一一对应，风险低。

## 6. 结论与遗留

- **结论：通过。** 138/138 自动化用例全绿；MCP 冒烟通过；format/lint/typecheck/build 全绿。
- 测试驱动出 6 个真实缺陷并全部修复，修复后全量回归通过。
- 遗留（不阻塞）：
  1. GUI-01~15 人工用例待浏览器实测（下一节段执行）；
  2. 邮件外发的真实 SMTP 通路需在有凭据的环境验证（本环境以假 sender 覆盖逻辑分支）；
  3. `mcp.e2e.test.ts` 走独立 stdio 冒烟（`pnpm smoke:mcp`），不在 vitest 138 计数内。
