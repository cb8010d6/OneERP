import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { Permission } from '../core/permissions/permissions';
import type { JwtUserPayload } from '../core/http/request.types';
import { PurchaseService } from './purchase.service';
import {
  CreatePurchaseInvoiceDto,
  CreatePurchaseOrderDto,
  CreateSupplierCreditNoteDto,
  CreateSupplierPaymentDto,
  ReceivePurchaseOrderDto,
} from './dto/purchase.dto';

@ApiTags('采购管理 (Purchase)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('purchase')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post('orders')
  @RequirePermissions(Permission.PurchaseCreate)
  @ApiOperation({ summary: '创建采购单' })
  async createPurchaseOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.purchaseService.createPurchaseOrder(companyId, user.id, dto);
  }

  @Get('orders')
  @RequirePermissions(Permission.PurchaseRead)
  @ApiOperation({ summary: '获取采购单列表' })
  async listPurchaseOrders(@CurrentCompany() companyId: string) {
    return this.purchaseService.listPurchaseOrders(companyId);
  }

  @Get('orders/:id')
  @RequirePermissions(Permission.PurchaseRead)
  @ApiOperation({ summary: '获取采购单详情' })
  async getPurchaseOrder(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
  ) {
    return this.purchaseService.getPurchaseOrder(companyId, id);
  }

  @Get('orders/:id/match')
  @RequirePermissions(Permission.PurchaseRead)
  @ApiOperation({ summary: '获取采购三单匹配摘要' })
  async getPurchaseOrderMatch(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
  ) {
    return this.purchaseService.getPurchaseOrderMatch(companyId, id);
  }

  @Post('orders/:id/receive')
  @RequirePermissions(Permission.PurchaseReceive)
  @ApiOperation({ summary: '采购收货并触发库存入库' })
  async receivePurchaseOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
    return this.purchaseService.receivePurchaseOrder(
      companyId,
      user.id,
      id,
      dto,
    );
  }

  @Post('orders/:id/invoice')
  @RequirePermissions(Permission.PurchaseInvoice)
  @ApiOperation({ summary: '按采购单生成应付发票' })
  async createPurchaseInvoice(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
    @Body() dto: CreatePurchaseInvoiceDto,
  ) {
    return this.purchaseService.createPurchaseInvoice(companyId, id, dto);
  }

  @Post('invoices/bulk-post')
  @RequirePermissions(Permission.PurchaseInvoice)
  @ApiOperation({ summary: '批量过账应付发票并返回逐张处理结果' })
  async bulkPostPurchaseInvoices(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() body: { purchaseInvoiceIds?: string[] },
  ) {
    return this.purchaseService.bulkPostPurchaseInvoices(
      companyId,
      body.purchaseInvoiceIds ?? [],
      user.id,
    );
  }

  @Post('invoices/:id/post')
  @RequirePermissions(Permission.PurchaseInvoice)
  @ApiOperation({ summary: '过账应付发票并触发总账凭证' })
  async postPurchaseInvoice(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') purchaseInvoiceId: string,
  ) {
    return this.purchaseService.postPurchaseInvoice(
      companyId,
      purchaseInvoiceId,
      user.id,
    );
  }

  @Get('supplier-credit-notes')
  @RequirePermissions(Permission.PurchaseRead)
  @ApiOperation({ summary: '获取供应商贷项/扣款单列表' })
  async listSupplierCreditNotes(@CurrentCompany() companyId: string) {
    return this.purchaseService.listSupplierCreditNotes(companyId);
  }

  @Get('supplier-payments')
  @RequirePermissions(Permission.PurchaseRead)
  @ApiOperation({ summary: '获取供应商付款列表' })
  async listSupplierPayments(@CurrentCompany() companyId: string) {
    return this.purchaseService.listSupplierPayments(companyId);
  }

  @Post('supplier-payments')
  @RequirePermissions(Permission.PurchaseInvoice)
  @ApiOperation({ summary: '创建供应商付款草稿并分配核销到应付发票' })
  async createSupplierPayment(
    @CurrentCompany() companyId: string,
    @Body() dto: CreateSupplierPaymentDto,
  ) {
    return this.purchaseService.createSupplierPayment(companyId, dto);
  }

  @Post('supplier-payments/:id/post')
  @RequirePermissions(Permission.PurchaseInvoice)
  @ApiOperation({ summary: '过账供应商付款并更新应付发票状态' })
  async postSupplierPayment(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') supplierPaymentId: string,
  ) {
    return this.purchaseService.postSupplierPayment(
      companyId,
      supplierPaymentId,
      user.id,
    );
  }

  @Post('invoices/:id/supplier-credit-notes')
  @RequirePermissions(Permission.PurchaseInvoice)
  @ApiOperation({ summary: '按应付发票创建供应商贷项/扣款单草稿' })
  async createSupplierCreditNote(
    @CurrentCompany() companyId: string,
    @Param('id') purchaseInvoiceId: string,
    @Body() dto: CreateSupplierCreditNoteDto,
  ) {
    return this.purchaseService.createSupplierCreditNote(
      companyId,
      purchaseInvoiceId,
      dto,
    );
  }

  @Post('supplier-credit-notes/:id/post')
  @RequirePermissions(Permission.PurchaseInvoice)
  @ApiOperation({ summary: '过账供应商贷项/扣款单并冲减应付发票' })
  async postSupplierCreditNote(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') supplierCreditNoteId: string,
  ) {
    return this.purchaseService.postSupplierCreditNote(
      companyId,
      supplierCreditNoteId,
      user.id,
    );
  }
}
