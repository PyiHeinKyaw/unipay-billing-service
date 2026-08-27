ALTER TABLE "MeterWhitelist"
ADD COLUMN "paymentReference" TEXT,
ADD COLUMN "paidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "MeterWhitelist_paymentReference_key"
ON "MeterWhitelist"("paymentReference");
