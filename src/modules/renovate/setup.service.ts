import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { row, positive, projectIds, type RenovateReader } from './verification.service';

export const BOT_MARKER = 'System Bootstrapper Renovate bot';
export const SCHEDULE_MARKER = 'System Bootstrapper dependency discovery';
type Row = Record<string, unknown>;
export interface RenovateSetupApi extends RenovateReader {
  call(method: string, route: string, data?: unknown, missing?: boolean): Promise<unknown>;
}
export interface RenovateSetupPort {
  save(state: Row): Promise<void>;
  bot(token: string): RenovateReader;
  now(): Date;
}
export interface SetupOptions {
  rotate?: boolean;
  enabled?: boolean;
  recoverUserId?: number;
}
function ensure(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function text(value: unknown): string {
  ensure(
    typeof value === 'string' && value.length > 0 && !/[\r\n\0]/.test(value),
    'Invalid Renovate configuration string.',
  );
  return value;
}
function records(value: unknown): Row[] {
  ensure(Array.isArray(value), 'Expected GitLab collection.');
  return value.map(row);
}
function date(value: unknown): number {
  const raw = text(value);
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(raw), 'Invalid token expiry.');
  const time = Date.parse(raw + 'T00:00:00Z');
  ensure(
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === raw,
    'Invalid token expiry.',
  );
  return time;
}

/** Audit all applicable branch rules: GitLab combines them permissively. */
export async function protectedDefaultRules(api: RenovateReader, project: Row): Promise<void> {
  const branch = text(project.default_branch);
  const rules = records(await api.all(`/projects/${positive(project.id)}/protected_branches`));
  const matches = rules.filter((rule) => {
    const name = text(rule.name);
    const pattern = name
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp('^' + pattern + '$', 's').test(branch);
  });
  ensure(matches.length, 'Default branches must deny Developer push and merge.');
  for (const rule of matches)
    for (const permission of ['push_access_levels', 'merge_access_levels']) {
      const entries = records(rule[permission]);
      ensure(entries.length, 'Missing default-branch permissions.');
      for (const entry of entries) {
        ensure(
          !['user_id', 'group_id', 'member_role_id', 'deploy_key_id'].some(
            (key) => entry[key] != null,
          ),
          'Named, group, custom-role or deploy-key allowance requires operator review.',
        );
        ensure(
          typeof entry.access_level === 'number' && [0, 40, 50, 60].includes(entry.access_level),
          'All matching branch rules must deny Developer push and merge.',
        );
      }
    }
}

