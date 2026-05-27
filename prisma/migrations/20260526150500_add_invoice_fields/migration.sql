-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactName" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "voice" TEXT NOT NULL DEFAULT 'marcus',
    "manner" TEXT NOT NULL DEFAULT 'warm',
    "invoiceNumber" TEXT,
    "invoiceDate" TEXT,
    "dueDate" TEXT,
    "totalAmount" REAL,
    "amountDue" REAL,
    "currency" TEXT,
    "lineItems" TEXT,
    "invoiceNotes" TEXT,
    "vapiCallId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'dispatching',
    "outcome" TEXT,
    "durationSec" INTEGER,
    "endedReason" TEXT,
    "result" TEXT,
    "summary" TEXT,
    "transcript" TEXT,
    "recordingUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Call_vapiCallId_key" ON "Call"("vapiCallId");
