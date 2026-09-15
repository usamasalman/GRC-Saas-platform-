-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT,
ADD COLUMN     "suspendedRootId" TEXT;
