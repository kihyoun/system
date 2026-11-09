#!/usr/bin/env python3
"""Reconcile a dedicated Renovate account, protected variables and one schedule.
Inputs and token state are private operator files. No credentials are printed.
"""
import argparse
import datetime as dt
import json
import os
import re
from pathlib import Path
import stat
import tempfile
import uuid
import urllib.error
import urllib.parse
import urllib.request

MARKER = 'System Bootstrapper Renovate bot'
SCHEDULE = 'System Bootstrapper dependency discovery'

def private_json(path):
    path = Path(path)
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError('Private input/state must have mode 0600')
    return json.loads(path.read_text())

def save(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()

class API:
    def __init__(self, endpoint, token):
        if not endpoint.startswith('https://') or urllib.parse.urlsplit(endpoint).query:
            raise ValueError('Use an HTTPS GitLab API endpoint')
        self.endpoint, self.token = endpoint.rstrip('/'), token
    def call(self, method, path, data=None, missing=False):
        request = urllib.request.Request(self.endpoint + path,
            data=None if data is None else json.dumps(data).encode(), method=method,
            headers={'PRIVATE-TOKEN': self.token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            # GitLab response bodies can echo private values; never print them.
            raise RuntimeError(f'GitLab API rejected {method} {path}: HTTP {error.code}') from None
    def all(self, path):
        result, page = [], 1
        while True:
            items = self.call('GET', path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
            result.extend(items)
            if len(items) < 100:
                return result
            page += 1

def protected_default_rules(api, project):
    """Audit every exact/wildcard/inherited rule: GitLab uses the most permissive.

    Only role-based No one / Maintainer-or-higher controls are understood here.
    Named/group/custom/deploy-key allowances require separate operator review,
    rather than assuming their effective identity or membership is safe.
    """
    branch = project.get('default_branch')
    if not isinstance(branch, str) or not branch:
        raise ValueError('A source project has no auditable default branch')
    rules = api.all(f"/projects/{project['id']}/protected_branches")
    matching = []
    for rule in rules:
        if not isinstance(rule, dict) or not isinstance(rule.get('name'), str) or not rule['name']:
            raise ValueError('Malformed protected-branch rule; cannot audit default branch')
        # GitLab documents a case-sensitive * wildcard, including / in names.
        # Escape everything else: Python fnmatch would also interpret ? and [].
        expression = re.escape(rule['name']).replace(r'\*', '.*')
        if re.fullmatch(expression, branch, flags=re.DOTALL):
            matching.append(rule)
    if not matching:
        raise ValueError('Both default branches must deny Developer push and merge through protection rules')
    for rule in matching:
        for permission in ('push_access_levels', 'merge_access_levels'):
            entries = rule.get(permission)
            if not isinstance(entries, list) or not entries:
                raise ValueError('Missing or empty default-branch push/merge permissions; cannot audit safely')
            for entry in entries:
                if not isinstance(entry, dict):
                    raise ValueError('Malformed default-branch push/merge permission')
                if any(entry.get(key) is not None for key in ('user_id', 'group_id', 'member_role_id', 'deploy_key_id')):
                    raise ValueError('Named, group, custom-role or deploy-key default-branch allowance requires separate operator review')
                level = entry.get('access_level')
                if type(level) is not int or level not in (0, 40, 50, 60):
                    raise ValueError('All matching default-branch rules must deny Developer push and merge')
    return matching

def reconcile(api, config, state, rotate=False, enabled=False, recover_user_id=None):
    projects = [api.call('GET', '/projects/' + str(pid)) for pid in config['project_ids']]
    if len(projects) != 2 or len({p['id'] for p in projects}) != 2:
        raise ValueError('Select exactly System and Wizard')
    system, wizard = projects
    branch = system['default_branch']
    for project in projects:
        protected_default_rules(api, project)
    binding = {key: config[key] for key in ('endpoint', 'username', 'email', 'project_ids')}
    users = api.call('GET', '/users?username=' + urllib.parse.quote(config['username']))
    created = False
    if not users:
        if state.get('user_id') or recover_user_id:
            raise ValueError('Expected bot is absent; review instance recovery and private inputs')
        if state.get('binding') and state['binding'] != binding:
            raise ValueError('Private ownership journal belongs to other inputs')
        state.setdefault('ownership_nonce', uuid.uuid4().hex)
        state['binding'] = binding
        # Journal ownership before POST: a lost creation response can be resumed
        # using the matching administrator-only note, without adopting a name.
        save(config['state_file'], state)
        user = api.call('POST', '/users', {'username': config['username'], 'name': MARKER,
            'email': config['email'], 'force_random_password': True, 'reset_password': False,
            'skip_confirmation': True, 'private_profile': True,
            'note': MARKER + ': ' + state['ownership_nonce'],
            'admin': False, 'can_create_group': False, 'projects_limit': 0, 'external': True})
        created = True
    elif len(users) == 1:
        user = api.call('GET', '/users/' + str(users[0]['id']))
    else:
        raise ValueError('Ambiguous bot username')
    if user['name'] != MARKER or user.get('is_admin') or user.get('state') != 'active':
        raise ValueError('Refuse to adopt unrelated, inactive or administrator identity')
    if (user.get('username', '').lower() != config['username'].lower() or
        user.get('email', '').lower() != config['email'].lower() or
        user.get('external') is not True or user.get('can_create_group') is not False or
        user.get('projects_limit') != 0):
        raise ValueError('Existing bot private identity or account restrictions do not match')
    uid = user['id']
    known_id = state.get('user_id') == uid and state.get('binding') == binding
    interrupted_create = (not state.get('user_id') and state.get('binding') == binding and
        state.get('ownership_nonce') and user.get('note') == MARKER + ': ' + state['ownership_nonce'])
    explicit_recovery = recover_user_id == uid
    if not (created or known_id or interrupted_create or explicit_recovery):
        raise ValueError('Existing username is not owned by private state; restore its journal or explicitly recover its verified user ID')
    memberships = api.all(f'/users/{uid}/memberships')
    if any(m['source_type'] != 'Project' or m['source_id'] not in config['project_ids'] for m in memberships):
        raise ValueError('Dedicated bot has unrelated or group memberships; remove them explicitly')
    tokens = api.all(f'/personal_access_tokens?user_id={uid}&state=active')
    owned = [t for t in tokens if t['name'] == MARKER]
    if any(t['name'] != MARKER or t.get('scopes') != ['api'] for t in tokens):
        raise ValueError('Bot has unrelated access tokens; review them explicitly')
    if explicit_recovery and any(int(m['access_level']) != 30 for m in memberships):
        raise ValueError('Recovery requires previously restricted Developer memberships')
    # Ownership and the complete ACL/token audit precede all existing-user writes.
    if explicit_recovery:
        state.clear()
        state['ownership_nonce'] = uuid.uuid4().hex
    state.update(user_id=uid, binding=binding)
    save(config['state_file'], state)
    if explicit_recovery:
        api.call('PUT', '/users/' + str(uid), {'note': MARKER + ': ' + state['ownership_nonce']})
    for project in projects:
        path = f"/projects/{project['id']}/members/{uid}"
        member = api.call('GET', path, missing=True)
        if member:
            if member['access_level'] != 30:
                api.call('PUT', path, {'access_level': 30})
        else:
            api.call('POST', f"/projects/{project['id']}/members", {'user_id': uid, 'access_level': 30})
    expiry = dt.date.fromisoformat(state.get('expires_at', '1970-01-01'))
    if rotate or not state.get('token') or expiry <= dt.date.today() + dt.timedelta(days=14):
        token = api.call('POST', f'/users/{uid}/personal_access_tokens', {
            'name': MARKER, 'scopes': ['api'],
            'expires_at': str(dt.date.today() + dt.timedelta(days=90))})
        state.update(token=token['token'], token_id=token['id'], expires_at=token['expires_at'], user_id=uid)
        # Persist before updating GitLab: interrupted setup can safely reconcile.
        save(config['state_file'], state)
    elif not any(t['id'] == state.get('token_id') and not t.get('revoked') for t in owned):
        raise ValueError('Saved bot token is no longer active; run rotate')
    bot = API(config['endpoint'], state['token']).call('GET', '/user')
    if bot['id'] != uid or bot.get('is_admin'):
        raise ValueError('Token identity mismatch')
    variables = {'RENOVATE_TOKEN': (state['token'], True),
        'RENOVATE_REPOSITORIES': (json.dumps([p['path_with_namespace'] for p in projects]), False)}
    for key, (value, masked) in variables.items():
        path = f"/projects/{system['id']}/variables/{key}"
        existing = api.call('GET', path, missing=True)
        payload = {'value': value, 'protected': True, 'masked': masked, 'raw': True, 'environment_scope': '*'}
        api.call('PUT' if existing else 'POST', path if existing else f"/projects/{system['id']}/variables", dict(payload, **({} if existing else {'key': key})))
    schedules = [s for s in api.all(f"/projects/{system['id']}/pipeline_schedules") if s['description'] == SCHEDULE]
    if len(schedules) > 1:
        raise ValueError('Duplicate owned schedules; resolve explicitly')
    payload = {'description': SCHEDULE, 'ref': branch, 'cron': config.get('cron', '0 4 * * 1'),
        'cron_timezone': config.get('timezone', 'UTC'), 'active': enabled}
    path = f"/projects/{system['id']}/pipeline_schedules"
    schedule = api.call('PUT', path + '/' + str(schedules[0]['id']), payload) if schedules else api.call('POST', path, payload)
    path += '/' + str(schedule['id'])
    api.call('POST', path + '/take_ownership', {})
    detail = api.call('GET', path)
    variable = next((v for v in detail.get('variables', []) if v['key'] == 'RENOVATE_ENABLED'), None)
    api.call('PUT' if variable else 'POST', path + '/variables' + ('/RENOVATE_ENABLED' if variable else ''),
        {'key': 'RENOVATE_ENABLED', 'value': 'true'})
    # Only revoke obsolete owned tokens after the new protected variable exists.
    for token in owned:
        if token['id'] != state['token_id']:
            api.call('DELETE', '/personal_access_tokens/' + str(token['id']))
    state.update(schedule_id=schedule['id'], project_ids=config['project_ids'])
    save(config['state_file'], state)
    return {'bot_id': uid, 'schedule_id': schedule['id'], 'active': enabled, 'expires_at': state['expires_at']}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rotate', action='store_true')
    parser.add_argument('--recover-user-id', type=int, help='Explicitly recover a verified restricted account after losing its private journal')
    parser.add_argument('--enable', action='store_true', help='Activate schedule; omitted means paused')
    args = parser.parse_args()
    config = private_json(args.config)
    if not args.apply:
        print('Validated private inputs; --apply reconciles the dedicated bot and a paused schedule (--enable activates).')
        return
    secret = Path(config['admin_token_file'])
    if stat.S_IMODE(secret.stat().st_mode) & 0o077:
        raise ValueError('Administrator token file must have mode 0600')
    state = private_json(config['state_file']) if Path(config['state_file']).exists() else {}
    print(json.dumps(reconcile(API(config['endpoint'], secret.read_text().strip()), config, state, args.rotate, args.enable, args.recover_user_id)))

if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        raise SystemExit(str(error))
