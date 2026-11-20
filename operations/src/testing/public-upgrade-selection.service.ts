import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { record } from '../release/source-identity';
import { requireValue as ensure, reference } from '../host/install';
import { cube } from '../host-bootstrap/runtime-verification.service';
import { readPrivateInput } from '../host/private-input';
import { imageAssignment, replaceOwned, directoryBarrier } from '../host/release-selection.service';

/** Exact disposable candidate selector adaptation; production selection remains strict. */
@Injectable()
export class PublicUpgradeSelectionService {
  previousConfiguration(raw: Buffer, fixture: Record<string, unknown>): Buffer {
    const expected = record(record(record(fixture.spec).images).candidate).id;
    ensure(
      typeof expected === 'string' && /^sha256:[a-f0-9]{64}$/.test(expected),
      'candidate-controller-image-id-required',
    );
    cube(raw);
    const text = raw.toString('utf8');
    ensure(Buffer.from(text).equals(raw), 'candidate-controller-assignment-required');
    const matches = [...text.matchAll(/^(?:export )?BOOTSTRAPPER_IMAGE=.*(?:\n|$)/gm)];
    ensure(
      matches.length === 1 && Buffer.byteLength(text.slice(0, matches[0].index)) >= 1184,
      'candidate-controller-assignment-required',
    );
    const match = matches[0],
      line = match[0].replace(/\n$/, '');
    const selected = line.slice(line.indexOf('=') + 1);
    ensure(
      [expected, "'" + expected + "'", '"' + expected + '"'].includes(selected),
      'candidate-controller-selector-mismatch',
    );
    const images = record(record(fixture.previous).images);
    const replacement =
      "export BOOTSTRAPPER_IMAGE='" +
      reference(record(images.controller).reference) +
      "'" +
      (match[0].endsWith('\n') ? '\n' : '');
    let result: Buffer = Buffer.from(
      text.slice(0, match.index) + replacement + text.slice(match.index! + match[0].length),
    );
    for (const [role, key] of [
      ['controller', 'BOOTSTRAPPER_IMAGE'],
      ['wizard', 'WIZARD_IMAGE'],
    ])
      result = imageAssignment(result, reference(record(images[role]).reference), key);
    return result;
  }
  execute(
    directory: string,
    operation: 'initialize' | 'restore-original',
    fixture: Record<string, unknown>,
  ) {
    ensure(
      path.isAbsolute(directory) &&
        typeof fixture.live === 'string' &&
        path.isAbsolute(fixture.live),
      'absolute-fixture-required',
    );
    const configuration = path.join(fixture.live, 'configuration');
    const names = ['.release-images.json', '.release-images.env', '.release-images.recovered.json'];
    const originalFile = path.join(directory, 'original-selection.json');
    const write = (filename: string, bytes: Buffer) =>
      replaceOwned(filename, bytes, {
        mode: 0o600,
        uid: process.geteuid!(),
        gid: process.getegid!(),
      });
    if (operation === 'restore-original') {
      const original = record(JSON.parse(readPrivateInput(originalFile).toString()));
      ensure(
        Object.keys(original).length === names.length &&
          names.every((name) => Object.hasOwn(original, name)),
        'invalid-original-selection',
      );
      for (const name of names) {
        const filename = path.join(configuration, name),
          content = original[name];
        ensure(content === null || typeof content === 'string', 'invalid-original-selection');
        if (content === null) {
          fs.rmSync(filename, { force: true });
          directoryBarrier(configuration);
        } else {
          const bytes = Buffer.from(content as string, 'base64');
          ensure(bytes.toString('base64') === content, 'invalid-original-selection');
          write(filename, bytes);
        }
      }
      return { restored: true };
    }
    const main = path.join(configuration, '.docker.env');
    const raw = this.previousConfiguration(readPrivateInput(main), fixture);
    const previous = record(fixture.previous),
      source = record(previous.source),
      images = record(previous.images);
    const original = Object.fromEntries(
      names.map((name) => {
        const filename = path.join(configuration, name);
        return [
          name,
          fs.lstatSync(filename, { throwIfNoEntry: false })
            ? readPrivateInput(filename).toString('base64')
            : null,
        ];
      }),
    );
    ensure(!fs.existsSync(originalFile), 'fixture-already-initialized');
    write(originalFile, Buffer.from(JSON.stringify(original)));
    write(main, raw);
    write(
      path.join(configuration, '.release-images.json'),
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          sourceCommit: source.revision,
          sourceTree: source.tree,
          ...(source.sourceLayout === 'system-monorepo-v1'
            ? { sourceLayout: source.sourceLayout, wizardSourceTree: source.wizardSourceTree }
            : { wizardSourceRevision: source.wizardRevision }),
          images,
          productRelease: { version: previous.version, tag: previous.tag },
        }),
      ),
    );
    write(
      path.join(configuration, '.release-images.env'),
      Buffer.from(
        [
          ['controller', 'BOOTSTRAPPER_IMAGE'],
          ['wizard', 'WIZARD_IMAGE'],
        ]
          .map(([role, key]) => key + '=' + reference(record(images[role]).reference) + '\n')
          .join(''),
      ),
    );
    return { initialized: true };
  }
}
