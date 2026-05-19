import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ROLE_TEMPLATES } from './src/core/permissions/permissions';

const prisma = new PrismaClient();

async function main() {
  const pass = await bcrypt.hash('admin', 10);
  
  // 1. 创建超级管理员
  const admin = await prisma.user.upsert({
    where: { email: 'admin@erp.com' },
    update: { passwordHash: pass },
    create: { email: 'admin@erp.com', name: '系统管理员', passwordHash: pass },
  });

  // 2. 创建角色
  const roles = new Map<string, { id: string }>();
  for (const template of ROLE_TEMPLATES) {
    const existing = await prisma.role.findFirst({
      where: { name: template.name },
    });
    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: { permissions: template.permissions },
        })
      : await prisma.role.create({
          data: { name: template.name, permissions: template.permissions },
        });
    roles.set(role.name, role);
  }
  const role = roles.get('SuperAdmin');

  // 3. 创建您的两个主要公司
  const comp1 = await prisma.company.create({
      data: { name: '精工制造一厂(总部)' }
  }).catch(async () => (await prisma.company.findMany())[0]);

  const comp2 = await prisma.company.create({
      data: { name: '精密器件二厂(分部)' }
  }).catch(async () => (await prisma.company.findMany())[1]);

  // 4. 将管理员和两家公司绑定权限，展示同一账号多公司的热切换功能
  if (comp1 && role) {
    await prisma.userCompanyRole.upsert({
        where: { userId_companyId: { userId: admin.id, companyId: comp1.id } },
        update: {}, create: { userId: admin.id, companyId: comp1.id, roleId: role.id }
    });
  }
  if (comp2 && role) {
    await prisma.userCompanyRole.upsert({
        where: { userId_companyId: { userId: admin.id, companyId: comp2.id } },
        update: {}, create: { userId: admin.id, companyId: comp2.id, roleId: role.id }
    });
  }

  // 5. 为一厂初始化主数据与库存
  if (comp1) {
    const mainWh = await prisma.warehouse
      .create({
        data: { name: '原料主仓库', type: 'MATERIAL', companyId: comp1.id },
      })
      .catch(() => prisma.warehouse.findFirst({ where: { companyId: comp1.id } }));

    const finishedWh = await prisma.warehouse
      .create({
        data: { name: '成品仓', type: 'FINISHED', companyId: comp1.id },
      })
      .catch(() =>
        prisma.warehouse.findFirst({
          where: { companyId: comp1.id, type: 'FINISHED' },
        }),
      );

    const mat = await prisma.material.upsert({
      where: { sku: 'MAT-SUS304-001' },
      update: { companyId: comp1.id },
      create: {
        sku: 'MAT-SUS304-001',
        name: 'SUS304不锈钢板',
        category: '板材',
        unit: 'kg',
        companyId: comp1.id,
      },
    });

    const partner = await prisma.partner.upsert({
      where: { companyId_code: { companyId: comp1.id, code: 'P-CUST-001' } },
      update: {},
      create: {
        companyId: comp1.id,
        code: 'P-CUST-001',
        name: '蓝海科技有限公司',
        type: 'BOTH',
        contact: '张经理',
        phone: '13800001111',
      },
    });

    const orderWorkflow = await prisma.workflow.upsert({
      where: { companyId_modelName: { companyId: comp1.id, modelName: 'order' } },
      update: { name: '销售订单流程', statusField: 'status', isActive: true },
      create: {
        companyId: comp1.id,
        modelName: 'order',
        name: '销售订单流程',
        statusField: 'status',
        isActive: true,
      },
    });

    const stateValues = [
      { value: 'DRAFT', label: '草稿', sort: 10, isInitial: true, isFinal: false },
      { value: 'PENDING_APPROVAL', label: '待审批', sort: 20, isInitial: false, isFinal: false },
      { value: 'PENDING', label: '待处理', sort: 30, isInitial: false, isFinal: false },
      { value: 'IN_PRODUCTION', label: '生产中', sort: 40, isInitial: false, isFinal: false },
      { value: 'PARTIAL_SHIPPED', label: '部分发货', sort: 50, isInitial: false, isFinal: false },
      { value: 'SHIPPED', label: '已发货', sort: 60, isInitial: false, isFinal: false },
      { value: 'COMPLETED', label: '已完成', sort: 70, isInitial: false, isFinal: true },
      { value: 'CANCELLED', label: '已取消', sort: 99, isInitial: false, isFinal: true },
    ] as const;

    for (const state of stateValues) {
      await prisma.workflowState.upsert({
        where: {
          workflowId_value: { workflowId: orderWorkflow.id, value: state.value },
        },
        update: {
          label: state.label,
          sort: state.sort,
          isInitial: state.isInitial,
          isFinal: state.isFinal,
        },
        create: {
          workflowId: orderWorkflow.id,
          value: state.value,
          label: state.label,
          sort: state.sort,
          isInitial: state.isInitial,
          isFinal: state.isFinal,
        },
      });
    }

    const workflowStates = await prisma.workflowState.findMany({
      where: { workflowId: orderWorkflow.id },
    });
    const stateMap = new Map(workflowStates.map((s) => [s.value, s.id]));

    const transitions = [
      { from: 'DRAFT', to: 'PENDING', action: 'submit', label: '提交订单' },
      { from: 'DRAFT', to: 'PENDING_APPROVAL', action: 'submit_for_approval', label: '提交审批' },
      { from: 'PENDING_APPROVAL', to: 'PENDING', action: 'approve', label: '审批通过' },
      { from: 'PENDING', to: 'IN_PRODUCTION', action: 'start_production', label: '开始生产' },
      { from: 'IN_PRODUCTION', to: 'PARTIAL_SHIPPED', action: 'ship', label: '发货' },
      { from: 'PARTIAL_SHIPPED', to: 'SHIPPED', action: 'ship', label: '完成发货' },
      { from: 'SHIPPED', to: 'COMPLETED', action: 'complete', label: '完成' },
      { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', label: '取消' },
      { from: 'PENDING_APPROVAL', to: 'CANCELLED', action: 'cancel', label: '取消' },
      { from: 'PENDING', to: 'CANCELLED', action: 'cancel', label: '取消' },
      { from: 'IN_PRODUCTION', to: 'CANCELLED', action: 'cancel', label: '取消' },
      { from: 'PARTIAL_SHIPPED', to: 'CANCELLED', action: 'cancel', label: '取消' },
      { from: 'SHIPPED', to: 'CANCELLED', action: 'cancel', label: '取消' },
    ] as const;

    for (const item of transitions) {
      const fromStateId = stateMap.get(item.from);
      const toStateId = stateMap.get(item.to);
      if (!fromStateId || !toStateId) continue;

      await prisma.workflowTransition.upsert({
        where: {
          workflowId_fromStateId_action: {
            workflowId: orderWorkflow.id,
            fromStateId,
            action: item.action,
          },
        },
        update: {
          toStateId,
          label: item.label,
        },
        create: {
          workflowId: orderWorkflow.id,
          fromStateId,
          toStateId,
          action: item.action,
          label: item.label,
        },
      });
    }

    const category = await prisma.productCategory.upsert({
      where: { companyId_code: { companyId: comp1.id, code: 'CAT-FINISHED' } },
      update: {},
      create: {
        companyId: comp1.id,
        code: 'CAT-FINISHED',
        name: '成品',
      },
    });

    const product = await prisma.product.upsert({
      where: { companyId_sku: { companyId: comp1.id, sku: 'PROD-CAB-001' } },
      update: { materialId: mat.id, categoryId: category.id, listPrice: 800 },
      create: {
        companyId: comp1.id,
        sku: 'PROD-CAB-001',
        name: '机柜门板组件',
        type: 'STOCKABLE',
        uom: 'pcs',
        materialId: mat.id,
        categoryId: category.id,
        listPrice: 800,
      },
    });

    await prisma.bom.upsert({
      where: { companyId_code: { companyId: comp1.id, code: 'BOM-CAB-001-V1' } },
      update: {},
      create: {
        companyId: comp1.id,
        code: 'BOM-CAB-001-V1',
        productId: product.id,
        version: 'v1',
        lines: {
          create: [
            {
              materialId: mat.id,
              quantity: 12,
              scrapRate: 0.03,
            },
          ],
        },
      },
    });

    if (mainWh && finishedWh) {
      const mainStockLocation = await prisma.stockLocation.upsert({
        where: {
          companyId_code: {
            companyId: comp1.id,
            code: 'LOC-MAIN-STOCK',
          },
        },
        update: { warehouseId: mainWh.id, usage: 'INTERNAL' },
        create: {
          companyId: comp1.id,
          warehouseId: mainWh.id,
          name: '原料仓-主货位',
          code: 'LOC-MAIN-STOCK',
          usage: 'INTERNAL',
        },
      });

      const finishedStockLocation = await prisma.stockLocation.upsert({
        where: {
          companyId_code: {
            companyId: comp1.id,
            code: 'LOC-FINISHED-IN',
          },
        },
        update: { warehouseId: finishedWh.id, usage: 'INTERNAL' },
        create: {
          companyId: comp1.id,
          warehouseId: finishedWh.id,
          name: '成品仓-待检货位',
          code: 'LOC-FINISHED-IN',
          usage: 'INTERNAL',
        },
      });

      await prisma.stockLocation.upsert({
        where: {
          companyId_code: {
            companyId: comp1.id,
            code: 'LOC-VIRTUAL-SCRAP',
          },
        },
        update: { usage: 'VIRTUAL', warehouseId: null },
        create: {
          companyId: comp1.id,
          warehouseId: null,
          name: '虚拟库位-报废',
          code: 'LOC-VIRTUAL-SCRAP',
          usage: 'VIRTUAL',
        },
      });

      const stock = await prisma.stockQuant
        .findFirst({
          where: {
            locationId: mainStockLocation.id,
            materialId: mat.id,
            batchNo: 'B-20260323',
          },
        })
        .catch(() => null);

      if (!stock) {
        await prisma.stockQuant.create({
          data: {
            locationId: mainStockLocation.id,
            materialId: mat.id,
            batchNo: 'B-20260323',
            quantity: 1500.5,
          },
        });
      }

      await prisma.inventoryTransaction.create({
        data: {
          type: 'TRANSFER',
          materialId: mat.id,
          sourceLocationId: mainStockLocation.id,
          destLocationId: finishedStockLocation.id,
          quantity: 50,
          batchNo: 'B-20260323',
          companyId: comp1.id,
          operatorId: admin.id,
          referenceNo: 'SEED-MOVE-001',
          note: `初始化流转，伙伴：${partner.name}`,
        },
      }).catch(() => null);
    }
  }

  console.log('✅ 阶段二基础数据已植入：多公司、伙伴、产品/BOM、复式库存。');
}

main().catch(console.error).finally(()=>prisma.$disconnect());
