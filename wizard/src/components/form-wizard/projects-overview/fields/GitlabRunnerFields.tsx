import { useI18n } from '../../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useState } from 'react';
import TextField from '@mui/material/TextField';
import { runInAction } from 'mobx';
import { FormLabel, Typography, Input, } from '@mui/material';
import { observer } from 'mobx-react';
const useStyles = makeStyles()(theme => ({
    formControl: {
        margin: theme.spacing(1),
        minWidth: 120
    },
    input: { width: 42 }
}));
const GitlabRunnerFields = observer((props: any) => {
    const { t } = useI18n();
    const { classes } = useStyles();
    const [init, setInit] = useState(props.init);
    const handleInputChange = (event: any) => {
        runInAction(() => {
            props.config.gitlabRunnerScale =
                event.target.value === '' ? 0 : Number(event.target.value);
        });
    };
    useEffect(() => {
        if (init && !props.hidden) {
            runInAction(() => props.config.generateRunnerConfig());
            setInit(false);
        }
    }, [props.init, props.hidden]);
    const handleBlur = () => {
        if (props.config.gitlabRunnerScale < 0) {
            runInAction(() => props.config.gitlabRunnerScale = 0);
        }
        else if (props.config.gitlabRunnerScale > 50) {
            runInAction(() => props.config.gitlabRunnerScale = 50);
        }
    };
    if (props.hidden)
        return null;
    return (<>
      <Typography variant="body2">
        {t("Leave the count at 0 to use the shared instance runner pool configured under General, when instance runners are enabled for the GitLab project. Only increase it if this application needs additional runner containers.")}</Typography>
      <FormLabel id="project-runner-count-label" component="legend">
        {t("Additional project runners (optional)")}</FormLabel>
      <Input className={classes.input} value={props.config.gitlabRunnerScale} margin="dense" onChange={e => handleInputChange(e)} onBlur={() => handleBlur()} inputProps={{
            step: 1,
            min: 0,
            max: 50,
            type: 'number',
            'aria-labelledby': 'project-runner-count-label'
        }}/>
      <TextField label={t("Token for additional runners")} helperText={t('Required for additional runners. GitLab determines project access from the token; this form does not assign runner permissions.')} style={{ margin: 8 }} value={props.config.gitlabRunnerToken} fullWidth margin="normal" onChange={event => {
            runInAction(() => (props.config.gitlabRunnerToken = event.target.value));
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
    </>);
});
export default GitlabRunnerFields;
