import { useI18n } from '../../../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, TextField } from '@mui/material';
type EnvironmentName = 'review' | 'beta';
type Environment = {
    enabled: boolean;
    host: string;
    domainMode: 2;
    ssl: string;
    sslKey: string;
};
type Settings = {
    review: Environment;
    beta: Environment;
};
const names: EnvironmentName[] = ['review', 'beta'];
const labels = {
    review: 'Review',
    beta: 'Beta'
};
const route = '/projects/wizard/environments';
const phaseText: {
    [key: string]: string;
} = {
    pending: 'Environment setup is reserved. Refresh status before reviewing a safe continuation.',
    'recipe-installed': 'The managed recipe is installed. Refresh status to verify setup.',
    'verification-failed': 'Environment setup could not be verified. Refresh status and review a fresh preview.',
    'requires-reconciliation': 'The update has an uncertain outcome. Refresh only. An administrator must inspect ' +
        'the recorded operation before any repair; do not start another update.',
    ready: 'The managed environment recipe is verified. Deploy and stop candidates using its manual GitLab jobs.'
};
function validSettings(settings: any): settings is Settings {
    return names.every(name => {
        const value = settings?.[name];
        return value && typeof value.enabled === 'boolean' && value.domainMode === 2 &&
            ['host', 'ssl', 'sslKey'].every(key => typeof value[key] === 'string');
    });
}
function copySettings(settings: Settings): Settings {
    return {
        review: { ...settings.review },
        beta: { ...settings.beta }
    };
}
function validatePreview(result: any) {
    if (!validSettings(result.settings) || !result.previewHash || !result.settingsHash ||
        typeof result.capabilities?.canActivate !== 'boolean' || typeof result.capabilities?.canUpdate !== 'boolean' ||
        result.capabilities.manualJobsOnly !== true || result.capabilities.productionDeployment !== false ||
        result.capabilities.reviewLease !== 'single-active-mr') {
        throw new Error('Environment preview is incomplete or unsupported. Refresh preview or update the controller.');
    }
}
export default function WizardEnvironmentsDialog(props: any) {
    const { t } = useI18n();
    const [preview, setPreview] = useState<any>();
    const [settings, setSettings] = useState<Settings>();
    const [environments, setEnvironments] = useState<any>();
    const [previewFresh, setPreviewFresh] = useState(false);
    const [mustRefreshStatus, setMustRefreshStatus] = useState(false);
    const [statusFailed, setStatusFailed] = useState(false);
    const [operation, setOperation] = useState('preview');
    const [message, setMessage] = useState('Loading environment preview…');
    const generation = useRef(0);
    const inFlight = useRef(false);
    useEffect(() => {
        const current = ++generation.current;
        setPreview(undefined);
        setSettings(undefined);
        setEnvironments(undefined);
        setPreviewFresh(false);
        setMustRefreshStatus(false);
        setStatusFailed(false);
        setOperation('preview');
        setMessage('Loading environment preview…');
        inFlight.current = true;
        props.sync.projectRequest(route).then((result: any) => {
            validatePreview(result);
            if (current === generation.current) {
                setPreview(result);
                setSettings(copySettings(result.settings));
                setEnvironments(result.environments);
                setPreviewFresh(true);
                setMessage(result.message || '');
            }
        }).catch((error: any) => {
            if (current === generation.current) {
                setMessage(error.response?.data?.message || error.message || 'Environment preview failed.');
            }
        }).finally(() => {
            if (current === generation.current) {
                setOperation('');
                inFlight.current = false;
            }
        });
        return () => { generation.current++; };
    }, [props.sync]);
    const request = async (action: string) => {
        if (inFlight.current)
            return;
        const current = generation.current;
        inFlight.current = true;
        setOperation(action);
        setPreviewFresh(false);
        setMessage(action === 'activate' ? 'Saving and verifying the environment recipe…' :
            'Refreshing environment information…');
        try {
            const result = action === 'activate'
                ? await props.sync.projectRequest(route, {
                    previewHash: preview.previewHash,
                    settings: settings && copySettings(settings)
                })
                : await props.sync.projectRequest(action === 'preview' ? route : route + '/status');
            if (action === 'preview')
                validatePreview(result);
            if (current === generation.current) {
                setEnvironments(result.environments);
                setStatusFailed(false);
                setMessage(result.message || '');
                if (action === 'preview') {
                    setPreview(result);
                    setSettings(copySettings(result.settings));
                    setPreviewFresh(true);
                }
                else {
                    if (validSettings(result.environments?.settings))
                        setSettings(copySettings(result.environments.settings));
                    if (action === 'status')
                        setMustRefreshStatus(result.environments?.phase === 'requires-reconciliation');
                }
            }
        }
        catch (error) {
            if (current === generation.current) {
                setStatusFailed(true);
                if (action === 'activate')
                    setMustRefreshStatus(true);
                setMessage(error.response?.data?.message || error.message || 'Environment verification failed.');
            }
        }
        finally {
            if (current === generation.current) {
                setOperation('');
                inFlight.current = false;
            }
        }
    };
    const busy = operation !== '';
    const reserved = !!environments;
    const uncertain = mustRefreshStatus || environments?.phase === 'requires-reconciliation';
    const editable = !busy && previewFresh && !uncertain && (!reserved || preview?.capabilities.canUpdate);
    const update = environments?.phase === 'ready';
    const changed = settings && preview && JSON.stringify(settings) !== JSON.stringify(preview.settings);
    const fieldsComplete = settings && names.every(name => !settings[name].enabled ||
        [settings[name].host, settings[name].ssl, settings[name].sslKey].every(value => !!value.trim()));
    const permitted = update ? preview?.capabilities.canUpdate && changed : preview?.capabilities.canActivate;
    const confirmEnabled = !busy && previewFresh && !uncertain && fieldsComplete && permitted;
    const change = (name: EnvironmentName, key: string, value: string | boolean) => {
        if (editable)
            setSettings(previous => previous && {
                ...previous,
                [name]: {
                    ...previous[name],
                    [key]: value
                }
            });
    };
    return <Dialog open fullWidth maxWidth="sm" onClose={operation === 'activate' ? undefined : props.onClose} aria-labelledby="wizard-environments-title">
    <DialogTitle id="wizard-environments-title">{t("Wizard Review and Beta environments")}</DialogTitle>
    <DialogContent>
      <DialogContentText>
        {t("Configure optional HTTPS environments for the verified Wizard candidate. Production stays configured under General. Each environment uses manual deploy and stop jobs in the local GitLab pipeline.")}</DialogContentText>
      <DialogContentText>
        {t("Review supports one active merge request at a time. Stop the current MR in GitLab before deploying a different MR to the same host. Stop active deployments before changing environment settings. Hostnames and certificate coverage must be verified; unavailable environments stay disabled.")}</DialogContentText>
      {environments && !statusFailed && <p role="status">{t(phaseText[environments.phase] ||
                'Environment recipe status is unavailable. Refresh status.')}</p>}
      {statusFailed && <p role="status">
        {t("Environment status is unverified. Refresh status and obtain a fresh preview.")}</p>}
      {mustRefreshStatus && <p role="status">
        {t("Refresh status before confirming another update. Do not retry an uncertain write.")}</p>}
      {preview?.capabilities.reasons?.length > 0 && <ul>{preview.capabilities.reasons.map((reason: string) => <li key={reason}>{t(reason)}</li>)}</ul>}
      {settings && names.map(name => <fieldset key={name} style={{ marginBottom: '1em' }}>
        <legend>{labels[name]}</legend>
        <FormControlLabel label={t('Enable ' + labels[name])} control={<Checkbox checked={settings[name].enabled} disabled={!editable} onChange={event => change(name, 'enabled', event.target.checked)} slotProps={{
                input: { 'aria-label': t('Enable ' + labels[name]) }
            }}/>}/>
        <TextField id={'wizard-' + name + '-host'} fullWidth margin="dense" label={t(labels[name] + ' host')} value={settings[name].host} disabled={!editable || !settings[name].enabled} onChange={event => change(name, 'host', event.target.value)}/>
        <TextField id={'wizard-' + name + '-ssl'} fullWidth margin="dense" label={t(labels[name] + ' HTTPS certificate path')} value={settings[name].ssl} disabled={!editable || !settings[name].enabled} onChange={event => change(name, 'ssl', event.target.value)}/>
        <TextField id={'wizard-' + name + '-ssl-key'} fullWidth margin="dense" label={t(labels[name] + ' HTTPS private key path')} value={settings[name].sslKey} disabled={!editable || !settings[name].enabled} onChange={event => change(name, 'sslKey', event.target.value)}/>
      </fieldset>)}
      {reserved && !editable && !busy && <p>
        {t("Saved settings are locked until a fresh preview confirms that an update is safe.")}</p>}
      {message && <p role="status">{t(message)}</p>}
    </DialogContent>
    <DialogActions>
      <Button disabled={operation === 'activate'} onClick={props.onClose}>{t("Close")}</Button>
      <Button disabled={busy} onClick={() => request('preview')}>{t("Refresh preview")}</Button>
      {preview && <Button disabled={busy} onClick={() => request('status')}>{t("Refresh status")}</Button>}
      {preview && <Button color="primary" disabled={!confirmEnabled} onClick={() => request('activate')}>
        {update ? t("Update environments") : reserved ? t("Resume environment setup") : t("Enable environments")}
      </Button>}
    </DialogActions>
  </Dialog>;
}
