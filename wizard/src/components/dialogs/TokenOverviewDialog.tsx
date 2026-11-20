import {useEffect, useState} from 'react';
import {runInAction} from 'mobx';
import {Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography} from '@mui/material';
import {useI18n} from '../../i18n';

const pathPattern = /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+$/;
const statusLabels: Record<string, string> = {valid: 'Expiry valid', expiring: 'Expiring soon', expired: 'Expired', revoked: 'Revoked', unknown: 'Unknown expiry'};
function parse(value: string, fallback: any) { try { return JSON.parse(value); } catch { return fallback; } }

export default function TokenOverviewDialog({main, onClose}: {main: any, onClose: () => void}) {
  const {t} = useI18n();
  const options = main.config.runtimeOptions;
  const [paths, setPaths] = useState(() => parse(options.SYSTEM_CREDENTIAL_PROJECT_PATHS || '[]', []).join('\n'));
  const [warning, setWarning] = useState(options.SYSTEM_CREDENTIAL_WARNING_DAYS || '14');
  const [recorded, setRecorded] = useState<Array<{projectPath: string, key: string, expiresAt: string}>>(() => parse(options.SYSTEM_CREDENTIAL_EXPIRY_METADATA || '[]', []));
  const [overview, setOverview] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    setBusy(true); setMessage('');
    try { setOverview(await main.sync.projectRequest('/operations/credentials')); }
    catch { setMessage('Credential metadata is unavailable. Check GitLab readiness and retry.'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let current = true;
    setBusy(true);
    main.sync.projectRequest('/operations/credentials').then((result: any) => { if (current) setOverview(result); })
      .catch(() => { if (current) setMessage('Credential metadata is unavailable. Check GitLab readiness and retry.'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [main.sync]);
  const save = () => {
    const projects = paths.split('\n').map((path: string) => path.trim()).filter(Boolean);
    if (projects.length > 8 || new Set(projects).size !== projects.length || projects.some((path: string) => !pathPattern.test(path) ||
        path.split('/').some(part => ['.', '..'].includes(part))) || !Number.isInteger(Number(warning)) || Number(warning) < 1 || Number(warning) > 90) {
      setMessage('Choose up to eight distinct project paths and a warning period between 1 and 90 days.'); return;
    }
    runInAction(() => {
      options.SYSTEM_CREDENTIAL_PROJECT_PATHS = JSON.stringify(projects);
      options.SYSTEM_CREDENTIAL_WARNING_DAYS = warning;
      options.SYSTEM_CREDENTIAL_EXPIRY_METADATA = JSON.stringify(recorded.filter(row => projects.includes(row.projectPath) && row.expiresAt));
    });
    setMessage('Monitoring settings are saved to the form. Use Backup and Push, then reconnect and refresh to apply them.');
  };
  const setDate = (row: any, value: string) => setRecorded(previous => [
    ...previous.filter(item => item.projectPath !== row.projectPath || item.key !== row.key),
    ...(value ? [{projectPath: row.projectPath, key: row.key, expiresAt: value}] : [])
  ]);
  return <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="credential-overview-title">
    <DialogTitle id="credential-overview-title">{t('Credential expiry')}</DialogTitle>
    <DialogContent>
      <Stack spacing={2} sx={{pt: 1}}>
        <Alert severity="info">{t('Expiry status does not verify permissions or current authentication. Secret values stay on the server.')}</Alert>
        <TextField label={t('GitLab automation project paths')} value={paths} multiline minRows={2}
          helperText={t('Enter one namespace/project path per line. Only these projects are inspected.')}
          onChange={event => setPaths(event.target.value)}/>
        <TextField label={t('Warn before expiry (days)')} type="number" value={warning} onChange={event => setWarning(event.target.value)}
          slotProps={{htmlInput: {min: 1, max: 90}}}/>
        <Button onClick={save}>{t('Save monitoring settings to form')}</Button>
        {message && <Alert role="status" severity="info">{t(message)}</Alert>}
        {busy && <Typography role="status">{t('Loading credential metadata…')}</Typography>}
        {overview && <>
          {!overview.projects?.length && <Alert severity="info">{t('No automation projects are selected in the saved server configuration.')}</Alert>}
          <Typography variant="body2">{t('Metadata is cached for up to five minutes. Observed at:')} {overview.observedAt}</Typography>
          {overview.credentials?.map((row: any) => <Box key={row.projectPath + ':' + row.key} sx={{border: 1, borderColor: 'divider', borderRadius: 1, p: 2}}>
            <Stack direction="row" spacing={1} sx={{alignItems: 'center', flexWrap: 'wrap'}}>
              <Typography component="h3" variant="subtitle1">{t(row.purpose)}</Typography>
              <Chip size="small" label={t(statusLabels[row.status] || 'Unknown expiry')}
                color={row.status === 'valid' ? 'success' : row.status === 'expiring' ? 'warning' : ['expired', 'revoked'].includes(row.status) ? 'error' : 'default'}/>
            </Stack>
            <Typography variant="body2">{row.projectPath} · {row.provider}</Typography>
            <Typography variant="body2">{t('Expiry date:')} {row.expiresAt || t('Unknown expiry')}</Typography>
            {typeof row.daysRemaining === 'number' && <Typography variant="body2">{t('Days remaining:')} {row.daysRemaining}</Typography>}
            {!row.configured && <Typography variant="body2">{t('No configured credential was observed for this project and purpose.')}</Typography>}
            <Typography variant="body2">{t(row.expirySource === 'gitlab' ? 'Source: local GitLab token metadata.' : row.expirySource === 'operator-recorded' ?
              'Source: operator-recorded date; the current external credential has not been verified.' : 'The provider or current permissions do not expose an expiry date.')}</Typography>
            {['GitHub', 'Docker Hub'].includes(row.provider) && <TextField sx={{mt: 1}} type="date" label={t('Record external expiry date (optional)')}
              value={recorded.find(item => item.projectPath === row.projectPath && item.key === row.key)?.expiresAt || ''}
              slotProps={{inputLabel: {shrink: true}}} onChange={event => setDate(row, event.target.value)}/>}
            <Button component="a" href={row.renewalGuide}>{t('Renewal instructions')}</Button>
          </Box>)}
        </>}
      </Stack>
    </DialogContent>
    <DialogActions><Button disabled={busy} onClick={load}>{t('Refresh metadata')}</Button><Button onClick={onClose}>{t('Close')}</Button></DialogActions>
  </Dialog>;
}
