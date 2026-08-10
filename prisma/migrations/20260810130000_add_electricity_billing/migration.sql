-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "BillerProvider" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ELECTRICITY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillerProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterWhitelist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "billerId" UUID NOT NULL,
    "ledgerNo" TEXT,
    "customerNo" TEXT NOT NULL,
    "meterNo" TEXT,
    "customerName" TEXT NOT NULL,
    "address" TEXT,
    "billCode" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "unitsUsed" INTEGER NOT NULL DEFAULT 0,
    "powerFee" DECIMAL(14,2) NOT NULL,
    "serviceFee" DECIMAL(14,2) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeterWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillerProvider_code_key" ON "BillerProvider"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MeterWhitelist_customerNo_key" ON "MeterWhitelist"("customerNo");

-- CreateIndex
CREATE INDEX "MeterWhitelist_billerId_idx" ON "MeterWhitelist"("billerId");

-- AddForeignKey
ALTER TABLE "MeterWhitelist" ADD CONSTRAINT "MeterWhitelist_billerId_fkey" FOREIGN KEY ("billerId") REFERENCES "BillerProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
