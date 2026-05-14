CREATE TABLE IF NOT EXISTS "UserInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "tokenHash" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "acceptedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserInvitation_tokenHash_key" ON "UserInvitation"("tokenHash");
CREATE INDEX IF NOT EXISTS "UserInvitation_companyId_email_idx" ON "UserInvitation"("companyId", "email");
CREATE INDEX IF NOT EXISTS "UserInvitation_companyId_createdAt_idx" ON "UserInvitation"("companyId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserInvitation_companyId_fkey') THEN
    ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserInvitation_roleId_fkey') THEN
    ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserInvitation_createdById_fkey') THEN
    ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserInvitation_acceptedById_fkey') THEN
    ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_acceptedById_fkey"
      FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
