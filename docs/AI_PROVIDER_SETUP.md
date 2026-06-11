# AI Provider 配置 / AI Provider Setup

本文档说明 OneERP 自身的 AI 能力如何接入 OpenAI-compatible Provider。维护者可以在本机使用 OpenCode 等工具协作开发，但这些工具配置不属于 OneERP 产品仓库，不能提交到本项目。

This document explains how OneERP connects its product AI features to an OpenAI-compatible provider. Maintainer-side tools such as OpenCode may use the same provider locally, but their configuration is not part of this repository.

## 默认 Provider / Default Provider

OneERP 后端默认使用 OpenAI-compatible 协议。当前默认值与 MiMo-compatible 网关保持一致：

OneERP uses an OpenAI-compatible backend provider. The current defaults match the MiMo-compatible gateway:

| Setting | Default |
| --- | --- |
| `AI_PROVIDER` | `openai-compatible` |
| `AI_BASE_URL` | `https://token-plan-sgp.xiaomimimo.com/v1` |
| `AI_MODEL` | `mimo-v2.5` |
| `AI_PRO_MODEL` | `mimo-v2.5-pro` |
| `AI_REQUEST_TIMEOUT_MS` | `30000` |
| `AI_WRITE_ENABLED` | `false` |

生产环境必须通过安全的运行时配置注入真实 API Key，不要把密钥写入 README、截图、提交记录、CI 日志或 `.env.example`。

Production deployments must inject the real API key through secure runtime configuration. Never place secrets in README files, screenshots, commits, CI logs, or `.env.example`.

## 环境变量 / Environment Variables

后端读取以下变量：

The backend reads these variables:

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | Provider type. Use `openai-compatible` unless a new adapter is added. |
| `AI_BASE_URL` | Chat completion API base URL. |
| `AI_API_KEY` | Runtime API key. Leave blank in examples and committed files. |
| `AI_MODEL` | Standard model used for low-risk assistance and automation. |
| `AI_PRO_MODEL` | Higher-capability model used for complex analysis flows. |
| `AI_REQUEST_TIMEOUT_MS` | Request timeout in milliseconds. |
| `AI_SETTINGS_ENCRYPTION_KEY` | Required before saving company-level keys from the settings UI. |
| `AI_WRITE_ENABLED` | Enables AI write operations only after staff permission and audit controls are accepted. |
| `OPENAI_API_KEY` | Backward-compatible fallback if `AI_API_KEY` is empty. |
| `OPENAI_BASE_URL` | Backward-compatible fallback if `AI_BASE_URL` is empty. |
| `OPENAI_MODEL` | Backward-compatible fallback if `AI_MODEL` is empty. |

Recommended local `.env` shape:

```dotenv
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://token-plan-sgp.xiaomimimo.com/v1
AI_API_KEY=
AI_MODEL=mimo-v2.5
AI_PRO_MODEL=mimo-v2.5-pro
AI_REQUEST_TIMEOUT_MS=30000
AI_SETTINGS_ENCRYPTION_KEY=CHANGE_ME_LOCAL_ONLY
AI_WRITE_ENABLED=false
```

在本机开发时，把真实 key 只写入未提交的 `.env`、系统密钥管理器或运行平台 Secret。提交前必须确认密钥扫描无命中。

For local development, store the real key only in an uncommitted `.env`, a system secret manager, or the deployment platform's secret store. Run the secret scan before every commit.

## 设置页 / Settings UI

Web 设置页提供公司级 AI Provider 配置入口：

The web settings page provides company-level AI Provider configuration:

- 用户可以修改 Base URL、模型、Pro 模型、超时和 API Key。
- API Key 在后端使用 `AI_SETTINGS_ENCRYPTION_KEY` 加密保存。
- API 只返回 key 来源和预览信息，不返回明文。
- “测试连接”会调用后端 `/v1/ai/settings/test`，再由后端请求 Provider 的 `/chat/completions`。

Company-level settings allow operators to update the base URL, models, timeout, and API key. Keys are encrypted server-side, returned only as source or preview metadata, and tested through the backend.

## 降级策略 / Fallback Behavior

如果没有配置 API Key，AI 功能必须降级为确定性或规则型路径，不能因为外部 Provider 不可用而阻断核心 ERP 流程。

If no API key is configured, AI features must fall back to deterministic or rule-based behavior. Core ERP workflows must not depend on external provider availability.

## 写操作门禁 / Write Guardrails

`AI_WRITE_ENABLED` 默认保持 `false`。涉及创建、修改、审批、过账、出库、付款等写操作时，必须同时满足：

Keep `AI_WRITE_ENABLED` set to `false` by default. AI-assisted write actions such as creation, approval, posting, shipment, and payment require:

- 明确的用户确认。
- 员工权限校验通过。
- 可审计的操作记录。
- 可回滚或可人工复核的业务流程。

这些门禁没有全部到位前，AI 只应做解释、建议、摘要、草稿和异常提示。

Until these guardrails are all in place, AI should be limited to explanations, recommendations, summaries, drafts, and anomaly hints.
