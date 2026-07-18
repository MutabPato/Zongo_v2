import { Module } from '@nestjs/common';
import { DatabaseHealthService } from './lib/database-health.service';
import { PrismaService } from './lib/prisma.service';

@Module({
  providers: [PrismaService, DatabaseHealthService],
  exports: [PrismaService, DatabaseHealthService],
})
export class DbModule {}
