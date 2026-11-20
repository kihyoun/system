import { Module } from '@nestjs/common';
import { ControllerLeaseService } from './controller-lease.service';
export class ControllerLeaseModule {}
Module({
  providers: [{ provide: ControllerLeaseService, useFactory: () => new ControllerLeaseService() }],
  exports: [ControllerLeaseService],
})(ControllerLeaseModule);
