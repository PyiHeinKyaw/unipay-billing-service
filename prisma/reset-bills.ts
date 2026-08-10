import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const resetBills = async (): Promise<void> => {
  const result = await prisma.meterWhitelist.updateMany({
    where: { isPaid: true },
    data: { isPaid: false },
  });

  console.log(`Reset ${result.count} meter bill(s) to UNPAID status.`);
  console.log('BillerTransaction history was preserved.');
};

try {
  await resetBills();
} finally {
  await prisma.$disconnect();
}
