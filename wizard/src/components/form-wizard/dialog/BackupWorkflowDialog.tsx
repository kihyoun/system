import {useEffect, useState} from 'react';
import {Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle} from '@mui/material';
import {saveAs} from 'file-saver';
import {useTranslation} from 'react-i18next';
import {backupText} from '../../../i18n/backupWorkflow';

/** The connector owns authentication; only this server-produced ZIP is saved. */
export default function BackupWorkflowDialog({sync, onClose}: any) {
  const {i18n} = useTranslation();
  const text = (key: string) => backupText(i18n.resolvedLanguage || i18n.language || 'en', key);
  const [result, setResult] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let id: string | null = null;
    try {id = sessionStorage.getItem('system-coordinated-backup');} catch { /* Storage may be disabled. */ }
    if (id && /^[a-f0-9]{32}$/.test(id)) sync.diagnosticRequest('/backup/' + id).then(setResult).catch(() => undefined);
  }, [sync]);
  const request = async (start: boolean) => {
    setBusy(true); setError('');
    try {
      const status = await sync.diagnosticRequest(start ? '/command/backup' : '/backup/' + result.id, start ? {} : undefined);
      setResult(status);
      try {sessionStorage.setItem('system-coordinated-backup', status.id);} catch { /* Current dialog still keeps its operation. */ }
      if (start) {setDownloaded(false);setSaved(false);}
    } catch {setError('failed');}
    finally {setBusy(false);}
  };
  const download = async () => {
    setBusy(true); setError(''); setDownloaded(false); setSaved(false);
    try {
      const blob: Blob = await sync.downloadBackup(result.id);
      if (!blob.size) throw Error('empty-download');
      if (globalThis.crypto?.subtle) {
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(value => value.toString(16).padStart(2, '0')).join('');
        if (hash !== result.configuration.sha256) throw Error('download-checksum-mismatch');
      }
      saveAs(blob, 'bootstrapper.zip'); setDownloaded(true);
    } catch {setError('downloadFailed');}
    finally {setBusy(false);}
  };
  const working = result?.state === 'working';
  return <Dialog open onClose={onClose} aria-labelledby="backup-workflow-title">
    <DialogTitle id="backup-workflow-title">{text('title')}</DialogTitle>
    <DialogContent>
      <DialogContentText>{text('introduction')}</DialogContentText>
      {result && <Alert severity={saved ? 'success' : ['failed', 'partial', 'interrupted'].includes(result.state) ? 'warning' : 'info'}>
        {text(saved ? 'complete' : result.state)}
        {working && <p>{result.phase}</p>}
      </Alert>}
      {result?.seed && <p>{text('seed')} <code>{result.seed.location || result.seed.manifest?.replace(/\/manifest\.json$/, '')}</code></p>}
      {result?.configuration?.sha256 && <p>{text('checksum')} <code>{result.configuration.sha256}</code></p>}
      {result?.error && <p role="status">{result.error}</p>}
      {result && !working && <p>{text('detach')}</p>}
      {error && <Alert severity="error">{text(error)}</Alert>}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>{text('close')}</Button>
      {result && <Button disabled={busy} onClick={() => request(false)}>{text('refresh')}</Button>}
      {result?.state === 'ready' && <Button disabled={busy} onClick={download}>{text('download')}</Button>}
      {downloaded && !saved && <Button disabled={busy} onClick={() => setSaved(true)}>{text('saved')}</Button>}
      {!working && result?.state !== 'interrupted' && <Button disabled={busy} onClick={() => request(true)}>{text('start')}</Button>}
    </DialogActions>
  </Dialog>;
}
