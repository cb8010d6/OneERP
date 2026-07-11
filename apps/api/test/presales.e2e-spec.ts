import { PresalesService } from '../src/presales/presales.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Presales customer requirement lifecycle (database e2e)', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const prisma = new PrismaService();
  const service = new PresalesService(prisma);

  let companyId: string;
  let userId: string;
  let partnerId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const company = await prisma.company.create({
      data: { name: `售前 E2E 公司 ${suffix}` },
    });
    companyId = company.id;

    const user = await prisma.user.create({
      data: {
        email: `presales-e2e-${suffix}@example.com`,
        name: '售前 E2E 用户',
        passwordHash: 'e2e-only-not-a-login-secret',
      },
    });
    userId = user.id;

    const partner = await prisma.partner.create({
      data: {
        companyId,
        name: `售前 E2E 客户 ${suffix}`,
        code: `E2E-${suffix}`,
        type: 'CUSTOMER',
      },
    });
    partnerId = partner.id;
  });

  afterAll(async () => {
    if (companyId) {
      await prisma.auditLog.deleteMany({ where: { companyId } });
      await prisma.requirementActivity.deleteMany({ where: { companyId } });
      await prisma.customerRequirement.deleteMany({ where: { companyId } });
      await prisma.documentSequence.deleteMany({ where: { companyId } });
    }
    if (partnerId) {
      await prisma.partner.deleteMany({ where: { id: partnerId } });
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (companyId) {
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    await prisma.$disconnect();
  });

  it('creates, lists, follows up, and closes a requirement', async () => {
    const created = await service.createRequirement(companyId, userId, {
      partnerId,
      sourceChannel: 'E2E 客户来电',
      summary: 'E2E 验证客户需求生命周期',
      nextFollowUpAt: '2026-07-12T09:00:00+08:00',
    });
    expect(created.requirementNo).toMatch(/^REQ-\d{4}-000001$/);
    expect(created.status).toBe('DRAFT');

    const listed = await service.listRequirements(companyId, {
      page: 1,
      limit: 20,
      search: created.requirementNo,
    });
    expect(listed.data.map((item) => item.id)).toContain(created.id);

    const followed = await service.addFollowUp(companyId, userId, created.id, {
      content: 'E2E 跟进记录',
      nextFollowUpAt: '2026-07-13T09:00:00+08:00',
    });
    expect(followed.requirement.status).toBe('FOLLOWING');
    expect(followed.activity.content).toBe('E2E 跟进记录');

    const closed = await service.closeRequirement(
      companyId,
      userId,
      created.id,
      { status: 'LOST', reason: 'E2E 预算取消' },
    );
    expect(closed.status).toBe('LOST');
    expect(closed.closeReason).toBe('E2E 预算取消');
  });
});
