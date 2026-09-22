-- CreateTable
CREATE TABLE "DocumentVersionEditor" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersionEditor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentVersionEditor_userId_idx" ON "DocumentVersionEditor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersionEditor_versionId_userId_key" ON "DocumentVersionEditor"("versionId", "userId");

-- AddForeignKey
ALTER TABLE "DocumentVersionEditor" ADD CONSTRAINT "DocumentVersionEditor_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersionEditor" ADD CONSTRAINT "DocumentVersionEditor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

