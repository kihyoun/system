import ApplicationAliasesFields from './ApplicationAliasesFields';
import { useI18n } from '../../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useState } from 'react';
import TextField from '@mui/material/TextField';
import { runInAction } from 'mobx';
import { FormControl, FormControlLabel, FormHelperText, InputAdornment, InputLabel, NativeSelect } from '@mui/material';
import { observer } from 'mobx-react';
import Switch from '@mui/material/Switch';
const useStyles = makeStyles()(theme => ({
    formControl: {
        margin: theme.spacing(1),
        minWidth: 120
    },
    positionStart: { marginRight: 0 }
}));
const ReviewFields = observer((props: any) => {
    const { t } = useI18n();
    const { classes } = useStyles();
    const [init, setInit] = useState(props.init);
    useEffect(() => {
        if (init && !props.hidden) {
            runInAction(() => props.config.generateReviewProxyConfig());
            setInit(false);
        }
    }, [props.init, props.hidden]);
    if (props.hidden)
        return null;
    return (<>
      <FormControlLabel control={<Switch checked={props.config.useReviewHost === 'true'} onChange={event => {
                runInAction(() => props.config.useReviewHost = event.target.checked ? 'true' : 'false');
            }} name="reviewCfg" color="primary"/>} label={t("Enable Review Environment")}/>
      <TextField disabled={props.config.useReviewHost === 'false'} label="REVIEW_HOST" style={{ margin: 8 }} value={props.config.reviewHost} fullWidth margin="normal" onChange={event => {
            runInAction(() => (props.config.reviewHost = event.target.value));
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
      <FormControl className={classes.formControl} disabled={props.config.useReviewHost === 'false'}>
        <InputLabel htmlFor="reviewdeploymode-native-helper">
              {t("Deployment")}</InputLabel>
        <NativeSelect value={props.config.reviewDeployMode} onChange={(event: any) => {
            runInAction(() => (props.config.reviewDeployMode = event.target.value));
        }} inputProps={{
            name: 'reviewDeployMode',
            id: 'reviewDeployMode-native-helper'
        }}>
          <option value={0}>{t("Manual")}</option>
          <option value={1}>{t("Auto")}</option>
        </NativeSelect>
      </FormControl>

      <FormControl className={classes.formControl} disabled={props.config.useReviewHost === 'false'}>
        <InputLabel htmlFor="regdomainmode-native-helper">
              REVIEW_DOMAIN_MODE
        </InputLabel>
        <NativeSelect value={props.config.reviewDomainMode} onChange={(event: any) => {
            runInAction(() => (props.config.reviewDomainMode = event.target.value));
        }} inputProps={{
            name: 'reviewDomainMode',
            id: 'reviewDomainMode-native-helper'
        }}>
          <option value={1}>{t("Wildcard HTTP")}</option>
          <option value={3}>{t("Wildcard SSL encrypted")}</option>
        </NativeSelect>
        <FormHelperText>{props.config.reviewHostInfo.url}</FormHelperText>
      </FormControl>
      <TextField label="REVIEW_SSL" disabled={props.config.useReviewHost === 'false' || props.config.reviewDomainMode < 2} value={props.config.reviewSSL} style={{ margin: 8 }} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.config.reviewSSL = event.target.value));
        }} helperText={t("Path to Registry SSL Certificate")} slotProps={{
        inputLabel: { shrink: true },
        input: {
            startAdornment: <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
            {props.config.main.config.seedDir}</InputAdornment>
        }
    }}/>
      <TextField label="REVIEW_SSL_KEY" disabled={props.config.useReviewHost === 'false' || props.config.reviewDomainMode < 2} value={props.config.reviewSSLKey} style={{ margin: 8 }} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.config.reviewSSLKey = event.target.value));
        }} helperText={t("Path to SSL Key")} slotProps={{
        inputLabel: { shrink: true },
        input: {
            startAdornment: <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
            {props.config.main.config.seedDir}</InputAdornment>
        }
    }}/>
      <ApplicationAliasesFields config={props.config} context="review"/>
    </>);
});
export default ReviewFields;
