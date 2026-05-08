import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxService } from './tax.service';

/**
 * 税码服务全局模块 —— 任何需要计算税率的模块只需注入 TaxService。
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
