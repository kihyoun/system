import { Module } from '@nestjs/common';
import { ResourceCollectorService } from './collector.service';
import { ResourceBenchmarkService } from './benchmark.service';
import { WindowsResourceService } from './windows.service';
@Module({
  providers: [
    { provide: ResourceCollectorService, useFactory: () => new ResourceCollectorService() },
    {
      provide: ResourceBenchmarkService,
      inject: [ResourceCollectorService],
      useFactory: (collector: ResourceCollectorService) =>
        new ResourceBenchmarkService(undefined, collector),
    },
    { provide: WindowsResourceService, useFactory: () => new WindowsResourceService() },
  ],
  exports: [ResourceCollectorService, ResourceBenchmarkService, WindowsResourceService],
})
export class ResourcesModule {}
