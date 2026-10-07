-- Consulting engagement, sprint 12: readiness and management review.
--
-- Additive: the records period an engagement sets (empty means three
-- months), the firm's readiness opinion and the sponsor's sign-off, each
-- with the computed figures as they stood, and management reviews (ISO 27001
-- 9.3) with the actions they decide.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "recordsPeriodMonths" INTEGER;

-- CreateTable
CREATE TABLE "ReadinessOpinion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "opinion" TEXT NOT NULL,
    "conditions" TEXT,
    "figures" TEXT NOT NULL,
    "givenById" TEXT NOT NULL,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadinessOpinion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessSignOff" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "opinionId" TEXT,
    "note" TEXT NOT NULL,
    "figures" TEXT NOT NULL,
    "signedById" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadinessSignOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "ref" TEXT NOT NULL,
    "heldOn" TIMESTAMP(3),
    "attendees" TEXT NOT NULL DEFAULT '[]',
    "inputs" TEXT NOT NULL DEFAULT '{}',
    "decisions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "preparedById" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3),

    CONSTRAINT "ManagementReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewAction" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "issueId" TEXT,
    "taskId" TEXT,
    "linkLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementReviewAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadinessOpinion_projectId_givenAt_idx" ON "ReadinessOpinion"("projectId", "givenAt");

-- CreateIndex
CREATE INDEX "ReadinessSignOff_projectId_signedAt_idx" ON "ReadinessSignOff"("projectId", "signedAt");

-- CreateIndex
CREATE INDEX "ManagementReview_tenantId_status_idx" ON "ManagementReview"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ManagementReview_projectId_idx" ON "ManagementReview"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReview_tenantId_ref_key" ON "ManagementReview"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "ManagementReviewAction_reviewId_idx" ON "ManagementReviewAction"("reviewId");

-- AddForeignKey
ALTER TABLE "ReadinessOpinion" ADD CONSTRAINT "ReadinessOpinion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessOpinion" ADD CONSTRAINT "ReadinessOpinion_givenById_fkey" FOREIGN KEY ("givenById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessSignOff" ADD CONSTRAINT "ReadinessSignOff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessSignOff" ADD CONSTRAINT "ReadinessSignOff_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReview" ADD CONSTRAINT "ManagementReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReview" ADD CONSTRAINT "ManagementReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReview" ADD CONSTRAINT "ManagementReview_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReview" ADD CONSTRAINT "ManagementReview_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAction" ADD CONSTRAINT "ManagementReviewAction_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ManagementReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

