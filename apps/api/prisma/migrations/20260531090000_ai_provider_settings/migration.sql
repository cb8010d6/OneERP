CREATE TABLE "AiProviderSetting" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'openai-compatible',
  "baseUrl" TEXT NOT NULL DEFAULT 'https://token-plan-sgp.xiaomimimo.com/v1',
  "apiKeyEncrypted" TEXT,
  "apiKeyPreview" TEXT,
  "defaultModel" TEXT NOT NULL DEFAULT 'mimo-v2.5',
  "proModel" TEXT NOT NULL DEFAULT 'mimo-v2.5-pro',
  "useProForSql" BOOLEAN NOT NULL DEFAULT true,
  "useProForDocuments" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiProviderSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiProviderSetting_companyId_key" ON "AiProviderSetting"("companyId");
CREATE INDEX "AiProviderSetting_companyId_idx" ON "AiProviderSetting"("companyId");

ALTER TABLE "AiProviderSetting"
  ADD CONSTRAINT "AiProviderSetting_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
