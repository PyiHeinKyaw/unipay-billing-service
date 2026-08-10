import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';

const prisma = new PrismaClient();

const HEADER_ROW_INDEX = 2;
const DEFAULT_BILLER_CODE = 'ESE-TAUNGGYI';

const BILLER_PROVIDERS = [
  { code: 'ESE-AYEYARWADY', name: '(ESE)- Ayeyarwady Division Electricity Bill' },
  { code: 'ESE-BAGO', name: '(ESE)- Bago Division Electricity Bill' },
  { code: 'ESE-KAYA', name: '(ESE)- Kaya State Electricity Bill' },
  { code: 'ESE-KAYIN', name: '(ESE)- Kayin State Electricity Bill' },
  { code: 'ESE-MAGWAY', name: '(ESE)- Magway Division Electricity Bill' },
  { code: 'ESE-MON', name: '(ESE)- Mon State Electricity Bill' },
  { code: 'ESE-NAYPYITAW', name: '(ESE)- Nay Pyi Taw Electricity Bill' },
  { code: 'ESE-SAGAING', name: '(ESE)- Sagaing Division Electricity Bill' },
  { code: 'ESE-SHAN', name: '(ESE)- Shan State Electricity Bill' },
  { code: 'MESC-MANDALAY', name: '(MESC)- Mandalay Electricity Bill' },
  { code: 'ESE-TAUNGGYI', name: '(ESE)- Taunggyi Electricity Bill' },
  { code: 'ESE-AYETHARYAR', name: '(ESE)- Aye Thar Yar Electricity Bill' },
  { code: 'YESC-YANGON', name: '(YESC)- Yangon Electricity Bill' },
] as const;

type ExcelCell = string | number | boolean | Date | null | undefined;
type ExcelRow = ExcelCell[];

type MeterWhitelistSeed = {
  billerId: string;
  ledgerNo: string | null;
  customerNo: string;
  meterNo: string | null;
  customerName: string;
  address: string | null;
  billCode: string | null;
  dueDate: Date;
  unitsUsed: number;
  horsepower: string;
  powerFee: string;
  serviceFee: string;
  totalAmount: string;
  isPaid: boolean;
};

const toText = (value: ExcelCell): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.trim() || null;
};

const requiredText = (value: ExcelCell, field: string, rowNumber: number): string => {
  const text = toText(value);
  if (!text) {
    throw new Error(`Missing ${field} at Excel row ${rowNumber}`);
  }

  return text;
};

const parseDecimal = (value: ExcelCell, field: string, rowNumber: number): string => {
  const text = requiredText(value, field, rowNumber).replaceAll(',', '');
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
    throw new Error(`Invalid ${field} at Excel row ${rowNumber}: ${text}`);
  }

  return text;
};

const parseInteger = (value: ExcelCell, field: string, rowNumber: number): number => {
  const text = toText(value)?.replaceAll(',', '');
  if (!text) {
    return 0;
  }

  const number = Number(text);
  if (!Number.isInteger(number)) {
    throw new Error(`Invalid ${field} at Excel row ${rowNumber}: ${text}`);
  }

  return number;
};

const parseDate = (value: ExcelCell, field: string, rowNumber: number): Date => {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      return value;
    }
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
    }
  }

  const text = requiredText(value, field, rowNumber);
  const dateParts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  const parsedDate = dateParts
    ? new Date(
        Date.UTC(
          Number(dateParts[3]) < 100 ? Number(dateParts[3]) + 2000 : Number(dateParts[3]),
          Number(dateParts[1]) - 1,
          Number(dateParts[2]),
        ),
      )
    : new Date(text);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`Invalid ${field} at Excel row ${rowNumber}: ${text}`);
  }

  return parsedDate;
};

