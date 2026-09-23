-- Invoice a client for a period, with lines derived from their plan.
--
-- An invoice carried one hand-typed amount and nothing else: no period, no
-- reference to the subscription, no lines. A finance manager could not bill a
-- duration, could not see which package a client was on, and could not say
-- what any figure was made of.
--
-- This migration adds subscriptionId, periodStart, periodEnd, periodLabel,
-- netAmount, vatAmount, vatRate, poNumber, and issuedById to Invoice, and adds
-- the InvoiceLine table.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "netAmount" DECIMAL(65,30),
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodLabel" TEXT,
ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "vatAmount" DECIMAL(65,30),
ADD COLUMN     "vatRate" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_periodStart_idx" ON "Invoice"("tenantId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_subscriptionId_periodStart_key" ON "Invoice"("subscriptionId", "periodStart");

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
