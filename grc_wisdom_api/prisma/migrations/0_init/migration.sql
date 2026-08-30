-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parentId" TEXT,
    "path" TEXT NOT NULL DEFAULT '/',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "roleId" TEXT,
    "profile" TEXT,
    "context" TEXT,
    "branch" TEXT,
    "department" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "backupCodes" TEXT,
    "refreshTokenHash" TEXT,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "tempPasswordExpiresAt" TIMESTAMP(3),
    "encryptedNationalId" TEXT,
    "encryptedPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthly" DECIMAL(65,30) NOT NULL,
    "maxUsers" INTEGER NOT NULL,
    "features" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "status" TEXT NOT NULL,
    "zatcaXml" TEXT,
    "zatcaHash" TEXT,
    "zatcaQr" TEXT,
    "isCleared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "payload" TEXT NOT NULL,
    "previousHash" TEXT NOT NULL,
    "currentHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wormLocked" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedIp" TEXT,
    "requestedUa" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "resetCodeHash" TEXT,
    "resetCodeExpiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "PasswordResetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Standard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Standard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardClause" (
    "id" TEXT NOT NULL,
    "standardId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT,

    CONSTRAINT "StandardClause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Control" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlClauseLink" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "clauseId" TEXT NOT NULL,

    CONSTRAINT "ControlClauseLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantStandardEnablement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "standardId" TEXT NOT NULL,
    "applicability" TEXT NOT NULL DEFAULT 'Full',
    "ownerId" TEXT,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantStandardEnablement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlImplementation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "operatorId" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'Quarterly',
    "successCriteria" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NotStarted',
    "effectiveness" TEXT NOT NULL DEFAULT 'NotAssessed',
    "nextDueDate" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlImplementation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "implementationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'Internal',
    "uploadedById" TEXT NOT NULL,
    "relevance" TEXT NOT NULL DEFAULT 'NotAssessed',
    "sufficiency" TEXT NOT NULL DEFAULT 'NotAssessed',
    "authenticity" TEXT NOT NULL DEFAULT 'NotAssessed',
    "currency" TEXT NOT NULL DEFAULT 'NotAssessed',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Risk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'Threat',
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "treatmentType" TEXT NOT NULL DEFAULT 'Mitigate',
    "identifiedVia" TEXT NOT NULL DEFAULT 'Workshop',
    "identifiedSource" TEXT,
    "reviewCadenceMonths" INTEGER NOT NULL DEFAULT 6,
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewDate" TIMESTAMP(3),
    "horizonStart" TIMESTAMP(3),
    "horizonEnd" TIMESTAMP(3),
    "inherentLikelihood" INTEGER NOT NULL,
    "inherentImpact" INTEGER NOT NULL,
    "inherentScore" INTEGER NOT NULL,
    "residualLikelihood" INTEGER NOT NULL,
    "residualImpact" INTEGER NOT NULL,
    "residualScore" INTEGER NOT NULL,
    "acceptedById" TEXT,
    "acceptedUntil" TIMESTAMP(3),
    "acceptanceReason" TEXT,
    "acceptedUnderAppetiteId" TEXT,
    "acceptedAtScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEntityLink" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "auditableEntityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskLink" (
    "id" TEXT NOT NULL,
    "causeId" TEXT NOT NULL,
    "effectId" TEXT NOT NULL,
    "nature" TEXT NOT NULL DEFAULT 'Causes',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskControlLink" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "implementationId" TEXT NOT NULL,

    CONSTRAINT "RiskControlLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskTreatmentAction" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "RiskTreatmentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditableEntity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Process',
    "description" TEXT,
    "parentId" TEXT,
    "ownerId" TEXT,
    "financialMateriality" INTEGER NOT NULL DEFAULT 3,
    "regulatoryExposure" INTEGER NOT NULL DEFAULT 3,
    "complexity" INTEGER NOT NULL DEFAULT 3,
    "changeVolatility" INTEGER NOT NULL DEFAULT 3,
    "priorFindings" INTEGER NOT NULL DEFAULT 3,
    "fraudExposure" INTEGER NOT NULL DEFAULT 3,
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "riskTier" TEXT NOT NULL DEFAULT 'Medium',
    "lastAuditedAt" TIMESTAMP(3),
    "auditCycleMonths" INTEGER NOT NULL DEFAULT 24,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditableEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "totalBudgetHours" INTEGER NOT NULL DEFAULT 0,
    "preparedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "auditableEntityId" TEXT NOT NULL,
    "plannedQuarter" INTEGER NOT NULL DEFAULT 1,
    "budgetHours" INTEGER NOT NULL DEFAULT 80,
    "rationale" TEXT,
    "assignedLeadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "deferralReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "leadAuditorId" TEXT NOT NULL,
    "planItemId" TEXT,
    "unplannedReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "conclusion" TEXT,
    "conclusionNarrative" TEXT,
    "concludedById" TEXT,
    "concludedAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'InternalAudit',
    "sourceReference" TEXT,
    "auditId" TEXT,
    "riskId" TEXT,
    "implementationId" TEXT,
    "auditableEntityId" TEXT,
    "assetId" TEXT,
    "vendorId" TEXT,
    "title" TEXT NOT NULL,
    "criterion" TEXT,
    "condition" TEXT,
    "cause" TEXT,
    "recommendation" TEXT NOT NULL,
    "riskRating" TEXT NOT NULL DEFAULT 'Medium',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "raisedById" TEXT NOT NULL,
    "identifiedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetCloseDate" TIMESTAMP(3),
    "responseType" TEXT,
    "responseNarrative" TEXT,
    "managementActionPlan" TEXT,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "capOwnerId" TEXT,
    "capDueDate" TIMESTAMP(3),
    "capDescription" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closureNote" TEXT,
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementRisk" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "riskId" TEXT,
    "riskRating" TEXT NOT NULL DEFAULT 'Medium',
    "implementationId" TEXT,
    "controlType" TEXT,
    "controlNature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestProcedure" (
    "id" TEXT NOT NULL,
    "engagementRiskId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "procedure" TEXT NOT NULL,
    "testType" TEXT NOT NULL DEFAULT 'OperatingEffectiveness',
    "samplingMethod" TEXT NOT NULL DEFAULT 'Judgmental',
    "populationSize" INTEGER,
    "sampleSize" INTEGER NOT NULL DEFAULT 25,
    "status" TEXT NOT NULL DEFAULT 'NotStarted',
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "itemsTested" INTEGER NOT NULL,
    "exceptionsFound" INTEGER NOT NULL DEFAULT 0,
    "conclusion" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "testedById" TEXT NOT NULL,
    "testedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "findingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workpaper" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT 'Fieldwork',
    "content" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "procedureId" TEXT,
    "preparedById" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewConclusion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workpaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkpaperReviewNote" (
    "id" TEXT NOT NULL,
    "workpaperId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "response" TEXT,
    "clearedById" TEXT,
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkpaperReviewNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subjectType" TEXT NOT NULL,
    "steps" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT,
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStepRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "stepKey" TEXT NOT NULL,
    "stepType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assigneeId" TEXT,
    "requiredCapability" TEXT,
    "sodGuardedAction" TEXT,
    "decision" TEXT,
    "comment" TEXT,
    "dueAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCatalogItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ticketType" TEXT NOT NULL,
    "defaultImpact" TEXT NOT NULL DEFAULT 'Medium',
    "defaultUrgency" TEXT NOT NULL DEFAULT 'Medium',
    "assignmentGroup" TEXT,
    "workflowDefinitionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "priority" TEXT NOT NULL,
    "responseMins" INTEGER NOT NULL,
    "resolveMins" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketWorkNote" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketWorkNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "linkedTicketTypes" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "sourceTicketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capability" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "number" INTEGER,
    "tenancySpecific" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "scopeDescription" TEXT,
    "businessPurpose" TEXT,
    "capabilityGrants" TEXT NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "requiresMfa" BOOLEAN NOT NULL DEFAULT false,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ticketRef" TEXT,
    "requestedDurationMins" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SodRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "conflictingActions" TEXT NOT NULL,
    "guardedAction" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SodRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "content" TEXT NOT NULL,
    "isLockedOut" BOOLEAN NOT NULL DEFAULT false,
    "checkedOutBy" TEXT,
    "checkedOutAt" TIMESTAMP(3),
    "inheritedFromId" TEXT,
    "legalHoldMatter" TEXT,
    "legalHoldReason" TEXT,
    "legalHoldBy" TEXT,
    "legalHoldAt" TIMESTAMP(3),
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "fileType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" TEXT NOT NULL,
    "changeType" TEXT NOT NULL DEFAULT 'Minor',
    "summary" TEXT,
    "content" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "fileType" TEXT,
    "fileHash" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalQueue" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "sequenceOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "decision" TEXT,
    "reason" TEXT,
    "signatureHash" TEXT,
    "signerRole" TEXT,
    "sessionInfo" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Acknowledgement" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,

    CONSTRAINT "Acknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "type" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "impact" TEXT NOT NULL DEFAULT 'Medium',
    "urgency" TEXT NOT NULL DEFAULT 'Medium',
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignedTeam" TEXT,
    "sla" TEXT,
    "slaResponseAt" TIMESTAMP(3),
    "slaResolveAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "catalogItemId" TEXT,
    "workflowRunId" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenSourceTool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "maturity" TEXT NOT NULL,
    "review" TEXT NOT NULL,
    "deployment" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "annualPrice" DECIMAL(65,30) NOT NULL,
    "risk" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenSourceTool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Information',
    "ownership" TEXT NOT NULL DEFAULT 'Internal',
    "classification" TEXT NOT NULL DEFAULT 'Internal',
    "confidentiality" INTEGER NOT NULL DEFAULT 3,
    "integrity" INTEGER NOT NULL DEFAULT 3,
    "availability" INTEGER NOT NULL DEFAULT 3,
    "criticality" INTEGER NOT NULL DEFAULT 3,
    "criticalityTier" TEXT NOT NULL DEFAULT 'Medium',
    "ownerId" TEXT NOT NULL,
    "custodianId" TEXT,
    "location" TEXT,
    "vendorName" TEXT,
    "vendorId" TEXT,
    "contractRef" TEXT,
    "replacementValue" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "acquiredAt" TIMESTAMP(3),
    "reviewCadenceMonths" INTEGER NOT NULL DEFAULT 12,
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewDate" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "parentId" TEXT,
    "auditableEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRiskLink" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "threat" TEXT,
    "vulnerability" TEXT,
    "threatLevel" INTEGER,
    "vulnerabilityLevel" INTEGER,
    "exposureFactor" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetRiskLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetControlLink" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "implementationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetControlLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "description" TEXT,
    "country" TEXT,
    "dataLocation" TEXT,
    "dataAccess" TEXT NOT NULL DEFAULT 'None',
    "hasSystemAccess" BOOLEAN NOT NULL DEFAULT false,
    "subprocessors" TEXT,
    "serviceCriticality" INTEGER NOT NULL DEFAULT 3,
    "substitutability" INTEGER NOT NULL DEFAULT 3,
    "tier" TEXT NOT NULL DEFAULT 'Medium',
    "tierScore" INTEGER NOT NULL DEFAULT 9,
    "contractRef" TEXT,
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "noticePeriodDays" INTEGER,
    "annualSpend" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "relationshipOwnerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "onboardedAt" TIMESTAMP(3),
    "offboardedAt" TIMESTAMP(3),
    "assessmentCadenceMonths" INTEGER NOT NULL DEFAULT 12,
    "lastAssessedAt" TIMESTAMP(3),
    "nextAssessmentDue" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAssessment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'Periodic',
    "questionnaire" TEXT,
    "requestedById" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Requested',
    "submittedAt" TIMESTAMP(3),
    "score" INTEGER,
    "outcome" TEXT,
    "narrative" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorRiskLink" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorRiskLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedService" (
    "id" TEXT NOT NULL,
    "providerTenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "function" TEXT NOT NULL DEFAULT 'IT',
    "description" TEXT,
    "serviceOwnerId" TEXT NOT NULL,
    "slaSummary" TEXT,
    "reportingCadence" TEXT NOT NULL DEFAULT 'Quarterly',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedServiceConsumer" (
    "id" TEXT NOT NULL,
    "sharedServiceId" TEXT NOT NULL,
    "consumerTenantId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedServiceConsumer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedServiceControl" (
    "id" TEXT NOT NULL,
    "sharedServiceId" TEXT NOT NULL,
    "implementationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedServiceControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsmAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "authorization" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "critical" INTEGER NOT NULL,
    "high" INTEGER NOT NULL,
    "lastScan" TIMESTAMP(3) NOT NULL,
    "branch" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsmAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhishCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "targets" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "failureRate" DOUBLE PRECISION NOT NULL,
    "reportRate" DOUBLE PRECISION NOT NULL,
    "remediation" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhishCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "secretPrefix" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "vectorMock" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskScoreSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "riskId" TEXT,
    "inherentScore" DOUBLE PRECISION,
    "residualScore" DOUBLE PRECISION,
    "reason" TEXT NOT NULL DEFAULT 'Rescored',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAppetite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "appetiteThreshold" INTEGER NOT NULL,
    "toleranceThreshold" INTEGER NOT NULL,
    "setById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskAppetite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskCriteria" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "impactScale" TEXT NOT NULL,
    "likelihoodScale" TEXT NOT NULL,
    "highThreshold" INTEGER NOT NULL DEFAULT 15,
    "mediumThreshold" INTEGER NOT NULL DEFAULT 8,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "setById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskCriteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcsaCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "launchedById" TEXT,
    "launchedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RcsaCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcsaAssessment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "implementationId" TEXT NOT NULL,
    "respondentId" TEXT NOT NULL,
    "designRating" TEXT,
    "operatingRating" TEXT,
    "narrative" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "submittedAt" TIMESTAMP(3),
    "issueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RcsaAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kri" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "riskId" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'Higher',
    "amberThreshold" DOUBLE PRECISION NOT NULL,
    "redThreshold" DOUBLE PRECISION NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'Monthly',
    "ownerId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KriReading" (
    "id" TEXT NOT NULL,
    "kriId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "breachLevel" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issueId" TEXT,

    CONSTRAINT "KriReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LossEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "riskId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "recoveredAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "reportedById" TEXT NOT NULL,
    "issueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LossEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceQuota" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "limitValue" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Under',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerType" TEXT NOT NULL DEFAULT 'Scheduled',
    "triggerConfig" TEXT,
    "actionConfig" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "outcome" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "targetDesc" TEXT,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "errorLog" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameworkImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Extracted',
    "targetStandardId" TEXT,
    "newStandardCode" TEXT,
    "newStandardTitle" TEXT,
    "newStandardAuthority" TEXT,
    "newStandardVersion" TEXT,
    "extractedCount" INTEGER NOT NULL DEFAULT 0,
    "committedCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "FrameworkImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportCandidate" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "extra" TEXT,
    "payload" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'High',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "issue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_currentHash_key" ON "AuditLog"("currentHash");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_actorId_action_subjectId_idx" ON "AuditLog"("tenantId", "actorId", "action", "subjectId");

-- CreateIndex
CREATE INDEX "PasswordResetRequest_userId_status_idx" ON "PasswordResetRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "PasswordResetRequest_status_requestedAt_idx" ON "PasswordResetRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "Standard_tenantId_idx" ON "Standard"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Standard_tenantId_code_key" ON "Standard"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StandardClause_standardId_ref_key" ON "StandardClause"("standardId", "ref");

-- CreateIndex
CREATE INDEX "Control_domain_idx" ON "Control"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Control_tenantId_code_key" ON "Control"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ControlClauseLink_controlId_clauseId_key" ON "ControlClauseLink"("controlId", "clauseId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantStandardEnablement_tenantId_standardId_key" ON "TenantStandardEnablement"("tenantId", "standardId");

-- CreateIndex
CREATE INDEX "ControlImplementation_tenantId_status_idx" ON "ControlImplementation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ControlImplementation_nextDueDate_idx" ON "ControlImplementation"("nextDueDate");

-- CreateIndex
CREATE INDEX "Evidence_tenantId_implementationId_idx" ON "Evidence"("tenantId", "implementationId");

-- CreateIndex
CREATE INDEX "Risk_tenantId_status_idx" ON "Risk"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Risk_tenantId_nextReviewDate_idx" ON "Risk"("tenantId", "nextReviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "Risk_tenantId_ref_key" ON "Risk"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "RiskEntityLink_auditableEntityId_idx" ON "RiskEntityLink"("auditableEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEntityLink_riskId_auditableEntityId_key" ON "RiskEntityLink"("riskId", "auditableEntityId");

-- CreateIndex
CREATE INDEX "RiskLink_effectId_idx" ON "RiskLink"("effectId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskLink_causeId_effectId_key" ON "RiskLink"("causeId", "effectId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskControlLink_riskId_implementationId_key" ON "RiskControlLink"("riskId", "implementationId");

-- CreateIndex
CREATE INDEX "RiskTreatmentAction_riskId_status_idx" ON "RiskTreatmentAction"("riskId", "status");

-- CreateIndex
CREATE INDEX "AuditableEntity_tenantId_riskTier_idx" ON "AuditableEntity"("tenantId", "riskTier");

-- CreateIndex
CREATE UNIQUE INDEX "AuditableEntity_tenantId_ref_key" ON "AuditableEntity"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "AuditPlan_tenantId_status_idx" ON "AuditPlan"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditPlan_tenantId_year_key" ON "AuditPlan"("tenantId", "year");

-- CreateIndex
CREATE INDEX "AuditPlanItem_planId_status_idx" ON "AuditPlanItem"("planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditPlanItem_planId_auditableEntityId_key" ON "AuditPlanItem"("planId", "auditableEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "Audit_planItemId_key" ON "Audit"("planItemId");

-- CreateIndex
CREATE INDEX "Audit_tenantId_status_idx" ON "Audit"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Audit_tenantId_ref_key" ON "Audit"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "Issue_tenantId_status_idx" ON "Issue"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Issue_tenantId_source_idx" ON "Issue"("tenantId", "source");

-- CreateIndex
CREATE INDEX "Issue_auditId_idx" ON "Issue"("auditId");

-- CreateIndex
CREATE INDEX "Issue_riskId_idx" ON "Issue"("riskId");

-- CreateIndex
CREATE INDEX "Issue_auditableEntityId_idx" ON "Issue"("auditableEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_tenantId_ref_key" ON "Issue"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "EngagementRisk_auditId_idx" ON "EngagementRisk"("auditId");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementRisk_auditId_ref_key" ON "EngagementRisk"("auditId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "TestProcedure_engagementRiskId_ref_key" ON "TestProcedure"("engagementRiskId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "TestResult_procedureId_key" ON "TestResult"("procedureId");

-- CreateIndex
CREATE INDEX "Workpaper_auditId_status_idx" ON "Workpaper"("auditId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Workpaper_auditId_ref_key" ON "Workpaper"("auditId", "ref");

-- CreateIndex
CREATE INDEX "WorkpaperReviewNote_workpaperId_status_idx" ON "WorkpaperReviewNote"("workpaperId", "status");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_subjectType_isActive_idx" ON "WorkflowDefinition"("subjectType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_tenantId_key_key" ON "WorkflowDefinition"("tenantId", "key");

-- CreateIndex
CREATE INDEX "WorkflowRun_tenantId_status_idx" ON "WorkflowRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_subjectType_subjectId_idx" ON "WorkflowRun"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_runId_stepIndex_idx" ON "WorkflowStepRun"("runId", "stepIndex");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_assigneeId_status_idx" ON "WorkflowStepRun"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_status_dueAt_idx" ON "WorkflowStepRun"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCatalogItem_tenantId_key_key" ON "ServiceCatalogItem"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_tenantId_priority_key" ON "SlaPolicy"("tenantId", "priority");

-- CreateIndex
CREATE INDEX "TicketComment_ticketId_createdAt_idx" ON "TicketComment"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketWorkNote_ticketId_createdAt_idx" ON "TicketWorkNote"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_tenantId_status_idx" ON "KnowledgeArticle"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Role_portal_idx" ON "Role"("portal");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_key_key" ON "Role"("tenantId", "key");

-- CreateIndex
CREATE INDEX "ImpersonationSession_status_requestedAt_idx" ON "ImpersonationSession"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "ImpersonationSession_tenantId_status_idx" ON "ImpersonationSession"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ImpersonationSession_subjectUserId_idx" ON "ImpersonationSession"("subjectUserId");

-- CreateIndex
CREATE INDEX "SodRule_guardedAction_subjectType_isActive_idx" ON "SodRule"("guardedAction", "subjectType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SodRule_tenantId_key_key" ON "SodRule"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_status_idx" ON "Ticket"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Ticket_assigneeId_status_idx" ON "Ticket"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Ticket_slaResolveAt_status_idx" ON "Ticket"("slaResolveAt", "status");

-- CreateIndex
CREATE INDEX "Asset_tenantId_criticalityTier_idx" ON "Asset"("tenantId", "criticalityTier");

-- CreateIndex
CREATE INDEX "Asset_tenantId_ownership_idx" ON "Asset"("tenantId", "ownership");

-- CreateIndex
CREATE INDEX "Asset_tenantId_nextReviewDate_idx" ON "Asset"("tenantId", "nextReviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tenantId_ref_key" ON "Asset"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "AssetRiskLink_riskId_idx" ON "AssetRiskLink"("riskId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetRiskLink_assetId_riskId_key" ON "AssetRiskLink"("assetId", "riskId");

-- CreateIndex
CREATE INDEX "AssetControlLink_implementationId_idx" ON "AssetControlLink"("implementationId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetControlLink_assetId_implementationId_key" ON "AssetControlLink"("assetId", "implementationId");

-- CreateIndex
CREATE INDEX "Vendor_tenantId_tier_idx" ON "Vendor"("tenantId", "tier");

-- CreateIndex
CREATE INDEX "Vendor_tenantId_status_idx" ON "Vendor"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Vendor_tenantId_nextAssessmentDue_idx" ON "Vendor"("tenantId", "nextAssessmentDue");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_tenantId_ref_key" ON "Vendor"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "VendorAssessment_vendorId_status_idx" ON "VendorAssessment"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAssessment_tenantId_ref_key" ON "VendorAssessment"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "VendorRiskLink_riskId_idx" ON "VendorRiskLink"("riskId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorRiskLink_vendorId_riskId_key" ON "VendorRiskLink"("vendorId", "riskId");

-- CreateIndex
CREATE INDEX "SharedService_providerTenantId_status_idx" ON "SharedService"("providerTenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SharedService_providerTenantId_ref_key" ON "SharedService"("providerTenantId", "ref");

-- CreateIndex
CREATE INDEX "SharedServiceConsumer_consumerTenantId_idx" ON "SharedServiceConsumer"("consumerTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedServiceConsumer_sharedServiceId_consumerTenantId_key" ON "SharedServiceConsumer"("sharedServiceId", "consumerTenantId");

-- CreateIndex
CREATE INDEX "SharedServiceControl_implementationId_idx" ON "SharedServiceControl"("implementationId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedServiceControl_sharedServiceId_implementationId_key" ON "SharedServiceControl"("sharedServiceId", "implementationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "RiskScoreSnapshot_riskId_recordedAt_idx" ON "RiskScoreSnapshot"("riskId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAppetite_supersededById_key" ON "RiskAppetite"("supersededById");

-- CreateIndex
CREATE INDEX "RiskAppetite_tenantId_status_idx" ON "RiskAppetite"("tenantId", "status");

-- CreateIndex
CREATE INDEX "RiskAppetite_tenantId_category_effectiveFrom_idx" ON "RiskAppetite"("tenantId", "category", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAppetite_tenantId_category_version_key" ON "RiskAppetite"("tenantId", "category", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RiskCriteria_supersededById_key" ON "RiskCriteria"("supersededById");

-- CreateIndex
CREATE INDEX "RiskCriteria_tenantId_status_idx" ON "RiskCriteria"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiskCriteria_tenantId_version_key" ON "RiskCriteria"("tenantId", "version");

-- CreateIndex
CREATE INDEX "RcsaCampaign_tenantId_status_idx" ON "RcsaCampaign"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RcsaCampaign_tenantId_ref_key" ON "RcsaCampaign"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "RcsaAssessment_tenantId_status_idx" ON "RcsaAssessment"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RcsaAssessment_campaignId_implementationId_key" ON "RcsaAssessment"("campaignId", "implementationId");

-- CreateIndex
CREATE INDEX "Kri_tenantId_isActive_idx" ON "Kri"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Kri_tenantId_name_key" ON "Kri"("tenantId", "name");

-- CreateIndex
CREATE INDEX "KriReading_tenantId_breachLevel_idx" ON "KriReading"("tenantId", "breachLevel");

-- CreateIndex
CREATE UNIQUE INDEX "KriReading_kriId_periodLabel_key" ON "KriReading"("kriId", "periodLabel");

-- CreateIndex
CREATE INDEX "LossEvent_tenantId_status_idx" ON "LossEvent"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LossEvent_tenantId_occurredAt_idx" ON "LossEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "LossEvent_tenantId_ref_key" ON "LossEvent"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ResourceQuota_tenantId_status_idx" ON "ResourceQuota"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceQuota_tenantId_resourceType_key" ON "ResourceQuota"("tenantId", "resourceType");

-- CreateIndex
CREATE INDEX "AutomationRule_tenantId_status_idx" ON "AutomationRule"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_tenantId_name_key" ON "AutomationRule"("tenantId", "name");

-- CreateIndex
CREATE INDEX "AutomationExecution_ruleId_startedAt_idx" ON "AutomationExecution"("ruleId", "startedAt");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_status_idx" ON "ImportJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "FrameworkImport_tenantId_status_idx" ON "FrameworkImport"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ImportCandidate_importId_status_idx" ON "ImportCandidate"("importId", "status");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Standard" ADD CONSTRAINT "Standard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandardClause" ADD CONSTRAINT "StandardClause_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "Standard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Control" ADD CONSTRAINT "Control_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlClauseLink" ADD CONSTRAINT "ControlClauseLink_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlClauseLink" ADD CONSTRAINT "ControlClauseLink_clauseId_fkey" FOREIGN KEY ("clauseId") REFERENCES "StandardClause"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantStandardEnablement" ADD CONSTRAINT "TenantStandardEnablement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantStandardEnablement" ADD CONSTRAINT "TenantStandardEnablement_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "Standard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantStandardEnablement" ADD CONSTRAINT "TenantStandardEnablement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlImplementation" ADD CONSTRAINT "ControlImplementation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlImplementation" ADD CONSTRAINT "ControlImplementation_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlImplementation" ADD CONSTRAINT "ControlImplementation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlImplementation" ADD CONSTRAINT "ControlImplementation_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlImplementation" ADD CONSTRAINT "ControlImplementation_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "ControlImplementation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_acceptedUnderAppetiteId_fkey" FOREIGN KEY ("acceptedUnderAppetiteId") REFERENCES "RiskAppetite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEntityLink" ADD CONSTRAINT "RiskEntityLink_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEntityLink" ADD CONSTRAINT "RiskEntityLink_auditableEntityId_fkey" FOREIGN KEY ("auditableEntityId") REFERENCES "AuditableEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskLink" ADD CONSTRAINT "RiskLink_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskLink" ADD CONSTRAINT "RiskLink_effectId_fkey" FOREIGN KEY ("effectId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControlLink" ADD CONSTRAINT "RiskControlLink_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControlLink" ADD CONSTRAINT "RiskControlLink_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "ControlImplementation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskTreatmentAction" ADD CONSTRAINT "RiskTreatmentAction_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskTreatmentAction" ADD CONSTRAINT "RiskTreatmentAction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditableEntity" ADD CONSTRAINT "AuditableEntity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditableEntity" ADD CONSTRAINT "AuditableEntity_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AuditableEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditableEntity" ADD CONSTRAINT "AuditableEntity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPlan" ADD CONSTRAINT "AuditPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPlan" ADD CONSTRAINT "AuditPlan_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPlan" ADD CONSTRAINT "AuditPlan_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPlanItem" ADD CONSTRAINT "AuditPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AuditPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPlanItem" ADD CONSTRAINT "AuditPlanItem_auditableEntityId_fkey" FOREIGN KEY ("auditableEntityId") REFERENCES "AuditableEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPlanItem" ADD CONSTRAINT "AuditPlanItem_assignedLeadId_fkey" FOREIGN KEY ("assignedLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_leadAuditorId_fkey" FOREIGN KEY ("leadAuditorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "AuditPlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_concludedById_fkey" FOREIGN KEY ("concludedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "ControlImplementation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_auditableEntityId_fkey" FOREIGN KEY ("auditableEntityId") REFERENCES "AuditableEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_capOwnerId_fkey" FOREIGN KEY ("capOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementRisk" ADD CONSTRAINT "EngagementRisk_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementRisk" ADD CONSTRAINT "EngagementRisk_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementRisk" ADD CONSTRAINT "EngagementRisk_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "ControlImplementation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestProcedure" ADD CONSTRAINT "TestProcedure_engagementRiskId_fkey" FOREIGN KEY ("engagementRiskId") REFERENCES "EngagementRisk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestProcedure" ADD CONSTRAINT "TestProcedure_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "TestProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_testedById_fkey" FOREIGN KEY ("testedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workpaper" ADD CONSTRAINT "Workpaper_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workpaper" ADD CONSTRAINT "Workpaper_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "TestProcedure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workpaper" ADD CONSTRAINT "Workpaper_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workpaper" ADD CONSTRAINT "Workpaper_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkpaperReviewNote" ADD CONSTRAINT "WorkpaperReviewNote_workpaperId_fkey" FOREIGN KEY ("workpaperId") REFERENCES "Workpaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkpaperReviewNote" ADD CONSTRAINT "WorkpaperReviewNote_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkpaperReviewNote" ADD CONSTRAINT "WorkpaperReviewNote_clearedById_fkey" FOREIGN KEY ("clearedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStepRun" ADD CONSTRAINT "WorkflowStepRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStepRun" ADD CONSTRAINT "WorkflowStepRun_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStepRun" ADD CONSTRAINT "WorkflowStepRun_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWorkNote" ADD CONSTRAINT "TicketWorkNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketWorkNote" ADD CONSTRAINT "TicketWorkNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalQueue" ADD CONSTRAINT "ApprovalQueue_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalQueue" ADD CONSTRAINT "ApprovalQueue_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acknowledgement" ADD CONSTRAINT "Acknowledgement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acknowledgement" ADD CONSTRAINT "Acknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "ServiceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_auditableEntityId_fkey" FOREIGN KEY ("auditableEntityId") REFERENCES "AuditableEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRiskLink" ADD CONSTRAINT "AssetRiskLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRiskLink" ADD CONSTRAINT "AssetRiskLink_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetControlLink" ADD CONSTRAINT "AssetControlLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetControlLink" ADD CONSTRAINT "AssetControlLink_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "ControlImplementation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_relationshipOwnerId_fkey" FOREIGN KEY ("relationshipOwnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAssessment" ADD CONSTRAINT "VendorAssessment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAssessment" ADD CONSTRAINT "VendorAssessment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAssessment" ADD CONSTRAINT "VendorAssessment_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAssessment" ADD CONSTRAINT "VendorAssessment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorRiskLink" ADD CONSTRAINT "VendorRiskLink_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorRiskLink" ADD CONSTRAINT "VendorRiskLink_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedService" ADD CONSTRAINT "SharedService_providerTenantId_fkey" FOREIGN KEY ("providerTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedService" ADD CONSTRAINT "SharedService_serviceOwnerId_fkey" FOREIGN KEY ("serviceOwnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedServiceConsumer" ADD CONSTRAINT "SharedServiceConsumer_sharedServiceId_fkey" FOREIGN KEY ("sharedServiceId") REFERENCES "SharedService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedServiceConsumer" ADD CONSTRAINT "SharedServiceConsumer_consumerTenantId_fkey" FOREIGN KEY ("consumerTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedServiceConsumer" ADD CONSTRAINT "SharedServiceConsumer_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedServiceControl" ADD CONSTRAINT "SharedServiceControl_sharedServiceId_fkey" FOREIGN KEY ("sharedServiceId") REFERENCES "SharedService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedServiceControl" ADD CONSTRAINT "SharedServiceControl_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "ControlImplementation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsmAsset" ADD CONSTRAINT "AsmAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhishCampaign" ADD CONSTRAINT "PhishCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskScoreSnapshot" ADD CONSTRAINT "RiskScoreSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskScoreSnapshot" ADD CONSTRAINT "RiskScoreSnapshot_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAppetite" ADD CONSTRAINT "RiskAppetite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAppetite" ADD CONSTRAINT "RiskAppetite_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAppetite" ADD CONSTRAINT "RiskAppetite_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAppetite" ADD CONSTRAINT "RiskAppetite_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "RiskAppetite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskCriteria" ADD CONSTRAINT "RiskCriteria_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskCriteria" ADD CONSTRAINT "RiskCriteria_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskCriteria" ADD CONSTRAINT "RiskCriteria_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskCriteria" ADD CONSTRAINT "RiskCriteria_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "RiskCriteria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcsaCampaign" ADD CONSTRAINT "RcsaCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcsaCampaign" ADD CONSTRAINT "RcsaCampaign_launchedById_fkey" FOREIGN KEY ("launchedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcsaAssessment" ADD CONSTRAINT "RcsaAssessment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "RcsaCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcsaAssessment" ADD CONSTRAINT "RcsaAssessment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcsaAssessment" ADD CONSTRAINT "RcsaAssessment_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "ControlImplementation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcsaAssessment" ADD CONSTRAINT "RcsaAssessment_respondentId_fkey" FOREIGN KEY ("respondentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcsaAssessment" ADD CONSTRAINT "RcsaAssessment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kri" ADD CONSTRAINT "Kri_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kri" ADD CONSTRAINT "Kri_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kri" ADD CONSTRAINT "Kri_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KriReading" ADD CONSTRAINT "KriReading_kriId_fkey" FOREIGN KEY ("kriId") REFERENCES "Kri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KriReading" ADD CONSTRAINT "KriReading_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KriReading" ADD CONSTRAINT "KriReading_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KriReading" ADD CONSTRAINT "KriReading_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossEvent" ADD CONSTRAINT "LossEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossEvent" ADD CONSTRAINT "LossEvent_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossEvent" ADD CONSTRAINT "LossEvent_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossEvent" ADD CONSTRAINT "LossEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceQuota" ADD CONSTRAINT "ResourceQuota_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkImport" ADD CONSTRAINT "FrameworkImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkImport" ADD CONSTRAINT "FrameworkImport_targetStandardId_fkey" FOREIGN KEY ("targetStandardId") REFERENCES "Standard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkImport" ADD CONSTRAINT "FrameworkImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportCandidate" ADD CONSTRAINT "ImportCandidate_importId_fkey" FOREIGN KEY ("importId") REFERENCES "FrameworkImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

