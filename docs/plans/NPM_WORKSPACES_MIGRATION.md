# npm Workspaces 迁移评估报告

> **评估日期**: 2026-05-07
> **评估人**: AI Agent
> **目标**: 评估将 OneERP 从独立 `npm --prefix` 安装迁移到 npm workspaces 的方案、风险和收益

---

## 1. 当前状态

### 1.1 项目结构

```
OneERP/
├── package.json          # 根包（无 workspaces 配置）
├── package-lock.json     # 根 lockfile
├── apps/
│   ├── api/package.json  # NestJS 后端（独立依赖）
│   ├── web/package.json  # Next.js 前端（独立依赖 + 独立 lockfile）
│   ├── desktop/          # Tauri（规划中）
│   └── mobile/           # Expo（规划中）
```

### 1.2 依赖管理方式

- 根 `package.json` 使用 `npm --prefix apps/api run ...` 调用子项目脚本
- 每个子项目独立运行 `npm install`，维护独立的 `node_modules`
- CI 中依次安装：`npm install`（根）→ `npm --prefix apps/api install` → `npm --prefix apps/web install`

### 1.3 当前问题

| 问题 | 影响 |
|------|------|
| 多 lockfile | Next.js 警告 root directory 推断不正确 |
| 重复依赖 | 根和子项目都安装了部分相同依赖 |
| CI 效率 | 每个子项目独立安装，无法共享缓存 |
| 路径不一致 | `npm --prefix` 命令在不同 shell 中行为可能不同 |

---

## 2. 迁移方案

### 2.1 根 package.json 添加 workspaces

```json
{
  "workspaces": [
    "apps/api",
    "apps/web"
  ]
}
```

### 2.2 变更清单

| 文件 | 变更 |
|------|------|
| `package.json` | 添加 `workspaces` 字段 |
| `package-lock.json` | 重新生成（合并子项目依赖） |
| `apps/web/package-lock.json` | 删除（不再需要） |
| `.gitignore` | 确认不忽略根 `node_modules` |
| CI workflow | 移除独立子项目 `npm install`，改用根级 `npm install --workspaces` |

### 2.3 根脚本调整

```json
{
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  }
}
```

---

## 3. 风险评估

### 3.1 高风险

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| 依赖版本冲突 | `apps/api` 和 `apps/web` 可能依赖同一包的不同版本 | npm workspaces 自动 hoist，冲突时报错提示 |
| Prisma 生成路径 | Prisma Client 生成到 `node_modules/.prisma` | 需验证 hoist 后 Prisma 仍能正确解析 |
| Next.js lockfile | Next.js 16 对 lockfile 位置敏感 | 删除 `apps/web/package-lock.json` 后 Next.js 应使用根 lockfile |

### 3.2 中风险

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| CI 缓存失效 | lockfile 路径变化导致 CI 缓存 miss | 更新 CI cache key |
| 开发者习惯 | 团队习惯 `cd apps/api && npm install` | 更新文档和 AGENTS.md |

### 3.3 低风险

| 风险 | 说明 |
|------|------|
| desktop/mobile | 当前为空目录，迁移后按需添加 |
| Husky hooks | 已在根配置，不受影响 |

---

## 4. 迁移步骤

1. **备份**: 创建迁移分支 `agent/tooling/workspaces-migration`
2. **合并 lockfile**: 删除 `apps/web/package-lock.json`，根目录运行 `npm install`
3. **验证**: 运行 `npm run validate`（全量门禁）
4. **CI 更新**: 修改 `.github/workflows/ci.yml` 中的安装步骤
5. **文档更新**: 更新 `AGENTS.md`、`DEVELOPMENT_WORKFLOW.md`、本地测试手册
6. **PR**: 合并到 develop

---

## 5. 建议

**建议执行迁移**，理由：
- 消除 Next.js lockfile root warning（阶段 E3 目标）
- 简化依赖管理，减少重复安装
- 为未来 desktop/mobile 子项目做好准备
- CI 效率提升（单次 `npm install` 替代多次）

**迁移窗口**: 建议在当前迭代所有功能分支合并后执行，避免 lockfile 冲突。

**总工期**: 约 1-2 小时（含验证）