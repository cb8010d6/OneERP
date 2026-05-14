import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ROLE_TEMPLATES } from '../src/core/permissions/permissions';

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for production initialization`);
  }
  return value;
}

async function upsertDefaultAccounts(companyId: string) {
  const accounts = [
    { code: '1001', name: 'Cash', type: 'ASSET' },
    { code: '1122', name: 'Accounts Receivable', type: 'ASSET' },
    { code: '1405', name: 'Inventory', type: 'ASSET' },
    { code: '2202', name: 'Accounts Payable', type: 'LIABILITY' },
    { code: '2221', name: 'VAT Payable', type: 'LIABILITY' },
    { code: '4001', name: 'Revenue', type: 'REVENUE' },
    { code: '5001', name: 'Cost of Goods Sold', type: 'EXPENSE' },
  ];

  for (const account of accounts) {
    await prisma.account.upsert({
      where: { companyId_code: { companyId, code: account.code } },
      update: { name: account.name, type: account.type, isActive: true },
      create: { ...account, companyId },
    });
  }

  await prisma.journal.upsert({
    where: { companyId_code: { companyId, code: 'GEN' } },
    update: { name: 'General Journal', type: 'GENERAL', isActive: true },
    create: { companyId, code: 'GEN', name: 'General Journal', type: 'GENERAL' },
  });

  await prisma.journal.upsert({
    where: { companyId_code: { companyId, code: 'PUR' } },
    update: { name: 'Purchase Journal', type: 'PURCHASE', isActive: true },
    create: {
      companyId,
      code: 'PUR',
      name: 'Purchase Journal',
      type: 'PURCHASE',
    },
  });

  await prisma.journal.upsert({
    where: { companyId_code: { companyId, code: 'SAL' } },
    update: { name: 'Sales Journal', type: 'SALES', isActive: true },
    create: { companyId, code: 'SAL', name: 'Sales Journal', type: 'SALES' },
  });
}

async function upsertDefaultTaxCode(companyId: string) {
  const taxAccount = await prisma.account.findUnique({
    where: { companyId_code: { companyId, code: '2221' } },
  });

  await prisma.taxCode.upsert({
    where: { companyId_code: { companyId, code: 'VAT13' } },
    update: {
      name: 'VAT 13%',
      rate: 0.13,
      isTaxInclusive: true,
      isDefault: true,
      active: true,
      accountId: taxAccount?.id,
    },
    create: {
      companyId,
      code: 'VAT13',
      name: 'VAT 13%',
      rate: 0.13,
      isTaxInclusive: true,
      isDefault: true,
      active: true,
      accountId: taxAccount?.id,
    },
  });
}

async function main() {
  const email = requireEnv('INIT_ADMIN_EMAIL');
  const password = requireEnv('INIT_ADMIN_PASSWORD');
  const companyName = process.env.INIT_COMPANY_NAME?.trim() || 'OneERP Company';

  if (password.length < 12) {
    throw new Error('INIT_ADMIN_PASSWORD must be at least 12 characters');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const company =
    (await prisma.company.findFirst({ where: { name: companyName } })) ??
    (await prisma.company.create({ data: { name: companyName } }));

  const roles = new Map<string, { id: string }>();
  for (const template of ROLE_TEMPLATES) {
    const existingRole = await prisma.role.findFirst({
      where: { name: template.name },
    });
    const role = existingRole
      ? await prisma.role.update({
          where: { id: existingRole.id },
          data: { permissions: template.permissions },
        })
      : await prisma.role.create({
          data: {
            name: template.name,
            permissions: template.permissions,
          },
        });
    roles.set(role.name, role);
  }

  const role = roles.get('SuperAdmin');
  if (!role) {
    throw new Error('SuperAdmin role initialization failed');
  }

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      name: process.env.INIT_ADMIN_NAME?.trim() || 'Administrator',
      isActive: true,
    },
    create: {
      email,
      passwordHash,
      name: process.env.INIT_ADMIN_NAME?.trim() || 'Administrator',
      isActive: true,
    },
  });

  await prisma.userCompanyRole.upsert({
    where: { userId_companyId: { userId: admin.id, companyId: company.id } },
    update: { roleId: role.id },
    create: { userId: admin.id, companyId: company.id, roleId: role.id },
  });

  await upsertDefaultAccounts(company.id);
  await upsertDefaultTaxCode(company.id);

  console.log(`Production initialization complete: ${email} / ${company.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
