#!/usr/bin/env python3
"""Functional reconciliation checks against a stateful in-memory GitLab API."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('renovate_setup', Path(__file__).resolve().parents[2] / 'gitlab/renovate/setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
ORIGINAL_API = setup.API

class GitLab:
    def __init__(self):
        self.user = None
        self.members, self.variables, self.tokens = {}, {}, []
        self.schedules, self.calls = [], []
        self.extra = []
        self.unsafe_branch = False
        self.protected_rules = {}
    def all(self, path):
        if path.endswith('/protected_branches'):
            self.calls.append(('GET', path, None))
            return self.protected_rules.get(int(path.split('/')[2]), [
                {'name': 'main', 'push_access_levels': [{'access_level': 30 if self.unsafe_branch else 40}],
                 'merge_access_levels': [{'access_level': 40}]}])
        if path.endswith('/memberships'):
            return [{'source_type': 'Project', 'source_id': p, 'access_level': 30} for p in self.members] + self.extra
        if path.startswith('/personal_access_tokens?'):
            return [t for t in self.tokens if not t.get('revoked')]
        if path.endswith('/pipeline_schedules'):
            return self.schedules
        raise AssertionError(path)
    def call(self, method, path, data=None, missing=False):
        self.calls.append((method, path, data))
        parts = path.split('/')
        if method == 'GET' and path in ('/projects/10', '/projects/11'):
            pid = int(parts[2]); return {'id': pid, 'default_branch': 'main', 'path_with_namespace': 'example/' + ('system' if pid == 10 else 'wizard')}
        if path.startswith('/users?'):
            return [self.user] if self.user else []
        if path == '/users' and method == 'POST':
            self.user = dict(data, id=9, is_admin=False, state='active'); return self.user
        if path == '/users/9':
            if method == 'PUT': self.user.update(data)
            return self.user
        if path.endswith('/personal_access_tokens'):
            token = dict(data, id=len(self.tokens)+1, token='private-fixture-token', revoked=False)
            self.tokens.append(token); return token
        if path.startswith('/personal_access_tokens/') and method == 'DELETE':
            next(t for t in self.tokens if t['id'] == int(parts[-1]))['revoked'] = True; return
        if '/members' in path:
            pid = int(parts[2])
            if method == 'GET': return self.members.get(pid)
            self.members[pid] = dict(data); return self.members[pid]
        if '/variables' in path and '/pipeline_schedules/' not in path:
            if method == 'GET': return self.variables.get(parts[-1])
            self.variables[data.get('key', parts[-1])] = data; return data
        if path == '/projects/10/pipeline_schedules' and method == 'POST':
            self.schedules.append(dict(data, id=3, variables=[])); return self.schedules[0]
        if path == '/projects/10/pipeline_schedules/3':
            if method == 'PUT': self.schedules[0].update(data)
            return self.schedules[0]
        if path.endswith('/take_ownership'): return
        if '/pipeline_schedules/3/variables' in path:
            self.schedules[0]['variables'] = [data]; return data
        raise AssertionError((method, path, data))

class Provisioning(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.config = {'endpoint': 'https://gitlab.example.com/api/v4', 'username': 'dependency-bot', 'email': 'bot@example.com',
                       'project_ids': [10,11], 'state_file': self.temp.name + '/state.json'}
        self.api, self.state = GitLab(), {}
        original = setup.API
        setup.API = lambda endpoint, token: type('Bot', (), {'call': lambda _, method, path: {'id': 9, 'is_admin': False}})()
        self.addCleanup(setattr, setup, 'API', original)
    def test_setup_repeat_rotation_pause_and_resume(self):
        first = setup.reconcile(self.api, self.config, self.state)
        self.assertFalse(first['active'])
        self.assertEqual(set(self.api.members), {10,11})
        self.assertTrue(all(m['access_level'] == 30 for m in self.api.members.values()))
        token = self.api.variables['RENOVATE_TOKEN']
        self.assertTrue(token['protected']); self.assertTrue(token['masked']); self.assertTrue(token['raw'])
        self.assertEqual(self.api.user['projects_limit'], 0)
        setup.reconcile(self.api, self.config, self.state, enabled=True)
        self.assertEqual(len(self.api.tokens), 1); self.assertEqual(len(self.api.schedules), 1)
        self.assertTrue(self.api.schedules[0]['active'])
        setup.reconcile(self.api, self.config, self.state, rotate=True, enabled=True)
        self.assertEqual(len(self.api.tokens), 2); self.assertTrue(self.api.tokens[0]['revoked'])
        calls = self.api.calls
        revoke = next(i for i, c in enumerate(calls) if c[:2] == ('DELETE','/personal_access_tokens/1'))
        self.assertTrue(any(i < revoke and c[:2] == ('PUT','/projects/10/variables/RENOVATE_TOKEN') for i,c in enumerate(calls)))
        self.assertEqual(setup.private_json(self.config['state_file'])['token_id'], 2)
        setup.reconcile(self.api, self.config, self.state)
        self.assertFalse(self.api.schedules[0]['active'])
    def test_reject_unrelated_memberships(self):
        setup.reconcile(self.api, self.config, self.state)
        self.api.extra = [{'source_type': 'Namespace', 'source_id': 99}]
        count = len(self.api.tokens)
        with self.assertRaisesRegex(ValueError, 'unrelated'):
            setup.reconcile(self.api, self.config, self.state, rotate=True)
        self.assertEqual(len(self.api.tokens), count)
    def test_reject_unprotected_default_before_creating_identity(self):
        self.api.unsafe_branch = True
        with self.assertRaisesRegex(ValueError, 'deny Developer'):
            setup.reconcile(self.api, self.config, self.state)
        self.assertIsNone(self.api.user)
    @staticmethod
    def protection(name='main', push=40, merge=40, **extra):
        return dict(name=name, push_access_levels=[{'access_level': push}],
                    merge_access_levels=[{'access_level': merge}], **extra)
    def test_wildcard_push_and_merge_cannot_be_overridden_by_exact_rule(self):
        for project in (10,11):
            for pattern in ('*','m*','*ain'):
                for permission in ('push','merge'):
                    with self.subTest(project=project, pattern=pattern, permission=permission):
                        self.api.protected_rules = {project: [self.protection(),
                            self.protection(pattern, **{permission: 30})]}
                        self.api.calls.clear()
                        with self.assertRaisesRegex(ValueError, 'deny Developer'):
                            setup.reconcile(self.api, self.config, self.state)
                        self.assertIsNone(self.api.user)
                        self.assertTrue(all(method == 'GET' for method, _, _ in self.api.calls))
    def test_inherited_permissive_rule_is_audited(self):
        self.api.protected_rules[11] = [self.protection(), self.protection('m*', merge=30, inherited=True)]
        with self.assertRaisesRegex(ValueError, 'deny Developer'):
            setup.reconcile(self.api, self.config, self.state)
        self.assertIsNone(self.api.user)
    def test_restrictive_wildcard_only_and_unrelated_rules_work(self):
        self.api.protected_rules[10] = [self.protection('m*'), self.protection('release/*', push=30, merge=30)]
        self.api.protected_rules[11] = [self.protection(), self.protection('*', push=0, merge=40, inherited=True),
                                        self.protection('M*', push=30, merge=30)]
        setup.reconcile(self.api, self.config, self.state)
        self.assertEqual(set(self.api.members), {10,11})
    def test_missing_empty_and_malformed_matching_permissions_fail_closed(self):
        for permission in ('push_access_levels','merge_access_levels'):
            for invalid in ('missing', [], None, {}, [None], [{'access_level': None}], [{'access_level': '40'}]):
                with self.subTest(permission=permission, invalid=invalid):
                    rule = self.protection()
                    if invalid == 'missing': del rule[permission]
                    else: rule[permission] = invalid
                    self.api.protected_rules[10] = [rule]
                    with self.assertRaises(ValueError):
                        setup.reconcile(self.api, self.config, self.state)
                    self.assertIsNone(self.api.user)
        self.api.protected_rules[10] = [self.protection('release/*')]
        with self.assertRaisesRegex(ValueError, 'deny Developer'):
            setup.reconcile(self.api, self.config, self.state)
    def test_named_bot_and_custom_allowances_fail_before_identity_creation(self):
        for permission in ('push_access_levels','merge_access_levels'):
            for selector in ('user_id','group_id','member_role_id','deploy_key_id'):
                with self.subTest(permission=permission, selector=selector):
                    rule = self.protection('*')
                    rule[permission] = [{'access_level': 40, selector: 9}]
                    self.api.protected_rules[10] = [self.protection(), rule]
                    with self.assertRaisesRegex(ValueError, 'separate operator review'):
                        setup.reconcile(self.api, self.config, self.state)
                    self.assertIsNone(self.api.user)
    def test_new_wildcard_allowance_blocks_rotation_without_writes(self):
        setup.reconcile(self.api, self.config, self.state)
        self.api.protected_rules[11] = [self.protection(), self.protection('*', push=30)]
        self.api.calls.clear()
        with self.assertRaisesRegex(ValueError, 'deny Developer'):
            setup.reconcile(self.api, self.config, self.state, rotate=True)
        self.assertTrue(all(method == 'GET' for method, _, _ in self.api.calls))
    def test_protected_branch_pagination_cannot_hide_permissive_rule(self):
        fixture = self
        class Pages(ORIGINAL_API):
            def __init__(self): self.requests = []
            def call(self, method, route, data=None, missing=False):
                self.requests.append(route)
                if route.rsplit('&page=', 1)[-1] == '1':
                    return [fixture.protection()] + [fixture.protection('release/' + str(i)) for i in range(99)]
                if route.rsplit('&page=', 1)[-1] == '2': return [fixture.protection('*', merge=30, inherited=True)]
                raise AssertionError(route)
        pages = Pages()
        with self.assertRaisesRegex(ValueError, 'deny Developer'):
            setup.protected_default_rules(pages, {'id': 10, 'default_branch': 'main'})
        self.assertEqual(len(pages.requests), 2)
    def test_reject_existing_admin(self):
        self.api.user = {'id': 9, 'name': setup.MARKER, 'is_admin': True, 'state': 'active'}
        with self.assertRaisesRegex(ValueError, 'administrator'):
            setup.reconcile(self.api, self.config, self.state)
        self.assertFalse(self.api.tokens)
    def test_marker_name_alone_cannot_adopt_existing_user(self):
        setup.reconcile(self.api, self.config, self.state)
        self.api.calls.clear()
        with self.assertRaisesRegex(ValueError, 'not owned by private state'):
            setup.reconcile(self.api, self.config, {})
        self.assertTrue(all(method == 'GET' for method, _, _ in self.api.calls))
    def test_saved_identity_email_mismatch_is_read_only(self):
        setup.reconcile(self.api, self.config, self.state)
        self.api.user['email'] = 'another@example.com'
        self.api.calls.clear()
        with self.assertRaisesRegex(ValueError, 'private identity'):
            setup.reconcile(self.api, self.config, self.state)
        self.assertTrue(all(method == 'GET' for method, _, _ in self.api.calls))
    def test_interrupted_creation_resumes_only_private_nonce(self):
        original_call = self.api.call
        def lost_response(method, path, data=None, missing=False):
            result = original_call(method, path, data, missing)
            if method == 'POST' and path == '/users':
                raise RuntimeError('simulated response loss')
            return result
        self.api.call = lost_response
        with self.assertRaisesRegex(RuntimeError, 'response loss'):
            setup.reconcile(self.api, self.config, self.state)
        journal = setup.private_json(self.config['state_file'])
        self.assertNotIn('user_id', journal)
        self.assertEqual(self.api.user['note'], setup.MARKER + ': ' + journal['ownership_nonce'])
        self.assertTrue(self.api.user['force_random_password'])
        self.assertFalse(self.api.user['reset_password'])
        self.api.call = original_call
        setup.reconcile(self.api, self.config, journal)
        self.assertEqual(journal['user_id'], 9)
        self.assertEqual(sum(m == 'POST' and p == '/users' for m,p,_ in self.api.calls), 1)
    def test_unrelated_tokens_rejected_before_existing_user_mutation(self):
        setup.reconcile(self.api, self.config, self.state)
        self.api.tokens.append({'id': 99, 'name': 'unrelated', 'scopes': ['api']})
        self.api.members.clear(); self.api.calls.clear()
        with self.assertRaisesRegex(ValueError, 'unrelated access tokens'):
            setup.reconcile(self.api, self.config, self.state)
        self.assertTrue(all(method == 'GET' for method, _, _ in self.api.calls))
    def test_explicit_private_identity_recovery_rotates_token(self):
        setup.reconcile(self.api, self.config, self.state)
        recovered = {}
        setup.reconcile(self.api, self.config, recovered, recover_user_id=9)
        self.assertEqual(recovered['user_id'], 9)
        self.assertNotEqual(recovered['ownership_nonce'], self.state['ownership_nonce'])
        self.assertTrue(self.api.tokens[0]['revoked'])
    def test_explicit_recovery_rejects_unrestricted_account_before_writes(self):
        setup.reconcile(self.api, self.config, self.state)
        self.api.user['can_create_group'] = True; self.api.calls.clear()
        with self.assertRaisesRegex(ValueError, 'restrictions'):
            setup.reconcile(self.api, self.config, {}, recover_user_id=9)
        self.assertTrue(all(method == 'GET' for method, _, _ in self.api.calls))
    def test_reject_nonprivate_state_file(self):
        p = Path(self.temp.name) / 'unsafe.json'; p.write_text('{}'); p.chmod(0o644)
        with self.assertRaisesRegex(ValueError, '0600'):
            setup.private_json(p)

verify_spec = importlib.util.spec_from_file_location('renovate_verify', Path(__file__).resolve().parents[2] / 'gitlab/renovate/verify.py')
verification = importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(verification)

class DiscoveryVerification(unittest.TestCase):
    def test_first_run_dashboard_only_and_detect_mutations(self):
        class Reader:
            changed = False
            extra_job = False
            def all(self, route):
                if '/repository/branches' in route:
                    return [{'name': 'main'}] + ([{'name': 'renovate/unapproved'}] if self.changed else [])
                if '/merge_requests?' in route: return []
                if '/issues?' in route: return [{'title': 'Dependency Dashboard', 'author': {'id': 9}, 'iid': 1}]
                if '/jobs' in route:
                    return [{'name': 'renovate:discover', 'status': 'success'}] + ([{'name': 'test:isolated', 'status': 'success'}] if self.extra_job else [])
                raise AssertionError(route)
            def call(self, method, route):
                return {'last_pipeline': {'id': 42, 'status': 'success'}}
        api = Reader()
        config = {'project_ids': [10,11]}
        state = {'user_id': 9, 'schedule_id': 3}
        baseline = dict(project_ids=[10,11], user_id=9, inventory=verification.inventory(api, [10,11]))
        self.assertEqual(verification.verify(api, config, state, baseline)['discovery'], 'dashboard-only')
        api.changed = True
        with self.assertRaisesRegex(ValueError, 'inventories changed'):
            verification.verify(api, config, state, baseline)
        api.changed = False; api.extra_job = True
        with self.assertRaisesRegex(ValueError, 'unexpected'):
            verification.verify(api, config, state, baseline)

if __name__ == '__main__': unittest.main()
