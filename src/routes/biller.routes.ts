import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { errorResponse, successResponse } from '../utils/response.js';

const SERVICE_FEE = 100;

const billerRequestSchema = z.object({
  billerCode: z.string().trim().min(1, 'billerCode is required'),
  barcodeNumber: z.string().trim().min(1, 'barcodeNumber is required'),
});

const payBillRequestSchema = billerRequestSchema.extend({
  merchantId: z.string().trim().min(1, 'merchantId is required'),
  amount: z.coerce.number().refine(Number.isFinite, 'amount must be a number'),
});

type BillRecord = {
  biller: {
    code: string;
    name: string;
  };
  customerNo: string;
  meterNo: string | null;
  customerName: string;
  address: string | null;
  billCode: string | null;
  dueDate: Date;
  unitsUsed: number;
  horsepower: unknown;
  powerFee: unknown;
  totalAmount: unknown;
};

const sendValidationError = (reply: FastifyReply, message: string) =>
  reply.status(400).send(errorResponse(400, message));

const barcodeCandidates = (barcodeNumber: string): string[] => {
  const compactBarcode = barcodeNumber.trim().replace(/[\s-]/g, '');
  const canonicalBarcode = /^\d{9}$/.test(compactBarcode)
    ? `${compactBarcode.slice(0, 3)}-${compactBarcode.slice(3)}`
    : barcodeNumber.trim();

  return [...new Set([canonicalBarcode, compactBarcode])];
};

const previewPayload = (record: BillRecord) => {
  const billAmount = Number(record.totalAmount);

  return {
    billerCode: record.biller.code,
    billerName: record.biller.name,
    customerNo: record.customerNo,
    barcodeNumber: record.customerNo,
    meterNo: record.meterNo,
    customerName: record.customerName,
    address: record.address,
    billCode: record.billCode,
    dueDate: record.dueDate.toISOString(),
    unitsUsed: record.unitsUsed,
    unit: record.unitsUsed,
    horsepower: Number(record.horsepower),
    powerFee: Number(record.powerFee),
    billAmount,
    serviceFee: SERVICE_FEE,
    totalPayableAmount: billAmount + SERVICE_FEE,
  };
};

const billerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/biller/providers', async () => {
    const providers = await fastify.prisma.billerProvider.findMany({
      where: {
        category: 'ELECTRICITY',
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    return successResponse(
      providers.map((provider) => ({
        id: provider.id,
        code: provider.code,
        name: provider.name,
        billerCode: provider.code,
        billerName: provider.name,
        category: provider.category,
        isActive: provider.isActive,
      })),
    );
  });

  fastify.post<{ Body: unknown }>('/api/biller/verify-barcode', async (request, reply) => {
    const parsedBody = billerRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendValidationError(reply, parsedBody.error.issues[0]?.message ?? 'Invalid request body');
    }

    const { barcodeNumber } = parsedBody.data;
    console.log('Incoming payload:', request.body);
    request.log.info({ body: request.body }, 'Verify Request');
    const record = await fastify.prisma.meterWhitelist.findFirst({
      where: {
        customerNo: { in: barcodeCandidates(barcodeNumber) },
      },
      include: { biller: { select: { code: true, name: true } } },
    });
    request.log.info({ found: Boolean(record), customerNo: record?.customerNo }, 'Verify Result');

    if (!record) {
      return reply.status(404).send(errorResponse(404, 'မီတာဘေလ် Barcode နံပါတ် မရှိပါ။'));
    }

    if (record.isPaid) {
      return reply.status(400).send(errorResponse(400, 'ဤမီတာဘေလ်အား ပေးချေပြီး ဖြစ်ပါသည်'));
    }

    return successResponse(previewPayload(record));
  });

  fastify.post<{ Body: unknown }>('/api/biller/pay-bill', async (request, reply) => {
    const parsedBody = payBillRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendValidationError(reply, parsedBody.error.issues[0]?.message ?? 'Invalid request body');
    }

    const { merchantId, billerCode, barcodeNumber, amount } = parsedBody.data;
    const payment = await fastify.prisma.$transaction(async (tx) => {
      const record = await tx.meterWhitelist.findFirst({
        where: {
          customerNo: { in: barcodeCandidates(barcodeNumber) },
          biller: {
            code: billerCode,
            category: 'ELECTRICITY',
            isActive: true,
          },
        },
        include: { biller: { select: { code: true, name: true } } },
      });

      if (!record) return { kind: 'notFound' as const };
      if (record.isPaid) return { kind: 'paid' as const };

      const billAmount = Number(record.totalAmount);
      const totalPayableAmount = billAmount + SERVICE_FEE;
      if (Math.abs(amount - totalPayableAmount) > 0.001) {
        return { kind: 'invalidAmount' as const };
      }

      const updated = await tx.meterWhitelist.updateMany({
        where: { id: record.id, isPaid: false },
        data: { isPaid: true },
      });
      if (updated.count === 0) return { kind: 'paid' as const };

      const transactionRef = `EBP-${randomUUID()}`;
      await tx.billerTransaction.create({
        data: {
          merchantId,
          billerCode,
          barcodeNumber: record.customerNo,
          customerName: record.customerName,
          customerNo: record.customerNo,
          meterNo: record.meterNo,
          unit: record.unitsUsed,
          horsepower: record.horsepower,
          billAmount,
          serviceFee: SERVICE_FEE,
          totalAmount: totalPayableAmount,
          status: 'SUCCESS',
          transactionRef,
        },
      });

      return {
        kind: 'success' as const,
        record,
        totalPayableAmount,
        transactionRef,
      };
    });

    if (payment.kind === 'notFound') {
      return reply.status(404).send(errorResponse(404, 'မီတာဘေလ် Barcode နံပါတ် မရှိပါ။'));
    }
    if (payment.kind === 'paid') {
      return reply.status(400).send(errorResponse(400, 'ဤမီတာဘေလ်အား ပေးချေပြီး ဖြစ်ပါသည်'));
    }
    if (payment.kind === 'invalidAmount') {
      return reply.status(400).send(errorResponse(400, 'Invalid payment amount'));
    }

    return successResponse({
      ...previewPayload(payment.record),
      amount: payment.totalPayableAmount,
      status: 'SUCCESS',
      transactionRef: payment.transactionRef,
      paidAt: new Date().toISOString(),
    });
  });
};

export default billerRoutes;
