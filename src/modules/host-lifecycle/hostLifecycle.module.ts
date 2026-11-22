import { Module } from '@nestjs/common';
import { HostPersistenceService } from './persistence.service';
import { HostLifecycleService } from './lifecycle.service';
@Module({
  providers: [
    { provide: HostPersistenceService, useFactory: () => new HostPersistenceService() },
    {
      provide: HostLifecycleService,
      inject: [HostPersistenceService],
      useFactory: (persistence: HostPersistenceService) => new HostLifecycleService(persistence),
    },
  ],
  exports: [HostPersistenceService, HostLifecycleService],
})
export class HostLifecycleModule {}
