import {useEffect, useRef, useState} from 'react';
import {Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, MenuItem, TextField, Typography} from '@mui/material';
import Main from '../../../api/Main';
import {newPreviewSetupIntent, previewSetupIntent, type PreviewSetupIntent, type PreviewSource} from '../../../api/PreviewSetupIntent';
import {useI18n} from '../../../i18n';
const route = '/projects/wizard/preview-setup';
export default function PreviewSetupDialog({main, close}: {main: Main; close: () => void}) {
  const {t} = useI18n();
  const [settings, setSettings] = useState<PreviewSetupIntent>(() => previewSetupIntent(main.previewSetup) || newPreviewSetupIntent());
  const [namespaces, setNamespaces] = useState<{path: string}[]>([]);
  const [status, setStatus] = useState<any>();
  const [plan, setPlan] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void Promise.all([main.sync.projectRequest(route), main.sync.projectRequest('/projects/namespaces')]).then(([result, spaces]) => {
      if (!mounted.current) return;
      setStatus(result); setNamespaces(spaces.namespaces || []);
      const saved = previewSetupIntent(result.settings);
      if (saved) setSettings(saved);
    }).catch(error => { if (mounted.current) setMessage(error.message); });
    return () => { mounted.current = false; };
  }, [main]);
  const update = (next: PreviewSetupIntent) => { setSettings(next); setPlan(undefined); setMessage(''); };
  const save = () => { const desired = previewSetupIntent(settings); if (!desired) {setMessage('Review the desired setup settings.'); return;} main.previewSetup = desired; setMessage('Desired settings saved for the next JSON/ZIP backup. Setup has not started.'); };
  const request = async (action: 'preflight' | 'apply') => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const desired = previewSetupIntent(settings);
      if (!desired) throw Error('Review the desired setup settings.');
      const result = await main.sync.projectRequest(route + '/' + action, {settings: desired, ...(action === 'apply' ? {previewHash: plan?.previewHash} : {})});
      if (!mounted.current) return;
      main.previewSetup = desired;
      if (action === 'preflight') setPlan(result); else {setStatus(result); setPlan(undefined);}
      setMessage(result.message || '');
    } catch (error: any) { if (mounted.current) {setPlan(undefined); setMessage(error.response?.data?.message || error.message);} }
    finally { if (mounted.current) setBusy(false); }
  };
  const project = (kind: 'wizard' | 'system', label: string) => {
    const selected = settings[kind]; if (!selected) return null;
    const change = (patch: Partial<PreviewSource>) => update({...settings, [kind]: {...selected, ...patch}});
    return <Box sx={{my: 2}} key={kind}>
      <Typography variant="subtitle1">{t(label)}</Typography>
      <TextField select fullWidth margin="dense" label={t('Source selection')} value={selected.mode} disabled={busy} onChange={event => change({mode: event.target.value as PreviewSource['mode'], origin: ''})}>
        <MenuItem value="import">{t('Import upstream or fork into a new private project')}</MenuItem><MenuItem value="existing">{t('Use an existing private source project')}</MenuItem>
      </TextField>
      <TextField fullWidth margin="dense" label={t('Project name in the selected namespace')} value={selected.project} disabled={busy} onChange={event => change({project: event.target.value})}/>
      {selected.mode === 'import' && <TextField fullWidth margin="dense" label={t('Public HTTPS Git origin ending in .git')} value={selected.origin} disabled={busy} onChange={event => change({origin: event.target.value})}/>}
    </Box>;
  };
  return <Dialog open fullWidth maxWidth="md" onClose={busy ? undefined : close}>
    <DialogTitle>{t('Set up development previews')}</DialogTitle>
    <DialogContent>
      <DialogContentText>{t('Optional after Quickstart: prepare GitLab, its registry, an online Docker runner, DNS and exact-host HTTPS certificates first. Production keeps its accepted public release. Native source, build and browser checks take additional time.')}</DialogContentText>
      {status?.phase && <Typography sx={{my: 1}}>{t('Setup status')}: {status.phase}</Typography>}
      <TextField select fullWidth margin="dense" label={t('GitLab namespace')} value={settings.namespace} disabled={busy} onChange={event => update({...settings, namespace: event.target.value})}>
        <MenuItem value="">{t('Select a namespace')}</MenuItem>{namespaces.map(item => <MenuItem key={item.path} value={item.path}>{item.path}</MenuItem>)}
      </TextField>
      {project('wizard', 'Canonical Wizard source project')}
      <FormControlLabel control={<Checkbox checked={!!settings.system} disabled={busy} onChange={event => update({...settings, system: event.target.checked ? {mode: 'existing', project: 'system', origin: ''} : undefined})}/>} label={t('Enable the existing System merge-request Wizard preview integration')}/>
      {project('system', 'System source project')}
      {(['review', 'beta'] as const).map(name => <Box key={name} sx={{my: 2}}>
        <FormControlLabel control={<Checkbox checked={settings[name].enabled} disabled={busy || name === 'review'} onChange={event => update({...settings, [name]: {...settings[name], enabled: event.target.checked}})}/>} label={name === 'review' ? t('Review (one explicitly leased HTTPS host)') : t('Enable optional Beta')}/>
        {settings[name].enabled && (['host', 'ssl', 'sslKey'] as const).map((key, index) => <TextField key={key} fullWidth margin="dense" label={t(['Exact HTTPS hostname', 'Certificate path under /ssl', 'Private key path under /ssl'][index])} value={settings[name][key]} disabled={busy} onChange={event => update({...settings, [name]: {...settings[name], [key]: event.target.value}})}/>)}
      </Box>)}
      <Alert severity="info">{t('Saved settings contain intent only. Opening or fetching a backup never creates projects, starts pipelines or deploys environments. Deploy and Stop remain explicit native GitLab jobs; Production promotion is separate.')}</Alert>
      {plan && <Alert severity="success" sx={{mt: 2}}>{t('Preflight passed. Confirm the selected projects and hosts to start or resume native setup.')}</Alert>}
      {message && <Alert severity="info" sx={{mt: 2}} role="status">{t(message)}</Alert>}
      {status?.previewUrl && <Typography sx={{mt: 2}}><a href={status.previewUrl} target="_blank" rel="noreferrer">{t('Reserved Review URL')}</a> — {t('Available after a successful manual deployment.')}</Typography>}
      {status?.pipeline?.webUrl && <Typography><a href={status.pipeline.webUrl} target="_blank" rel="noreferrer">{t('Open native pipeline')}</a></Typography>}
    </DialogContent>
    <DialogActions>
      <Button onClick={close} disabled={busy}>{t('Close')}</Button>
      <Button onClick={save} disabled={busy}>{t('Save desired settings')}</Button>
      <Button onClick={() => void request('preflight')} disabled={busy || !settings.namespace}>{t('Check prerequisites')}</Button>
      <Button variant="contained" onClick={() => void request('apply')} disabled={busy || !plan}>{busy ? t('Setup is running…') : t('Confirm setup / resume')}</Button>
    </DialogActions>
  </Dialog>;
}
