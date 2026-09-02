import 'dotenv/config';

import { isAbsolute, resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';

const prisma = new PrismaClient();

const DEFAULT_FILE = 'mesc_transactionsdata_list.xlsx';
const BILLER_CODE = 'MESC-MANDALAY';

type ExcelCell = string | number | boolean | Date | null | undefined;
type ExcelRow = ExcelCell[];

type MeterWhitelistRow = {
  rowNumber: number;
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
  discount: string;
  lastBalance: string;
  paidAmount: string;
  arrears: string;
  reconnectionFee: string;
  deposit: string;
  totalAmount: string;
};

const toText = (value: ExcelCell): string | null => {
  if (value === null || value === undefined) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.trim() || null;
};

const requiredText = (value: ExcelCell, field: string, rowNumber: number): string => {
  const text = toText(value);
  if (!text) throw new Error(`Missing ${field} at Excel row ${rowNumber}`);
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
  if (!text) return 0;
  const parsed = Number(text);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid ${field} at Excel row ${rowNumber}: ${text}`);
  }
  return parsed;
};

const parseDate = (value: ExcelCell, field: string, rowNumber: number): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
    }
  }

  const text = requiredText(value, field, rowNumber);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field} at Excel row ${rowNumber}: ${text}`);
  }
  return date;
};

const findHeaderRow = (rows: ExcelRow[]): number => {
  const index = rows.findIndex((row) => {
    const values = new Set(row.map(toText).filter((value): value is string => Boolean(value)));
    const hasCustomerNo = values.has('မီတာသုံးသူအမှတ်') || values.has('မီတာာသုံးသူအမှတ်');
    return hasCustomerNo && ['အမည်', 'Due Date', 'ဝန်ဆောင်ခ'].every((header) => values.has(header));
  });

  if (index < 0) throw new Error('Could not find the expected MESC Excel header row');
  return index;
};

const parseWorkbook = (filePath: string): MeterWhitelistRow[] => {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error(`No worksheet found in ${filePath}`);

  const rows = XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });
  const headerIndex = findHeaderRow(rows);
  const header = rows[headerIndex];
  const columns = new Map<string, number>();
  header.forEach((value, index) => {
    const name = toText(value);
    if (name) columns.set(name, index);
  });

  const column = (name: string): number => {
    const index = columns.get(name);
    if (index === undefined) throw new Error(`Missing required Excel column: ${name}`);
    return index;
  };

  const columnAny = (...names: string[]): number => {
    for (const name of names) {
      const index = columns.get(name);
      if (index !== undefined) return index;
    }
    throw new Error(`Missing required Excel column; expected one of: ${names.join(', ')}`);
  };

  const indexes = {
    ledgerNo: columnAny('အမှတ်', 'လယ်ဂျာအမှတ်'),
    customerNo: columnAny('မီတာသုံးသူအမှတ်', 'မီတာာသုံးသူအမှတ်'),
    meterNo: column('မီတာအမှတ်'),
    customerName: column('အမည်'),
    address: column('လိပ်စာ'),
    billCode: column('Bill Code'),
    dueDate: column('Due Date'),
    unitsUsed: column('သုံးစွဲယူနစ်'),
    powerFee: column('ဓာတ်အားခ'),
    serviceFee: column('ဝန်ဆောင်ခ'),
    horsepower: column('မြင်းကောင်ရေခ'),
    discount: column('Discount'),
    lastBalance: column('Last Balance'),
    paidAmount: column('ပေါင်း'),
    arrears: column('ကြွေးကျန်ငွေ'),
    reconnectionFee: column('မီးဆက်ခ'),
    deposit: column('Deposit'),
    totalAmount: columns.get('Total') ?? column('စုစုပေါင်း'),
  };

  const records = rows.slice(headerIndex + 1).flatMap((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const customerNo = toText(row[indexes.customerNo]);
    if (!customerNo) return [];

    return [{
      rowNumber,
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
      discount: parseDecimal(row[indexes.discount], 'discount', rowNumber),
      lastBalance: parseDecimal(row[indexes.lastBalance], 'lastBalance', rowNumber),
      paidAmount: parseDecimal(row[indexes.paidAmount], 'paidAmount', rowNumber),
      arrears: parseDecimal(row[indexes.arrears], 'arrears', rowNumber),
      reconnectionFee: parseDecimal(row[indexes.reconnectionFee], 'reconnectionFee', rowNumber),
      deposit: parseDecimal(row[indexes.deposit], 'deposit', rowNumber),
      totalAmount: parseDecimal(row[indexes.totalAmount], 'totalAmount', rowNumber),
    }];
  });

  const duplicates = records.filter(
    (record, index) => records.findIndex(({ customerNo }) => customerNo === record.customerNo) !== index,
  );
  if (duplicates.length > 0) {
    throw new Error(`Duplicate customerNo in Excel: ${[...new Set(duplicates.map((row) => row.customerNo))].join(', ')}`);
  }

  return records;
};

const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const seed = async (): Promise<void> => {
  const requestedPath = argumentValue('--file') ?? DEFAULT_FILE;
  const filePath = isAbsolute(requestedPath) ? requestedPath : resolve(process.cwd(), requestedPath);
  const apply = process.argv.includes('--apply');
  const updateExisting = process.argv.includes('--update-existing');
  const reassignBiller = process.argv.includes('--reassign-biller');
  const records = parseWorkbook(filePath);

  const biller = await prisma.billerProvider.findUnique({ where: { code: BILLER_CODE } });
  if (!biller) throw new Error(`Biller provider not found: ${BILLER_CODE}`);

  const existing = await prisma.meterWhitelist.findMany({
    where: { customerNo: { in: records.map(({ customerNo }) => customerNo) } },
    select: { customerNo: true, billerId: true },
  });
  const existingNumbers = new Set(existing.map(({ customerNo }) => customerNo));
  const newRecords = records.filter(({ customerNo }) => !existingNumbers.has(customerNo));
  const mismatchedBillerRecords = existing.filter(({ billerId }) => billerId !== biller.id);

  console.log(`File: ${filePath}`);
  console.log(`Valid rows: ${records.length}`);
  console.log(`New records: ${newRecords.length}`);
  console.log(`Existing records skipped: ${records.length - newRecords.length}`);
  console.log(`Existing records assigned to another biller: ${mismatchedBillerRecords.length}`);

  if (!apply) {
    console.log('Database changes: 0 (dry run). Add --apply to insert new records.');
    return;
  }

  const insertData = newRecords.map(({ rowNumber: _rowNumber, ...record }) => ({
    ...record,
    billerId: biller.id,
    isPaid: false,
  }));
  const existingRecords = records.filter(({ customerNo }) => existingNumbers.has(customerNo));
  const result = await prisma.$transaction(async (tx) => {
    const inserted = await tx.meterWhitelist.createMany({ data: insertData, skipDuplicates: true });
    let updated = 0;
    if (updateExisting) {
      for (const { rowNumber: _rowNumber, customerNo, ...record } of existingRecords) {
        const change = await tx.meterWhitelist.updateMany({
          where: reassignBiller ? { customerNo } : { customerNo, billerId: biller.id },
          data: reassignBiller ? { ...record, billerId: biller.id } : record,
        });
        updated += change.count;
      }
    }
    return { inserted: inserted.count, updated };
  });

  console.log(`Inserted: ${result.inserted}`);
  console.log(`Existing records updated: ${result.updated}`);
  console.log(`Existing records unchanged: ${existingRecords.length - result.updated}`);
};

try {
  await seed();
} finally {
  await prisma.$disconnect();
}
