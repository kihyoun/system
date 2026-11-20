import { useI18n } from '../../../../i18n';
import React, { useEffect, useState } from 'react';
import TextField from '@mui/material/TextField';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react';
import DerivedLabel from '../../../DerivedLabel';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
const StartFields = observer((props: any) => {
    const { t } = useI18n();
    const [init, setInit] = useState(props.main.init);
    const [showToken, setShowToken] = useState(false);
    useEffect(() => {
        if (!props.hidden && init && props.main.init) {
            runInAction(() => {
                props.main.config.generateMainConfig();
                setInit(false);
            });
        }
        if (!props.init && init) {
            setInit(false);
        }
    }, [props.hidden, props.init, props.main.init]);
    if (props.hidden)
        return null;
    const handleInputChange = (event: any) => {
        runInAction(() => {
            props.main.config.gitlabRunnerScale =
                event.target.value === '' ? 0 : Number(event.target.value);
        });
    };
    const handleBlur = () => {
        if (props.main.config.gitlabRunnerScale < 0) {
            runInAction(() => props.main.config.gitlabRunnerScale = 0);
        }
        else if (props.main.config.gitlabRunnerScale > 50) {
            runInAction(() => props.main.config.gitlabRunnerScale = 50);
        }
    };
    return (<>
      <TextField label={<DerivedLabel label="SEED_DIR" source={props.main.derivedFields.seedDir}/>} value={props.main.config.seedDir} style={{ margin: 8 }} helperText={t("Location for persistent Data, will be synced with rsync")} fullWidth margin="normal" onChange={event => {
            runInAction(() => props.main.config.seedDir = event.target.value);
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
      <TextField label={<DerivedLabel label="GITLAB_HOST" source={props.main.derivedFields.gitlabHost}/>} value={props.main.config.gitlabHost} style={{ margin: 8 }} placeholder={Object.keys(props.main.derivedFields).length ? '' : props.main.placeholder.gitlabHost} fullWidth margin="normal" onChange={event => {
            runInAction(() => {
                props.main.config.gitlabHost = event.target.value;
            });
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
      <TextField label={<DerivedLabel label="GITLAB_REGISTRY_HOST" source={props.main.derivedFields.gitlabRegistryHost}/>} value={props.main.config.gitlabRegistryHost} style={{ margin: 8 }} placeholder={Object.keys(props.main.derivedFields).length ? '' : props.main.placeholder.gitlabRegistryHost} fullWidth margin="normal" onChange={event => {
            runInAction(() => {
                props.main.config.gitlabRegistryHost = event.target.value;
            });
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
      <TextField label={t("Gitlab Runners")} helperText={t("Docker containers in one shared instance runner pool. Push and Restart apply the count.")} fullWidth margin="normal" style={{ margin: 8 }} value={props.main.config.gitlabRunnerScale} onChange={e => handleInputChange(e)} onBlur={() => handleBlur()} slotProps={{
        inputLabel: { shrink: true },
        htmlInput: {
            step: 1,
            min: 0,
            max: 50,
            type: 'number',
            'aria-labelledby': 'input-slider'
        }
    }}/>
      <TextField label={t("Runner authentication token")} type={showToken ? 'text' : 'password'} helperText={t("Leave empty for automatic setup on this GitLab instance. Fetch after setup; Backup includes this secret.")} style={{ margin: 8 }} value={props.main.config.gitlabRunnerToken} fullWidth margin="normal" onChange={event => {
            runInAction(() => (props.main.config.gitlabRunnerToken = event.target.value));
        }} slotProps={{
        input: {
            endAdornment: <InputAdornment position="end">
            <Button onClick={() => setShowToken(!showToken)}>{showToken ? t("Hide") : t("Show")}</Button>
          </InputAdornment>
        },
        inputLabel: { shrink: true }
    }}/>
    </>);
});
export default StartFields;
