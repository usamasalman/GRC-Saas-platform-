-- AlterTable
ALTER TABLE "User" ADD COLUMN     "offboardedAt" TIMESTAMP(3),
ADD COLUMN     "offboardedById" TEXT,
ADD COLUMN     "successorId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_offboardedById_fkey" FOREIGN KEY ("offboardedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

