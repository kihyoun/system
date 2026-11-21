import { ImageCompatibilityService } from '../build/image-compatibility.service';
import { BootstrapperBuildService } from './bootstrapper-build.service';
import { CodeqlToolchainService } from './codeql-toolchain.service';
import { DocumentationCheckService } from './documentation.service';
import { CandidateRuntimeService } from './candidate-runtime.service';
import { ContainerCheckService } from './container-check.service';
import { CodeqlParentService } from './codeql-parent.service';
import { CodeqlService } from './codeql.service';
import { Module } from '@nestjs/common';
import { PlatformCheckService } from './platform.service';
@Module({
  providers: [
    ImageCompatibilityService,
    { provide: BootstrapperBuildService, useFactory: () => new BootstrapperBuildService() },
    { provide: CodeqlToolchainService, useFactory: () => new CodeqlToolchainService() },
    { provide: DocumentationCheckService, useFactory: () => new DocumentationCheckService() },
    { provide: CandidateRuntimeService, useFactory: () => new CandidateRuntimeService() },
    { provide: ContainerCheckService, useFactory: () => new ContainerCheckService() },
    { provide: CodeqlParentService, useFactory: () => new CodeqlParentService() },
    { provide: CodeqlService, useFactory: () => new CodeqlService() },
    { provide: PlatformCheckService, useFactory: () => new PlatformCheckService() },
  ],
  exports: [
    ImageCompatibilityService,
    BootstrapperBuildService,
    CodeqlToolchainService,
    DocumentationCheckService,
    CandidateRuntimeService,
    ContainerCheckService,
    PlatformCheckService,
    CodeqlService,
    CodeqlParentService,
  ],
})
export class CiModule {}
