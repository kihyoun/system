import { useI18n } from '../../../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
const phases: {
    [key: string]: string;
} = {
    pending: 'Build activation is reserved. Refresh status, or review a fresh preview before resuming.',
    'recipe-installed': 'The recipe is installed. Refresh status, or review a fresh preview before resuming.',
    'pipeline-running': 'The pipeline is in progress. Refresh status to update its checks.',
    'checks-failed': 'Required checks did not pass. Inspect the pipeline and refresh after retrying jobs ' +
        'in GitLab.',
    'candidate-verified': 'Candidate checks and the immutable artifact are verified. Production is unchanged.',
    'requires-reconciliation': 'Pipeline creation has an uncertain outcome. Refresh only. ' +
        'An administrator must inspect the recorded operation and GitLab before repair. ' +
        'Do not clear the checkpoint or activate again.',
    'verification-failed': 'Build status could not be verified. Previous artifact claims are hidden. ' +
        'Refresh status or review a fresh preview before resuming. Server ownership and pipeline checkpoints still apply.'
};
export default function WizardBuildDialog(props: any) {
    const { t } = useI18n();
    const [preview, setPreview] = useState<any>();
    const [build, setBuild] = useState<any>();
    const [previewFresh, setPreviewFresh] = useState(false);
    const [operation, setOperation] = useState('preview');
    const [message, setMessage] = useState('Loading build preview…');
    const generation = useRef(0);
    useEffect(() => {
        const current = ++generation.current;
        setPreview(undefined);
        setBuild(undefined);
        setPreviewFresh(false);
        setOperation('preview');
        setMessage('Loading build preview…');
        props.sync.projectRequest('/projects/wizard/build').then((result: any) => {
            if (current === generation.current) {
                setPreview(result);
                setBuild(result.build);
                setPreviewFresh(true);
                setMessage('');
                setOperation('');
            }
        }).catch((error: any) => {
            if (current === generation.current) {
                setMessage(error.response?.data?.message || error.message || 'Build preview failed.');
                setOperation('');
            }
        });
        return () => { generation.current++; };
    }, [props.sync]);
    const request = async (action: string) => {
        if (action === 'activate' && preview?.mode === 'source-primary')
            return;
        const current = generation.current;
        setOperation(action);
        setPreviewFresh(false);
        setMessage(action === 'activate' ? 'Enabling the build pipeline…' : 'Refreshing build information…');
        try {
            const result = action === 'activate'
                ? await props.sync.projectRequest('/projects/wizard/build', { recipeHash: preview.recipeHash })
                : await props.sync.projectRequest(action === 'preview'
                    ? '/projects/wizard/build' : '/projects/wizard/build/status');
            if (current === generation.current) {
                setBuild(result.build);
                setMessage(result.message || '');
                if (action === 'preview') {
                    setPreview(result);
                    setPreviewFresh(true);
                }
                else if (preview?.mode === 'source-primary' && result.sourceRevision) {
                    setPreview((previous: any) => ({...previous, sourceRevision: result.sourceRevision}));
                }
            }
        }
        catch (error) {
            if (current === generation.current) {
                const detail = error.response?.data?.message || error.message || 'Build verification failed.';
                setBuild((previous: any) => ({
                    ...previous,
                    phase: 'verification-failed',
                    artifact: undefined
                }));
                setMessage(detail);
            }
        }
        finally {
            if (current === generation.current)
                setOperation('');
        }
    };
    const busy = operation !== '';
    const sourcePrimary = preview?.mode === 'source-primary';
    const resumable = ['pending', 'verification-failed', 'recipe-installed'].includes(build?.phase);
    const pipelineUrl = /^https?:\/\//i.test(build?.pipeline?.webUrl || '') ? build.pipeline.webUrl : undefined;
    const repositoryUrl = /^https?:\/\//i.test(preview?.repository?.webUrl || '') ? preview.repository.webUrl : undefined;
    const status = sourcePrimary && build?.phase === 'pending'
        ? 'The current default branch has no verified native delivery pipeline yet. Check the pipeline in GitLab and refresh status.'
        : sourcePrimary && build?.phase === 'verification-failed'
            ? 'Native pipeline evidence could not be verified. Check GitLab and refresh status. Production is unchanged.'
            : phases[build?.phase] || 'Build status is unavailable. Refresh status.';
    return <Dialog open onClose={operation === 'activate' ? undefined : props.onClose} aria-labelledby="wizard-build-title">
    <DialogTitle id="wizard-build-title">{sourcePrimary ? t("Native Wizard build status") : t("Build and verify Wizard")}</DialogTitle>
    <DialogContent>
      {sourcePrimary ? <DialogContentText>
        {t("Merge requests and default-branch pushes run the checks and image build in this repository. Refresh reads their native pipeline evidence; it does not import source or start another pipeline. Production promotion stays explicit.")}</DialogContentText> : <DialogContentText>
        {t("Preview the managed build recipe, then explicitly enable checks for the imported Wizard source. It builds and verifies a candidate only. Production is not deployed or replaced.")}</DialogContentText>}
      {preview && <DialogContentText>
        {t("Repository:")}{' '}{preview.repository.path}<br />
        {sourcePrimary ? <>{t("Source revision:")}{' '}{preview.sourceRevision}</> : <>{t("Imported commit:")}{' '}{preview.importCommit}<br />{t("Recipe version:")}{' '}{preview.version}</>}
      </DialogContentText>}
      {build && <p role="status">{t(status)}</p>}
      {build?.message && <p>{t(build.message)}</p>}
      {sourcePrimary && repositoryUrl && <p><a href={repositoryUrl} target="_blank" rel="noopener noreferrer">{t("Open source repository")}</a></p>}
      {pipelineUrl && <p><a href={pipelineUrl} target="_blank" rel="noopener noreferrer">{t("Open pipeline")}</a></p>}
      {build?.checks && <ul>{Object.keys(build.checks).map(name => <li key={name}>
        {name}: {t(build.checks[name])}
      </li>)}</ul>}
      {build?.phase === 'candidate-verified' && build.artifact?.imageRef && <p>
        {t("Verified candidate image:")}{' '}<code>{build.artifact.imageRef}</code>
      </p>}
      {message && <p role="status">{t(message)}</p>}
    </DialogContent>
    <DialogActions>
      <Button disabled={operation === 'activate'} onClick={props.onClose}>{t("Close")}</Button>
      {preview && <Button disabled={busy} onClick={() => request('preview')}>{t("Refresh preview")}</Button>}
      {preview && <Button disabled={busy} onClick={() => request('status')}>{t("Refresh status")}</Button>}
      {preview && !sourcePrimary && (!build || resumable) && <Button color="primary" disabled={busy || !previewFresh} onClick={() => request('activate')}>{build ? t("Resume activation") : t("Enable build pipeline")}</Button>}
    </DialogActions>
  </Dialog>;
}
