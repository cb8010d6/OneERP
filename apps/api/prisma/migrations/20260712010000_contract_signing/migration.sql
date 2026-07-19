ALTER TABLE "SalesContract"
ADD COLUMN "signedFileId" TEXT,
ADD COLUMN "signedById" TEXT,
ADD COLUMN "signedAt" TIMESTAMP(3),
ADD COLUMN "activatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "SalesContract_signedFileId_key" ON "SalesContract"("signedFileId");

ALTER TABLE "SalesContract" ADD CONSTRAINT "SalesContract_signedFileId_fkey" FOREIGN KEY ("signedFileId") REFERENCES "FileRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesContract" ADD CONSTRAINT "SalesContract_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