const parseWorkbook = (filePath: string, billerId: string): MeterWhitelistSeed[] => {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(`No worksheet found in ${filePath}`);
  }

  const rows = XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[sheetName], {
    header: 1,
    range: HEADER_ROW_INDEX,
    raw: true,
    defval: null,
  });
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) {
    throw new Error(`No header row found in ${filePath}`);
  }

  const columns = new Map<string, number>();
  headerRow.forEach((header, index) => {
    const name = toText(header);
    if (name) {
      columns.set(name, index);
    }
  });

  const column = (name: string): number => {
    const index = columns.get(name);
    if (index === undefined) {
      throw new Error(`Missing required Excel column: ${name}`);
    }

    return index;
  };

  const totalColumn = columns.get('Total') ?? column('စုစုပေါင်း');
  const indexes = {
    ledgerNo: column('လယ်ဂျာအမှတ်'),
    customerNo: column('မီတာာသုံးသူအမှတ်'),
    meterNo: column('မီတာအမှတ်'),
    customerName: column('အမည်'),
    address: column('လိပ်စာ'),
    billCode: column('Bill Code'),
    dueDate: column('Due Date'),
    unitsUsed: column('သုံးစွဲယူနစ်'),
    horsepower: column('မြင်းကောင်ရေခ'),
    powerFee: column('ဓာတ်အားခ'),
    serviceFee: column('ဝန်ဆောင်ခ'),
    totalAmount: totalColumn,
  };

  return dataRows.flatMap((row, index) => {
    const rowNumber = HEADER_ROW_INDEX + index + 2;
    const customerNo = toText(row[indexes.customerNo]);
    if (!customerNo) {
      return [];
    }

    return [
      {
        billerId,
        ledgerNo: toText(row[indexes.ledgerNo]),
        customerNo,
        meterNo: toText(row[indexes.meterNo]),
        customerName: requiredText(row[indexes.customerName], 'customerName', rowNumber),
        address: toText(row[indexes.address]),
        billCode: toText(row[indexes.billCode]),
        dueDate: parseDate(row[indexes.dueDate], 'dueDate', rowNumber),
        unitsUsed: parseInteger(row[indexes.unitsUsed], 'unitsUsed', rowNumber),
        horsepower: parseDecimal(row[indexes.horsepower], 'horsepower', rowNumber),
        powerFee: parseDecimal(row[indexes.powerFee], 'powerFee', rowNumber),
        serviceFee: parseDecimal(row[indexes.serviceFee], 'serviceFee', rowNumber),
        totalAmount: parseDecimal(row[indexes.totalAmount], 'totalAmount', rowNumber),
        isPaid: false,
      },
    ];
  });
};

const seed = async (): Promise<void> => {
  const billers = new Map<string, string>();
  for (const provider of BILLER_PROVIDERS) {
    const biller = await prisma.billerProvider.upsert({
      where: { code: provider.code },
      create: provider,
      update: {
        name: provider.name,
        category: 'ELECTRICITY',
        isActive: true,
      },
    });
    billers.set(biller.code, biller.id);
  }

  const defaultMerchantId = process.env.DEFAULT_MERCHANT_ID?.trim();
  if (defaultMerchantId) {
    await prisma.merchantAccount.upsert({
      where: { merchantId: defaultMerchantId },
      create: {
        merchantId: defaultMerchantId,
        balance: process.env.DEFAULT_MERCHANT_BALANCE ?? '0',
      },
      update: {},
    });
  }

  const defaultBillerCode = process.env.DEFAULT_BILLER_CODE ?? DEFAULT_BILLER_CODE;
  const defaultBillerId = billers.get(defaultBillerCode);
  if (!defaultBillerId) {
    throw new Error(`Unknown DEFAULT_BILLER_CODE: ${defaultBillerCode}`);
  }

  const workbookPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'Meter Bill List.XLSX');
  const records = parseWorkbook(workbookPath, defaultBillerId);

  await prisma.$transaction(
    records.map(({ customerNo, ...record }) =>
      prisma.meterWhitelist.upsert({
        where: { customerNo },
        create: { customerNo, ...record },
        update: record,
      }),
    ),
  );

  console.log(`Seeded ${billers.size} biller providers and ${records.length} meter whitelist records.`);
};

try {
  await seed();
} finally {
  await prisma.$disconnect();
}
