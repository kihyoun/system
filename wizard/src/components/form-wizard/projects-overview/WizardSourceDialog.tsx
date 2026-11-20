import { useI18n } from '../../../i18n';
import React, { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
export default function WizardSourceDialog(props: any) {
    const { t } = useI18n();
    const [preview, setPreview] = useState<any>();
    const [busy, setBusy] = useState(true);
    const [importing, setImporting] = useState(false);
    const [message, setMessage] = useState('Loading source preview…');
    const [complete, setComplete] = useState(false);
    useEffect(() => {
        let active = true;
        props.sync.projectRequest('/projects/wizard/source').then((result: any) => {
            if (active) {
                setPreview(result);
                setMessage('');
                setBusy(false);
            }
        }).catch((error: any) => {
            if (active) {
                setMessage(error.response?.data?.message || error.message || 'Source preview failed.');
                setBusy(false);
            }
        });
        return () => { active = false; };
    }, [props.sync]);
    const initialize = async () => {
        if (preview?.mode === 'source-primary' || preview?.canInitialize === false)
            return;
        setBusy(true);
        setImporting(true);
        setMessage('Importing source. Keep this dialog open while the operation completes.');
        try {
            const result = await props.sync.projectRequest('/projects/wizard/source', { manifestHash: preview.manifestHash });
            setMessage(result.message);
            setComplete(true);
        }
        catch (error) {
            setMessage(error.response?.data?.message || error.message ||
                'Source import failed. Close and preview again to retry.');
        }
        finally {
            setBusy(false);
            setImporting(false);
        }
    };
    const sourcePrimary = preview?.mode === 'source-primary' || preview?.canInitialize === false;
    const repositoryUrl = /^https?:\/\//i.test(preview?.repository?.webUrl || '') ? preview.repository.webUrl : undefined;
    return <Dialog open onClose={importing ? undefined : props.onClose} aria-labelledby="wizard-source-title">
    <DialogTitle id="wizard-source-title">{sourcePrimary ? t("Wizard source repository") : t("Initialize Wizard source")}</DialogTitle>
    <DialogContent>
      {sourcePrimary ? <DialogContentText>
        {t("Develop, review and build the Wizard in this canonical repository. No source import or extra repository is required. Production promotion stays explicit.")}</DialogContentText> : <><DialogContentText>
        {t("The existing private Wizard repository receives the source pinned by this System version. Its README is preserved; the source README is stored separately. Occupied or edited source files are never overwritten.")}</DialogContentText>
      <DialogContentText>
        {t("This imports source only. It does not start a build or deploy Production. The running Wizard stays available; Beta and Review remain disabled.")}</DialogContentText></>}
      {preview && <DialogContentText>
        {t("Repository:")}{' '}{preview.repository.path}<br />{t("Source revision:")}{' '}{preview.sourceRevision}<br />
        {!sourcePrimary && <>{t("Files:")}{' '}{preview.fileCount}</>}
      </DialogContentText>}
      {sourcePrimary && repositoryUrl && <p><a href={repositoryUrl} target="_blank" rel="noopener noreferrer">{t("Open source repository")}</a></p>}
      {message && <p role="status">{t(message)}</p>}
    </DialogContent>
    <DialogActions>
      <Button disabled={importing} onClick={props.onClose}>{t("Close")}</Button>
      {!sourcePrimary && !complete && <Button color="primary" disabled={busy || !preview} onClick={initialize}>{t("Import source")}</Button>}
    </DialogActions>
  </Dialog>;
}
