"""Acceptance test for a disposable local GitLab; creates a private CI test project."""
import hashlib,json,re,shlex,subprocess,time,urllib.request,urllib.error
from pathlib import Path

def docker(*args):
    return subprocess.check_output(['docker',*args],text=True,stderr=subprocess.DEVNULL)
def api(path,token,payload=None,method=None,host='gitlab.localhost'):
    req=urllib.request.Request('http://127.0.0.1/'+path,data=json.dumps(payload).encode() if payload is not None else None,headers={'Host':host,'PRIVATE-TOKEN':token,'Content-Type':'application/json'},method=method)
    with urllib.request.urlopen(req,timeout=60) as response:
        raw=response.read()
        return json.loads(raw) if raw else None
for attempt in range(120):
    try:
        config=docker('exec','system_bootstrapper_1','cat','/system/system/.docker.env')
        if re.search(r"^GITLAB_RUNNER_TOKEN=['\"]?glrt-",config,re.M):
            api('api/v4/version','invalid')
    except urllib.error.HTTPError as e:
        if e.code==401: break
    except Exception: pass
    if attempt%12==0: print('Waiting for configured GitLab, Sync and runner registration...',flush=True)
    time.sleep(5)
else: raise SystemExit('Instance did not become ready')
print('Runner registration completed; creating a temporary test API credential.',flush=True)
ruby="u=User.find_by_username('root'); t=u.personal_access_tokens.create!(name: 'runner-local-acceptance', scopes: ['api'], expires_at: Date.tomorrow); puts JSON.generate(token: t.token, setup_active: u.personal_access_tokens.where(name: 'system-bootstrapper-runner-setup', revoked: false).count, pool_count: Ci::Runner.instance_type.where(description: 'System Bootstrapper Docker pool').count)"
raw=docker('exec','system_gitlab_1','gitlab-rails','runner',ruby)
state=json.loads(raw.strip().splitlines()[-1]); token=state['token']
try:
    assert state['setup_active']==0,'Setup credential was not revoked'
    assert state['pool_count']==1,'Duplicate managed runner pools'
    runners=api('api/v4/runners/all',token)
    pool=next(r for r in runners if r['description']=='System Bootstrapper Docker pool')
    assert pool['runner_type']=='instance_type'
    runner_id=pool['id']
    details=api(f'api/v4/runners/{runner_id}',token)
    assert details['status']=='online',details['status']
    print('PASS: one online instance runner; no active setup token.',flush=True)
    values={}
    for line in config.splitlines():
        m=re.match(r'(?:export )?([A-Z_]+)=(.*)$',line)
        if m: values[m[1]]=shlex.split(m[2])[0] if shlex.split(m[2]) else ''
    login=api('login','',{'username':values['SYNC_USER'],'password':values['SYNC_PASS']},host='sync.localhost')
    req=urllib.request.Request('http://127.0.0.1/config/main',headers={'Host':'sync.localhost','Authorization':'Bearer '+login['accessToken']})
    with urllib.request.urlopen(req) as response: fetched=json.load(response)['data']
    assert fetched[807]=='$', 'Fetched configuration has an altered signature marker'
    assert hashlib.md5(fetched[:1184].encode()).hexdigest()=='bd4a8426355824593a5e21ad759830c1', 'Fetched configuration signature differs from the original'
    assert values['GITLAB_RUNNER_TOKEN'] in fetched
    assert not token in fetched
    print('PASS: authenticated Fetch contains runner token, no test admin token.',flush=True)
    project=api('api/v4/projects',token,{'name':'runner-automation-smoke-'+str(int(time.time())),'visibility':'private','initialize_with_readme':True})
    project_id=project['id']; branch=project['default_branch'] or 'main'
    pipeline='''stages: [test]
runner-smoke:
  image: alpine:3.22
  tags: [docker]
  script:
    - echo runner-automation-ok > runner-result.txt
    - test -n "$CI_RUNNER_ID"
  artifacts:
    paths: [runner-result.txt]
'''
    api(f'api/v4/projects/{project_id}/repository/files/.gitlab-ci.yml',token,{'branch':branch,'content':pipeline,'commit_message':'Verify automatically registered instance runner'})
    for attempt in range(90):
        pipelines=api(f'api/v4/projects/{project_id}/pipelines',token)
        if pipelines:
            status=pipelines[0]['status']
            if status=='success': break
            if status in ('failed','canceled','skipped'): raise AssertionError('Pipeline '+status)
        if attempt%12==0: print('Waiting for real GitLab pipeline job...',flush=True)
        time.sleep(5)
    else: raise AssertionError('Pipeline timeout')
    jobs=api(f'api/v4/projects/{project_id}/pipelines/{pipelines[0]["id"]}/jobs',token)
    assert jobs[0]['runner']['id']==runner_id
    assert jobs[0]['status']=='success'
    req=urllib.request.Request(f'http://127.0.0.1/api/v4/projects/{project_id}/jobs/{jobs[0]["id"]}/artifacts/runner-result.txt',headers={'Host':'gitlab.localhost','PRIVATE-TOKEN':token})
    with urllib.request.urlopen(req) as response: assert response.read().strip()==b'runner-automation-ok'
    print('PASS: real pipeline job ran successfully on the automatically registered runner, including clone and artifact upload.',flush=True)
    print('Smoke project: '+project['web_url'],flush=True)
finally:
    api('api/v4/personal_access_tokens/self',token,method='DELETE')
    try: api('api/v4/user',token)
    except urllib.error.HTTPError as e: assert e.code==401
    else: raise AssertionError('Test API credential still valid')
    print('PASS: temporary test API credential revoked.',flush=True)
