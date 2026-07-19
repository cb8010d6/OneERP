import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [MetricsService],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
