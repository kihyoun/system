import React, {useEffect, useRef, useState} from 'react';
import {Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography} from '@mui/material';
import {useI18n} from '../../i18n';

export interface DiagnosticTargets {
    registry: string;
    helper: string;
    helperImage: string;
    runners: string[];
    context: string;
}
export interface DiagnosticConnection {
    target: string;
    context: string;
    steps: {name: string; status: string; durationMs: number; code: string; detail: string}[];
}
export interface DiagnosticPull {
    runner: string;
    image: string;
    context: string;
    authentication: string;
    durationMs: number;
    success: boolean;
    code: string;
    detail: string;
}
export interface SystemDiagnosticsDialogProps {
    open: boolean;
    onClose: () => void;
    loadTargets: () => Promise<DiagnosticTargets>;
    checkConnection: (target: 'registry' | 'helper') => Promise<DiagnosticConnection>;
    tryHelperPull: (runner: string) => Promise<DiagnosticPull>;
}
function failureMessage(error: unknown): string {
    const status = (error as {response?: {status?: number}})?.response?.status;
    if (status === 409) return 'Diagnostics are blocked while maintenance is in progress or runner configuration has changed. Review the server state before retrying.';
    if (status === 429) return 'Diagnostics are busy. Wait for the current checks before retrying.';
    return 'Diagnostics are unavailable. Check the Sync connection, authentication and server configuration.';
}
export default function SystemDiagnosticsDialog(props: SystemDiagnosticsDialogProps) {
    const {t} = useI18n();
    const [targets, setTargets] = useState<DiagnosticTargets>();
    const [target, setTarget] = useState<'registry' | 'helper'>('registry');
    const [runner, setRunner] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [connection, setConnection] = useState<DiagnosticConnection>();
    const [pull, setPull] = useState<DiagnosticPull>();
    const generation = useRef(0);
    const loadTargets = useRef(props.loadTargets);
    loadTargets.current = props.loadTargets;
    useEffect(() => {
        const current = ++generation.current;
        setTargets(undefined); setConnection(undefined); setPull(undefined); setError(''); setRunner('');
        if (!props.open) return;
        setBusy(true);
        loadTargets.current().then(value => {
            if (generation.current !== current) return;
            setTargets(value); setRunner(value.runners[0] || '');
        }).catch(error => {
            if (generation.current === current) setError(failureMessage(error));
        }).finally(() => { if (generation.current === current) setBusy(false); });
        return () => { generation.current++; };
    }, [props.open]);
    const run = async (action: 'connection' | 'pull') => {
        if (busy || !targets) return;
        const current = generation.current;
        setBusy(true); setError('');
        if (action === 'connection') setConnection(undefined); else setPull(undefined);
        try {
            if (action === 'connection') {
                const result = await props.checkConnection(target);
                if (current === generation.current) setConnection(result);
            } else {
                const result = await props.tryHelperPull(runner);
                if (current === generation.current) setPull(result);
            }
        } catch (error) {
            if (current === generation.current) setError(failureMessage(error));
        } finally { if (current === generation.current) setBusy(false); }
    };
    return <Dialog open={props.open} fullWidth maxWidth="md" onClose={() => { if (!busy) props.onClose(); }} aria-labelledby="system-diagnostics-title">
        <DialogTitle id="system-diagnostics-title">{t('System diagnostics')}</DialogTitle>
        <DialogContent><Stack spacing={2}>
            <Typography>{t('Checks run only when you press a button. No pipeline, restart or configuration change is started.')}</Typography>
            {error && <Alert severity="error">{t(error)}</Alert>}
            {busy && <Typography role="status">{t('Diagnostics in progress…')}</Typography>}
            {targets && <>
                <Typography>{t(targets.context)}</Typography>
                <FormControl fullWidth><InputLabel id="diagnostic-target-label">{t('Registry target')}</InputLabel>
                    <Select labelId="diagnostic-target-label" label={t('Registry target')} value={target} disabled={busy}
                        onChange={event => { setTarget(event.target.value as 'registry' | 'helper'); setConnection(undefined); }}>
                        <MenuItem value="registry">{t('Configured GitLab registry')}: {targets.registry}</MenuItem>
                        <MenuItem value="helper">{t('Helper-image registry')}: {targets.helper}</MenuItem>
                    </Select>
                </FormControl>
                <Button variant="contained" disabled={busy} onClick={() => void run('connection')}>{t('Check connection')}</Button>
                <Alert severity="info">{t('HTTP 401 with an authentication challenge proves endpoint reachability. It does not verify credentials, authorization or an image digest.')}</Alert>
                {connection && <Stack spacing={1}>
                    <Typography>{connection.target} — {t(connection.context)}</Typography>
                    <Table aria-label={t('Connection check results')}><TableHead><TableRow>
                        {['Check', 'Result', 'Duration', 'Details'].map(label => <TableCell key={label}>{t(label)}</TableCell>)}
                    </TableRow></TableHead><TableBody>{connection.steps.map(step => <TableRow key={step.name}>
                        <TableCell>{t(step.name)}</TableCell><TableCell>{t(step.status)} ({step.code})</TableCell>
                        <TableCell>{step.durationMs} ms</TableCell><TableCell>{t(step.detail)}</TableCell>
                    </TableRow>)}</TableBody></Table>
                </Stack>}
                <Typography variant="h6">{t('Helper-image pull')}</Typography>
                <Typography sx={{overflowWrap: 'anywhere'}}>{targets.helperImage}</Typography>
                <Typography>{t('The pull uses anonymous registry access through the selected runner’s verified host Docker socket. Runner-specific credentials and remote Docker hosts are not supported.')}</Typography>
                <Alert severity="warning">{t('Try helper-image pull may download layers and use disk/cache space on the selected runner’s Docker daemon. It does not prune or delete images. A timeout may leave a daemon pull running.')}</Alert>
                {targets.runners.length > 0 ? <FormControl fullWidth><InputLabel id="diagnostic-runner-label">{t('Runner manager')}</InputLabel>
                    <Select labelId="diagnostic-runner-label" label={t('Runner manager')} value={runner} disabled={busy}
                        onChange={event => { setRunner(event.target.value); setPull(undefined); }}>
                        {targets.runners.map(name => <MenuItem value={name} key={name}>{name}</MenuItem>)}
                    </Select>
                </FormControl> : <Typography>{t('No configured running runner manager is available. The controller connection check remains available.')}</Typography>}
                <Button variant="outlined" disabled={busy || !runner} onClick={() => void run('pull')}>{t('Try helper-image pull')}</Button>
                {pull && <Alert severity={pull.success ? 'success' : 'error'}>
                    <Typography>{pull.runner}: {pull.code} ({pull.durationMs} ms)</Typography>
                    <Typography sx={{overflowWrap: 'anywhere'}}>{pull.image}</Typography>
                    <Typography>{t(pull.context)}</Typography><Typography>{t(pull.authentication)}</Typography><Typography>{t(pull.detail)}</Typography>
                </Alert>}
            </>}
        </Stack></DialogContent>
        <DialogActions><Button disabled={busy} onClick={props.onClose}>{t('Close')}</Button></DialogActions>
    </Dialog>;
}
