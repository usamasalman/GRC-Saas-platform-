-- Consulting engagement, sprint 3: plan templates.
--
-- Phases and tasks were typed one by one. A template library at three levels
-- (Platform, Firm, Client) feeds a plan wizard; a template is copied into a
-- plan, never linked, and each version is immutable, so editing a template
-- makes its next version and changes no plan made from an earlier one.
-- Project.planTemplateId records which version a plan was copied from.
--
-- Additive only: three new tables and one nullable column.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "planTemplateId" TEXT;

-- CreateTable
CREATE TABLE "PlanTemplate" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "tenantId" TEXT,
    "familyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "engagementType" TEXT,
    "standardCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "retiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTemplatePhase" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationDays" INTEGER NOT NULL,

    CONSTRAINT "PlanTemplatePhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTemplateTask" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "side" TEXT NOT NULL DEFAULT 'Client',
    "durationDays" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "needsVerification" BOOLEAN,
    "dependsOnKey" TEXT,
    "clauses" TEXT,
    "generate" TEXT NOT NULL DEFAULT 'Once',
    "deliverable" TEXT,

    CONSTRAINT "PlanTemplateTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanTemplate_level_status_idx" ON "PlanTemplate"("level", "status");

-- CreateIndex
CREATE INDEX "PlanTemplate_tenantId_status_idx" ON "PlanTemplate"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTemplate_familyId_version_key" ON "PlanTemplate"("familyId", "version");

-- CreateIndex
CREATE INDEX "PlanTemplatePhase_templateId_sequence_idx" ON "PlanTemplatePhase"("templateId", "sequence");

-- CreateIndex
CREATE INDEX "PlanTemplateTask_phaseId_sequence_idx" ON "PlanTemplateTask"("phaseId", "sequence");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_planTemplateId_fkey" FOREIGN KEY ("planTemplateId") REFERENCES "PlanTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTemplate" ADD CONSTRAINT "PlanTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTemplate" ADD CONSTRAINT "PlanTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTemplatePhase" ADD CONSTRAINT "PlanTemplatePhase_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PlanTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTemplateTask" ADD CONSTRAINT "PlanTemplateTask_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "PlanTemplatePhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
