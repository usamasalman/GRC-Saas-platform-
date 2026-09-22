-- Department is a record, not a string.
--
-- User.department has always been a plain String. Two places write it: the
-- invite handler and the transfer handler. That means "Finance" typed on an
-- invite and "finance" typed on a transfer are two different departments, and
-- moving someone from Finance to Internal Audit inside the same company is
-- impossible because there is no Finance record to move them from.
--
-- This migration adds the Department table and a nullable FK back to it on
-- User. The string column stays so existing data and existing code keep
-- working while the FK column is populated. departmentId is the authoritative
-- field going forward; department is kept for display and backward compat.

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: names must be unique within a tenant
CREATE UNIQUE INDEX "Department_tenantId_name_key" ON "Department"("tenantId", "name");

-- Index for listing a tenant's departments quickly
CREATE INDEX "Department_tenantId_idx" ON "Department"("tenantId");

-- AddForeignKey: each department belongs to a tenant
ALTER TABLE "Department" ADD CONSTRAINT "Department_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: the head is a user (nullable; SetNull when that user is deleted)
ALTER TABLE "Department" ADD CONSTRAINT "Department_headId_fkey"
  FOREIGN KEY ("headId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: add the FK column to User; nullable, coexists with the string column
ALTER TABLE "User" ADD COLUMN "departmentId" TEXT;

-- AddForeignKey: user belongs to a department record (nullable; SetNull on dept delete)
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index so "everyone in this department" is O(index)
CREATE INDEX "User_tenantId_departmentId_idx" ON "User"("tenantId", "departmentId");
