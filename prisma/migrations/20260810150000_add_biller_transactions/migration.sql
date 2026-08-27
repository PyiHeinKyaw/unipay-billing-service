-- AlterTable
ALTER TABLE "MeterWhitelist" ADD COLUMN     "horsepower" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MerchantAccount" (
    "merchantId" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MMK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantAccount_pkey" PRIMARY KEY ("merchantId")
);

-- CreateTable
CREATE TABLE "BillerTransaction" (
    "id" UUID NOT NULL,
    "merchantId" TEXT NOT NULL,
    "billerCode" TEXT NOT NULL,
    "barcodeNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerNo" TEXT NOT NULL,
    "meterNo" TEXT,
    "unit" INTEGER NOT NULL,
    "horsepower" DECIMAL(14,2) NOT NULL,
    "billAmount" DECIMAL(14,2) NOT NULL,
    "serviceFee" DECIMAL(14,2) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL,
    "transactionRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillerTransaction_transactionRef_key" ON "BillerTransaction"("transactionRef");

-- CreateIndex
CREATE INDEX "BillerTransaction_merchantId_idx" ON "BillerTransaction"("merchantId");

-- CreateIndex
CREATE INDEX "BillerTransaction_customerNo_idx" ON "BillerTransaction"("customerNo");

-- AddForeignKey
ALTER TABLE "BillerTransaction" ADD CONSTRAINT "BillerTransaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount"("merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
