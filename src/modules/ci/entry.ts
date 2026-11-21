import { ImageCompatibilityService } from '../build/image-compatibility.service';
import fs from 'node:fs';
import { assess } from './candidate-capacity';
import { BootstrapperBuildService } from './bootstrapper-build.service';
import { CodeqlToolchainService } from './codeql-toolchain.service';
import { contextMain } from './context-entry';
import { DocumentationCheckService } from './documentation.service';
import { CandidateRuntimeService } from './candidate-runtime.service';
import { ProcessFailure } from '../../common/runtime/process';
import { ContainerCheckService } from './container-check.service';
import { CodeqlParentService } from './codeql-parent.service';
import 'reflect-metadata';
import { CodeqlService } from './codeql.service';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { CiModule } from './ci.module';
import { PlatformCheckService } from './platform.service';
export async function ciMain(args = process.argv.slice(2)) {
  if (args[0] === 'candidate-capacity') {
    if (args.length !== 2 || !path.isAbsolute(args[1]))
      throw Error('absolute-candidate-capacity-path-required');
    const capacity = assess(fs.readFileSync('/proc/meminfo', 'utf8'), fs.statfsSync(args[1]));
    console.log(JSON.stringify(capacity));
    if (!capacity.capacityReady)
      throw Error(
        'Candidate refused: require 12 GiB available plus 2 GiB host reserve and 40 GiB free on the job filesystem.',
      );
    return;
  }

  if (
    ['prepare-context', 'prepare-candidate', 'prepare-wizard-browser', 'prepare-codeql'].includes(
      args[0],
    )
  ) {
    if (args.length !== 2 || !path.isAbsolute(args[1] || ''))
      throw Error('context-action-and-absolute-checkout-required');
    return contextMain(args[0], args[1]);
  }
  if (
    ![
      'platform',
      'documentation',
      'codeql',
      'codeql-parent',
      'isolated',
      'wizard-browser',
      'candidate-image',
      'candidate-runtime',
      'node-runtime',
      'image-compatibility',
      'build-bootstrapper',
      'codeql-toolchain',
    ].includes(args[0]) ||
    !args[1]?.startsWith('/') ||
    args.length > 3 ||
    (args[2] &&
      !['isolated', 'wizard-browser', 'candidate-image', 'candidate-runtime'].includes(args[0]) &&
      (args[0] !== 'codeql' ? args[2] !== 'cleanup' : !args[2].startsWith('/')))
  )
    throw new Error('usage-ci-platform-absolute-checkout-cleanup');
  if (
    ['node-runtime', 'image-compatibility', 'build-bootstrapper', 'codeql-toolchain'].includes(
      args[0],
    ) &&
    args.length !== 2
  )
    throw Error('unexpected-ci-build-arguments');
  const app = await NestFactory.createApplicationContext(CiModule, { logger: false });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    if (args[0] === 'image-compatibility')
      return app.get(ImageCompatibilityService).install(args[1]);
    if (args[0] === 'node-runtime')
      return await app
        .get(CandidateRuntimeService)
        .checkToolchain(args[1], process.env, abort.signal);
    if (args[0] === 'build-bootstrapper')
      return await app.get(BootstrapperBuildService).build(args[1], process.env, abort.signal);
    if (args[0] === 'codeql-toolchain')
      return await app.get(CodeqlToolchainService).install(args[1], process.env, abort.signal);
    if (args[0] === 'documentation') {
      await app
        .get(DocumentationCheckService)
        .execute(args[1], process.env, args[2] === 'cleanup', abort.signal);
      return;
    }
    if (args[0] === 'candidate-runtime') {
      await app.get(CandidateRuntimeService).check(args[1], process.env, abort.signal);
      return;
    }
    if (args[0] === 'isolated' || args[0] === 'wizard-browser' || args[0] === 'candidate-image') {
      await app
        .get(ContainerCheckService)
        .execute(args[0], args[1], process.env, args[2] || 'run', abort.signal);
      return;
    }
    if (args[0] === 'codeql') {
      await app.get(CodeqlService).scan(args[1], args[2] || '/reports', process.env, abort.signal);
      return;
    }
    await app
      .get(args[0] === 'codeql-parent' ? CodeqlParentService : PlatformCheckService)
      .execute(path.resolve(args[1]), process.env, args[2] === 'cleanup', abort.signal);
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await app.close();
  }
}
if (require.main === module)
  void ciMain().catch((error) => {
    console.error(error instanceof Error ? error.message : 'ci-platform-failed');
    process.exitCode =
      error instanceof ProcessFailure &&
      error.status !== null &&
      error.status > 0 &&
      error.status < 256
        ? error.status
        : 1;
  });
