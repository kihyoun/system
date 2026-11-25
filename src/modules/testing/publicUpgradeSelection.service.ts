import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { record } from '../release/sourceIdentity';
import { requireValue as ensure, reference } from '../host/install';
import { cube } from '../host-bootstrap/runtimeVerification.service';
import { readPrivateInput } from '../host/privateInput';
import { imageAssignment, replaceOwned, directoryBarrier } from '../host/releaseSelection.service';
import { environmentAssignments } from '../../common/runtime/environmentAssignments';

/** Exact disposable candidate selector adaptation; production selection remains strict. */
@Injectable()
export class PublicUpgradeSelectionService {
  migrated(
    directory: string,
    operation:
      | 'save-migrated-public-selection'
      | 'restore-migrated-public-selection'
      | 'candidate-pair-selectors',
    fixture: Record<string, unknown>,
  ) {
    const configuration = path.join(String(fixture.live), 'configuration'),
      main = path.join(configuration, '.docker.env'),
      names = ['.docker.env', '.release-images.json', '.release-images.env'],
      file = path.join(directory, 'migrated-public-selection.json'),
      write = (filename: string, bytes: Buffer) =>
        replaceOwned(filename, bytes, {
          mode: 0o600,
          uid: process.geteuid!(),
          gid: process.getegid!(),
        });

    if (operation === 'save-migrated-public-selection') {
      ensure(!fs.existsSync(file), 'candidate-migrated-selection-already-saved');
      write(
        file,
        Buffer.from(
          JSON.stringify(
            Object.fromEntries(
              names.map((name) => [
                name,
                readPrivateInput(path.join(configuration, name)).toString('base64'),
              ]),
            ),
          ),
        ),
      );
      return { saved: true };
    }

    if (operation === 'restore-migrated-public-selection') {
      const saved = record(JSON.parse(readPrivateInput(file).toString())),
        raw = Buffer.from(String(saved['.docker.env']), 'base64'),
        previous = environmentAssignments(raw.toString()),
        current = environmentAssignments(readPrivateInput(main).toString());
      cube(raw);
      ensure(
        ['GITLAB_IMAGE', 'GITLAB_RUNNER_IMAGE'].every(
          (key) => previous[key] && previous[key] === current[key],
        ),
        'candidate-migrated-service-selection-changed',
      );
      for (const name of names) {
        ensure(typeof saved[name] === 'string', 'candidate-migrated-selection-invalid');
        write(path.join(configuration, name), Buffer.from(String(saved[name]), 'base64'));
      }
      return { restored: true };
    }

    let raw = readPrivateInput(main),
      text = raw.toString();
    cube(raw);
    for (const [role, key, specRole] of [
      ['controller', 'BOOTSTRAPPER_IMAGE', 'candidate'],
      ['wizard', 'WIZARD_IMAGE', 'wizard'],
    ]) {
      const previous = reference(record(record(record(fixture.previous).images)[role]).reference),
        image = record(record(record(fixture.spec).images)[specRole]).id,
        assignment = new RegExp('^export ' + key + '=.*$', 'gm'),
        matches = [...text.matchAll(assignment)];
      ensure(
        typeof image === 'string' &&
          /^sha256:[a-f0-9]{64}$/.test(image) &&
          matches.length === 1 &&
          environmentAssignments(matches[0][0])[key] === previous,
        'candidate-pair-selector-mismatch',
      );
      text = text.replace(assignment, 'export ' + key + "='" + image + "'");
    }
    raw = Buffer.from(text);
    cube(raw);
    write(main, raw);
    const original = record(
      JSON.parse(readPrivateInput(path.join(directory, 'original-selection.json')).toString()),
    );
    for (const name of [
      '.release-images.json',
      '.release-images.env',
      '.release-images.recovered.json',
    ]) {
      const content = original[name],
        destination = path.join(configuration, name);
      ensure(content === null || typeof content === 'string', 'invalid-original-selection');

      if (content === null) {
        fs.rmSync(destination, { force: true });
        directoryBarrier(configuration);
      } else {
        write(destination, Buffer.from(String(content), 'base64'));
      }
    }
    return { selected: true };
  }

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
    ]) {
      result = imageAssignment(result, reference(record(images[role]).reference), key);
    }
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
