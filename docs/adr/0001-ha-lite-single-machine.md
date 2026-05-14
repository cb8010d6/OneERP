# ADR 0001: 采用单机 HA-lite 作为试生产部署形态

日期 / Date: 2026-05-14

## 状态 / Status

Accepted

## 背景 / Context

OneERP 近期目标是支持真实库存和财务试生产。当前团队更需要简单、可恢复、可审计的部署方式，而不是复杂的多节点自动故障切换。

## 决策 / Decision

试生产阶段采用单机 HA-lite：

- 使用 `docker-compose.ha-lite.yml` 作为生产试运行入口。
- 只暴露 Web 和 API。
- PostgreSQL、Redis、MinIO 仅在 Docker 网络内访问。
- 依靠健康检查、自动重启、资源限制、日志轮转提升单机可靠性。
- 不引入 Kubernetes、PostgreSQL 热备、Redis Sentinel 或多活架构。

## 后果 / Consequences

收益：

- 小白用户更容易部署和排障。
- 运维路径更短，适合当前试生产目标。
- 可以用备份恢复和演练先降低真实数据风险。

代价：

- 单机故障仍需要人工恢复。
- 不能提供自动故障切换。
- 未来如果并发、可用性或组织流程升级，需要重新评估更高可用架构。

## 复核条件 / Revisit When

- 单机资源无法支撑真实业务。
- RTO 1 小时无法满足业务要求。
- 用户明确需要自动故障切换或多办公区高可用。
