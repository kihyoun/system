import {useI18n} from '../../i18n';
import React, {useEffect, useState} from 'react';
import Button from '@mui/material/Button';
import PublishIcon from '@mui/icons-material/Publish';
import {Alert, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle} from '@mui/material';
export default function PushDialog(props: any) {
  const {t} = useI18n();
  const [impact, setImpact] = useState<any>(null);
  const [error, setError] = useState('');
  const [pushing, setPushing] = useState(false);
  useEffect(() => {
    let current = true;
    setImpact(null); setError(''); setPushing(false);
    if (props.open) props.main.sync.pushImpact().then((result: any) => {
      if (current) setImpact(result);
    }).catch((failure: any) => {
      if (current) setError(failure.response?.data?.message || 'Could not verify Push impact. Fetch and review configuration before retrying.');
    });
    return () => { current = false; };
  }, [props.open, props.main]);
  const notice = !impact ? 'Checking configuration changes…' : impact.mode === 'routing'
    ? 'Only application routing will be applied. GitLab stays available; affected application routes reload briefly.'
    : impact.mode === 'none' ? 'No service changes detected. Configuration will be saved without a restart.'
      : 'This Push restarts the platform, including GitLab. The Wizard and application routes will be temporarily unavailable. Keep a current configuration Backup before continuing.';
  return <Dialog transitionDuration={0} fullWidth maxWidth="sm" open={props.open} onClose={() => props.setOpen(false)} aria-labelledby="push-impact-title">
    <DialogTitle id="push-impact-title">{t('Review Push impact')}</DialogTitle>
    <DialogContent>
      <DialogContentText>{t('Push replaces the saved configuration. Review the expected service impact and keep a private configuration Backup.')}</DialogContentText>
      <Alert severity={error || impact?.mode === 'restart' ? 'warning' : 'info'} sx={{mt: 2}}>{t(error || notice)}</Alert>
      {!!impact?.projects?.length && <p>{impact.projects.join(', ')}</p>}
    </DialogContent>
    <DialogActions>
      <Button disabled={!impact || !!error || pushing} disableElevation variant="contained" onClick={() => { setPushing(true); props.handlePush(impact.fingerprint); }} color="secondary" startIcon={<PublishIcon/>}>{t('Push')}</Button>
      <Button onClick={() => props.setOpen(false)} color="primary" autoFocus>{t('Close')}</Button>
    </DialogActions>
  </Dialog>;
}
