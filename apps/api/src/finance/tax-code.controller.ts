import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TaxNature, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CreateTaxCodeDto, UpdateTaxCodeDto } from './dto/tax-code.dto';
import { BadRequestException } from '@nestjs/common';

@ApiTags('税码管理 (TaxCode)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('finance/tax-codes')
export class TaxCodeController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @ApiOperation({ summary: '创建税码' })
  async create(
    @CurrentCompany() companyId: string,
    @Body() dto: CreateTaxCodeDto,
  ) {
    const existing = await this.prisma.taxCode.findFirst({
      where: { companyId, code: dto.code },
    });
    if (existing) {
      throw new BadRequestException(`税码编码 ${dto.code} 已存在`);
    }

    if (dto.isDefault) {
      await this.prisma.taxCode.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.taxCode.create({
      data: {
        code: dto.code,
        name: dto.name,
        rate: dto.rate,
        isTaxInclusive: dto.isTaxInclusive ?? true,
        isDefault: dto.isDefault ?? false,
        active: true,
        taxNature: dto.taxNature ?? TaxNature.OUTPUT,
        accountId: dto.accountId ?? null,
        outputAccountId: dto.outputAccountId ?? null,
        inputAccountId: dto.inputAccountId ?? null,
        companyId,
      },
    });
  }

  @Get()
  @ApiOperation({ summary: '获取税码列表' })
  async list(
    @CurrentCompany() companyId: string,
    @Query('active') active?: string,
  ) {
    const where: Prisma.TaxCodeWhereInput = { companyId };
    if (active !== undefined) {
      where.active = active === 'true';
    }
    return this.prisma.taxCode.findMany({
      where,
      include: {
        account: { select: { id: true, code: true, name: true } },
        outputAccount: { select: { id: true, code: true, name: true } },
        inputAccount: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '获取税码详情' })
  async getById(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
  ) {
    const taxCode = await this.prisma.taxCode.findFirst({
      where: { id, companyId },
      include: {
        account: true,
        outputAccount: true,
        inputAccount: true,
      },
    });
    if (!taxCode) throw new BadRequestException('税码不存在');
    return taxCode;
  }

  @Put(':id')
  @ApiOperation({ summary: '更新税码' })
  async update(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaxCodeDto,
  ) {
    const existing = await this.prisma.taxCode.findFirst({
      where: { id, companyId },
    });
    if (!existing) throw new BadRequestException('税码不存在');

    if (dto.isDefault && !existing.isDefault) {
      await this.prisma.taxCode.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const updateData: Prisma.TaxCodeUpdateInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.rate !== undefined) updateData.rate = dto.rate;
    if (dto.isTaxInclusive !== undefined)
      updateData.isTaxInclusive = dto.isTaxInclusive;
    if (dto.isDefault !== undefined) updateData.isDefault = dto.isDefault;
    if (dto.active !== undefined) updateData.active = dto.active;
    if (dto.taxNature !== undefined) updateData.taxNature = dto.taxNature;
    if (dto.accountId !== undefined)
      updateData.account = dto.accountId
        ? { connect: { id: dto.accountId } }
        : { disconnect: true };
    if (dto.outputAccountId !== undefined)
      updateData.outputAccount = dto.outputAccountId
        ? { connect: { id: dto.outputAccountId } }
        : { disconnect: true };
    if (dto.inputAccountId !== undefined)
      updateData.inputAccount = dto.inputAccountId
        ? { connect: { id: dto.inputAccountId } }
        : { disconnect: true };

    return this.prisma.taxCode.update({
      where: { id },
      data: updateData,
    });
  }
}
