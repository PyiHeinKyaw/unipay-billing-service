import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { errorResponse, successResponse } from '../utils/response.js';

const MESC_SERVICE_ID = '6a7bf1e3eb2c6424aa4b257c';

const billerRequestSchema = z.object({
  billerCode: z.string().trim().min(1, 'billerCode is required'),
  barcodeNumber: z.string().trim().min(1, 'barcodeNumber is required'),
});

const payBillRequestSchema = billerRequestSchema.extend({
  merchantId: z.string().trim().min(1, 'merchantId is required'),
  amount: z.coerce.number().refine(Number.isFinite, 'amount must be a number'),
  payerPhone: z.string().trim().regex(/^\d{7,15}$/, 'payerPhone must contain 7 to 15 digits'),
  payerAddress: z.string().trim().min(1, 'payerAddress is required').max(250),
});

const mescBillRequestSchema = z.object({
  transRefId: z.string().trim().min(1, 'transRefId is required'),
  serviceId: z.string().trim().min(1, 'serviceId is required'),
  amount: z.coerce.number().positive('amount must be greater than zero'),
  invoiceNo: z.string().trim().min(1, 'invoiceNo is required'),
  payerName: z.string().trim().min(1, 'payerName is required').max(250),
  payerPhone: z.string().trim().regex(/^\d{7,15}$/, 'payerPhone must contain 7 to 15 digits'),
  enquiry: z.union([z.boolean(), z.string()]).optional().transform((value) =>
    value === true || (typeof value === 'string' && value.toLowerCase() === 'true'),
  ),
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
  serviceFee: unknown;
  totalAmount: unknown;
  isPaid: boolean;
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
  const totalPayableAmount = Number(record.totalAmount);
  const serviceFee = Number(record.serviceFee);
  const billAmount = totalPayableAmount - serviceFee;

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
    serviceFee,
    totalPayableAmount,
  };
};

const walletBillerResponse = (record: BillRecord, transRefId: string) => {
  const preview = previewPayload(record);

  return {
    err: 0,
    message: 'Success',
    transAmount: preview.totalPayableAmount,
    discountAmount: 0,
    detail: {
      transRefId,
      invoiceNo: preview.barcodeNumber,
      status: record.isPaid ? 'SUCCESS' : 'UNPAID',
      ...preview,
      billerCode: 'MESCMETERBILL',
      billerName: 'MESC Meter Billing',
    },
  };
};

const billerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: unknown }>('/billpayment/mescbill', async (request) => {
    const parsedBody = mescBillRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return {
        err: 9000,
        message: parsedBody.error.issues[0]?.message ?? 'Invalid request body',
      };
    }

    const { transRefId, serviceId, amount, invoiceNo, enquiry } = parsedBody.data;
    if (serviceId !== MESC_SERVICE_ID) {
      return { err: 9022, message: 'Wrong Service ID Format' };
    }

    const findBill = () =>
      fastify.prisma.meterWhitelist.findFirst({
        where: {
          customerNo: { in: barcodeCandidates(invoiceNo) },
          biller: {
            category: 'ELECTRICITY',
            isActive: true,
          },
        },
        include: { biller: { select: { code: true, name: true } } },
      });

    if (enquiry) {
      const record = await findBill();
      if (!record) return { err: 9001, message: 'Meter bill invoice was not found' };
      if (record.isPaid) return { err: 9002, message: 'This meter bill has already been paid' };

      return walletBillerResponse(record, transRefId);
    }

    const payment = await fastify.prisma.$transaction(async (tx) => {
      const previous = await tx.meterWhitelist.findUnique({
        where: { paymentReference: transRefId },
        include: { biller: { select: { code: true, name: true } } },
      });
      if (previous) return { kind: 'success' as const, record: previous };

      const record = await tx.meterWhitelist.findFirst({
        where: {
          customerNo: { in: barcodeCandidates(invoiceNo) },
          biller: {
            category: 'ELECTRICITY',
            isActive: true,
          },
        },
        include: { biller: { select: { code: true, name: true } } },
      });
      if (!record) return { kind: 'notFound' as const };
      if (record.isPaid) return { kind: 'paid' as const };

      const totalPayableAmount = Number(record.totalAmount);
      if (Math.abs(amount - totalPayableAmount) > 0.001) {
        return { kind: 'invalidAmount' as const };
      }

      const updated = await tx.meterWhitelist.updateMany({
        where: { id: record.id, isPaid: false },
        data: { isPaid: true, paymentReference: transRefId, paidAt: new Date() },
      });
      if (updated.count === 0) return { kind: 'paid' as const };

      const paidRecord = await tx.meterWhitelist.findUniqueOrThrow({
        where: { id: record.id },
        include: { biller: { select: { code: true, name: true } } },
      });
      return { kind: 'success' as const, record: paidRecord };
    });

    if (payment.kind === 'notFound') return { err: 9001, message: 'Meter bill invoice was not found' };
    if (payment.kind === 'paid') return { err: 9002, message: 'This meter bill has already been paid' };
    if (payment.kind === 'invalidAmount') return { err: 9003, message: 'Invalid payment amount' };

    return walletBillerResponse(payment.record, transRefId);
  });

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

    const { merchantId, billerCode, barcodeNumber, amount, payerPhone, payerAddress } = parsedBody.data;
    const transactionRef = `EBP-${randomUUID()}`;

    const record = await fastify.prisma.meterWhitelist.findFirst({
      where: {
        customerNo: { in: barcodeCandidates(barcodeNumber) },
        biller: { code: billerCode, category: 'ELECTRICITY', isActive: true },
      },
      include: { biller: { select: { code: true, name: true } } },
    });
    if (!record) {
      return reply.status(404).send(errorResponse(404, 'မီတာဘေလ် Barcode နံပါတ် မရှိပါ။'));
    }
    if (record.isPaid) {
      return reply.status(400).send(errorResponse(400, 'ဤမီတာဘေလ်အား ပေးချေပြီး ဖြစ်ပါသည်'));
    }

    const preview = previewPayload(record);
    if (Math.abs(Number(amount) - preview.totalPayableAmount) > 0.001) {
      return sendValidationError(reply, 'Invalid payment amount');
    }
    const billAmount = preview.billAmount;
    const serviceFee = preview.serviceFee;
    const totalPayableAmount = preview.totalPayableAmount;

    const mockRecord = {
      biller: { code: billerCode, name: billerCode },
      customerNo: barcodeNumber,
      meterNo: null,
      customerName: record.customerName,
      address: record.address,
      billCode: record.billCode,
      dueDate: record.dueDate,
      unitsUsed: record.unitsUsed,
      horsepower: record.horsepower,
      powerFee: record.powerFee,
      totalAmount: record.totalAmount,
    };

    try {
      await fastify.prisma.billerTransaction.create({
        data: {
          merchantId,
          billerCode,
          barcodeNumber,
          payerPhone,
          payerAddress,
          customerName: mockRecord.customerName,
          customerNo: barcodeNumber,
          meterNo: null,
          unit: 0,
          horsepower: 0,
          billAmount,
          serviceFee,
          totalAmount: totalPayableAmount,
          status: 'SUCCESS',
          transactionRef,
        },
      });
    } catch (e) {
      console.log('BillerTransaction create failed (non-critical):', (e as Error).message);
    }

    return successResponse({
      billerCode: mockRecord.biller.code,
      billerName: mockRecord.biller.name,
      customerNo: mockRecord.customerNo,
      barcodeNumber: mockRecord.customerNo,
      meterNo: mockRecord.meterNo,
      customerName: mockRecord.customerName,
      payerPhone,
      payerAddress,
      address: mockRecord.address,
      billCode: mockRecord.billCode,
      dueDate: mockRecord.dueDate.toISOString(),
      unitsUsed: mockRecord.unitsUsed,
      unit: mockRecord.unitsUsed,
      horsepower: Number(mockRecord.horsepower),
      powerFee: Number(mockRecord.powerFee),
      billAmount,
      serviceFee,
      totalPayableAmount,
      amount: totalPayableAmount,
      status: 'SUCCESS',
      transactionRef,
      paidAt: new Date().toISOString(),
    });
  });
};

export default billerRoutes;
