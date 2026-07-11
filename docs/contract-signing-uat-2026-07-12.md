# 合同签署与生效 UAT

日期：2026-07-12（Asia/Shanghai）  
部署标签：`uat-98d9eb1`  
分支：`refactor/remaining-tasks`

## 范围

- 已批准合同上传签署件并归档到公司文件库。
- 签署件与合同建立唯一、禁止删除的数据库关联。
- 已签署合同按当前版本生效日期和到期日期进入 `ACTIVE`。
- 签署和生效均追加审批轨迹与审计日志。

## 真实验收

在远程 `oneerp_test` UAT 环境执行扩展后的 `scripts/quote-lifecycle-acceptance.mjs`：

```text
REQ-2026-000007
QT-2026-000006
CT-2026-000003
total=100000

PENDING_SALES_MANAGER
-> PENDING_FINANCE_REVIEW
-> PENDING_BUSINESS_REVIEW
-> APPROVED
-> SIGNED
-> ACTIVE

signedFileId=19d4c00a-d14c-4bc0-9d91-45989c947de8
passed=true
```

验收脚本通过文件 API 上传 PDF，文件中心完成扩展名、MIME 和 magic bytes 校验，随后调用合同签署与生效 API。未读取或输出 MinIO、数据库或管理员密码。

## 边界

- 本批不包含电子签名服务或数字证书验证，只归档已经完成签署的文件。
- 本批不包含合同转销售订单；后续必须用稳定 `sourceBatchKey` 支持一个合同生成多个订单，并保证重复请求幂等。
- 该结果是受控 UAT 证据，不替代生产备份恢复、HTTPS、权限分配和上线签字门禁。