@Injectable()
export class RenovateSetupService {
  async reconcile(
    api: RenovateSetupApi,
    input: unknown,
    state: Row,
    port: RenovateSetupPort,
    options: SetupOptions = {},
  ) {
    const config = row(input),
      ids = projectIds(config.project_ids);
    const username = text(config.username),
      email = text(config.email),
      endpoint = text(config.endpoint);
    if (options.recoverUserId !== undefined) positive(options.recoverUserId);
    const projects: Row[] = [];
    for (const id of ids) {
      const project = row(await api.get(`/projects/${id}`));
      ensure(project.id === id, 'GitLab project identities do not match selection.');
      await protectedDefaultRules(api, project);
      text(project.path_with_namespace);
      projects.push(project);
    }
    const system = projects[0],
      binding = { endpoint, username, email, project_ids: ids };
    const users = records(await api.get('/users?username=' + encodeURIComponent(username)));
    let user: Row,
      created = false;
    if (!users.length) {
      ensure(
        !state.user_id && !options.recoverUserId,
        'Expected bot is absent; review recovery inputs.',
      );
      ensure(
        !state.binding || isDeepStrictEqual(state.binding, binding),
        'Ownership journal belongs to other inputs.',
      );
      state.ownership_nonce ||= randomUUID().replaceAll('-', '');
      state.binding = binding;
      await port.save(state);
      user = row(
        await api.call('POST', '/users', {
          username,
          name: BOT_MARKER,
          email,
          force_random_password: true,
          reset_password: false,
          skip_confirmation: true,
          private_profile: true,
          note: BOT_MARKER + ': ' + text(state.ownership_nonce),
          admin: false,
          can_create_group: false,
          projects_limit: 0,
          external: true,
        }),
      );
      created = true;
    } else {
      ensure(users.length === 1, 'Ambiguous bot username.');
      user = row(await api.get('/users/' + positive(users[0].id)));
    }
    ensure(
      user.name === BOT_MARKER && !user.is_admin && user.state === 'active',
      'Refuse unrelated, inactive or administrator identity.',
    );
    ensure(
      text(user.username).toLowerCase() === username.toLowerCase() &&
        text(user.email).toLowerCase() === email.toLowerCase() &&
        user.external === true &&
        user.can_create_group === false &&
        user.projects_limit === 0,
      'Bot identity or account restrictions do not match.',
    );
    const uid = positive(user.id),
      known = state.user_id === uid && isDeepStrictEqual(state.binding, binding);
    const interrupted =
      !state.user_id &&
      isDeepStrictEqual(state.binding, binding) &&
      state.ownership_nonce &&
      user.note === BOT_MARKER + ': ' + state.ownership_nonce;
    const recovery = options.recoverUserId === uid;
    ensure(
      created || known || interrupted || recovery,
      'Existing username is not owned by private state.',
    );
    const memberships = records(await api.all(`/users/${uid}/memberships`));
    ensure(
      memberships.every(
        (member) => member.source_type === 'Project' && ids.includes(positive(member.source_id)),
      ),
      'Dedicated bot has unrelated or group memberships.',
    );
    const tokens = records(await api.all(`/personal_access_tokens?user_id=${uid}&state=active`));
    ensure(
      tokens.every(
        (token) => token.name === BOT_MARKER && isDeepStrictEqual(token.scopes, ['api']),
      ),
      'Bot has unrelated access tokens.',
    );
    if (recovery) {
      ensure(
        memberships.every((member) => member.access_level === 30),
        'Recovery requires restricted Developer memberships.',
      );
      for (const key of Object.keys(state)) delete state[key];
      state.ownership_nonce = randomUUID().replaceAll('-', '');
    }
    Object.assign(state, { user_id: uid, binding });
    await port.save(state);
    if (recovery)
      await api.call('PUT', `/users/${uid}`, { note: BOT_MARKER + ': ' + state.ownership_nonce });
    for (const id of ids) {
      const route = `/projects/${id}/members/${uid}`,
        found = await api.call('GET', route, undefined, true);
      if (found) {
        if (row(found).access_level !== 30) await api.call('PUT', route, { access_level: 30 });
      } else await api.call('POST', `/projects/${id}/members`, { user_id: uid, access_level: 30 });
    }
    const today = date(port.now().toISOString().slice(0, 10));
    if (
      options.rotate ||
      !state.token ||
      date(state.expires_at ?? '1970-01-01') <= today + 14 * 86400000
    ) {
      const token = row(
        await api.call('POST', `/users/${uid}/personal_access_tokens`, {
          name: BOT_MARKER,
          scopes: ['api'],
          expires_at: new Date(today + 90 * 86400000).toISOString().slice(0, 10),
        }),
      );
      date(token.expires_at);
      Object.assign(state, {
        token: text(token.token),
        token_id: positive(token.id),
        expires_at: token.expires_at,
        user_id: uid,
      });
      await port.save(state);
    } else
      ensure(
        tokens.some((token) => token.id === state.token_id && !token.revoked),
        'Saved bot token is no longer active; rotate it.',
      );
    const bot = row(await port.bot(text(state.token)).get('/user'));
    ensure(bot.id === uid && !bot.is_admin, 'Token identity mismatch.');
    for (const [key, value, masked] of [
      ['RENOVATE_TOKEN', state.token, true],
      [
        'RENOVATE_REPOSITORIES',
        JSON.stringify(projects.map((project) => project.path_with_namespace)),
        false,
      ],
    ] as const) {
      const route = `/projects/${system.id}/variables/${key}`,
        existing = await api.call('GET', route, undefined, true);
      await api.call(
        existing ? 'PUT' : 'POST',
        existing ? route : `/projects/${system.id}/variables`,
        {
          value,
          protected: true,
          masked,
          raw: true,
          environment_scope: '*',
          ...(existing ? {} : { key }),
        },
      );
    }
    const route = `/projects/${system.id}/pipeline_schedules`;
    const schedules = records(await api.all(route)).filter(
      (schedule) => schedule.description === SCHEDULE_MARKER,
    );
    ensure(schedules.length <= 1, 'Duplicate owned schedules; resolve explicitly.');
    const schedule = row(
      await api.call(
        schedules.length ? 'PUT' : 'POST',
        schedules.length ? route + '/' + positive(schedules[0].id) : route,
        {
          description: SCHEDULE_MARKER,
          ref: text(system.default_branch),
          cron: text(config.cron ?? '0 4 * * 1'),
          cron_timezone: text(config.timezone ?? 'UTC'),
          active: options.enabled === true,
        },
      ),
    );
    const scheduleId = positive(schedule.id),
      scheduleRoute = route + '/' + scheduleId;
    await api.call('POST', scheduleRoute + '/take_ownership', {});
    const detail = row(await api.get(scheduleRoute));
    const variable = records(detail.variables ?? []).some(
      (variable) => variable.key === 'RENOVATE_ENABLED',
    );
    await api.call(
      variable ? 'PUT' : 'POST',
      scheduleRoute + '/variables' + (variable ? '/RENOVATE_ENABLED' : ''),
      { key: 'RENOVATE_ENABLED', value: 'true' },
    );
    for (const token of tokens)
      if (token.id !== state.token_id)
        await api.call('DELETE', '/personal_access_tokens/' + positive(token.id));
    Object.assign(state, { schedule_id: scheduleId, project_ids: ids });
    await port.save(state);
    return {
      bot_id: uid,
      schedule_id: scheduleId,
      active: options.enabled === true,
      expires_at: state.expires_at,
    };
  }
}
