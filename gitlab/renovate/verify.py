#!/usr/bin/env python3
"""Record/compare first-discovery inventories without changing GitLab state."""
import argparse
import importlib.util
import json
from pathlib import Path
spec = importlib.util.spec_from_file_location('renovate_setup', Path(__file__).with_name('setup.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

def inventory(api, project_ids):
    return {str(pid): {'branches': sorted(row['name'] for row in api.all(f'/projects/{pid}/repository/branches')),
                      'merge_requests': sorted(row['iid'] for row in api.all(f'/projects/{pid}/merge_requests?state=all'))}
            for pid in project_ids}

def verify(api, config, state, baseline):
    if baseline['project_ids'] != config['project_ids'] or baseline['user_id'] != state['user_id']:
        raise ValueError('Baseline belongs to another bot/project selection')
    if inventory(api, config['project_ids']) != baseline['inventory']:
        raise ValueError('Branch or MR inventories changed; investigate before approving anything')
    dashboards = []
    for pid in config['project_ids']:
        issues = api.all(f'/projects/{pid}/issues?state=opened&search=Dependency%20Dashboard')
        matching = [i for i in issues if i['title'] == 'Dependency Dashboard' and i['author']['id'] == state['user_id']]
        if len(matching) != 1:
            raise ValueError('Expected exactly one bot-owned open Dashboard in each source project')
        dashboards.append({'project_id': pid, 'issue_iid': matching[0]['iid']})
    pid = config['project_ids'][0]
    schedule = api.call('GET', f"/projects/{pid}/pipeline_schedules/{state['schedule_id']}")
    pipeline = schedule.get('last_pipeline')
    if not pipeline or pipeline['status'] != 'success':
        raise ValueError('Owned schedule has no successful latest discovery pipeline')
    jobs = api.all(f"/projects/{pid}/pipelines/{pipeline['id']}/jobs")
    if not jobs or any(j['name'] != 'renovate:discover' or j['status'] != 'success' for j in jobs):
        raise ValueError('Scheduled pipeline selected unexpected or unsuccessful jobs')
    return {'discovery': 'dashboard-only', 'dashboards': dashboards, 'scheduled_jobs': ['renovate:discover']}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    config = setup.private_json(args.config)
    state = setup.private_json(config['state_file'])
    api = setup.API(config['endpoint'], state['token'])
    baseline = Path(args.baseline)
    if args.verify:
        print(json.dumps(verify(api, config, state, setup.private_json(baseline))))
    else:
        if baseline.exists():
            raise ValueError('Baseline exists; use a new path instead of overwriting evidence')
        setup.save(baseline, {'project_ids': config['project_ids'], 'user_id': state['user_id'],
                              'inventory': inventory(api, config['project_ids'])})
        print('Saved private first-discovery inventory; run the owned schedule before --verify.')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        raise SystemExit(str(error))
