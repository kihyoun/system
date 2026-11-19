import ApplicationAliasesFields from './ApplicationAliasesFields';
import { useI18n } from '../../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useState } from 'react';
import TextField from '@mui/material/TextField';
import { runInAction } from 'mobx';
import { FormControl, FormControlLabel, FormHelperText, InputLabel, NativeSelect } from '@mui/material';
import { observer } from 'mobx-react';
import Switch from '@mui/material/Switch';
import InputAdornment from '@mui/material/InputAdornment';
const useStyles = makeStyles()(theme => ({
    formControl: {
        margin: theme.spacing(1),
        minWidth: 120
    },
    positionStart: { marginRight: 0 }
}));
const BetaFields = observer((props: any) => {
    const { t } = useI18n();
    const { classes } = useStyles();
    const [init, setInit] = useState(props.init);
    useEffect(() => {
        if (init && !props.hidden) {
            runInAction(() => props.config.generateBetaProxyConfig());
            setInit(false);
        }
    }, [props.init, props.hidden]);
    if (props.hidden)
        return null;
    return (<>
      <FormControlLabel control={<Switch checked={props.config.useBetaHost === 'true'} onChange={event => {
                runInAction(() => props.config.useBetaHost = event.target.checked ? 'true' : 'false');
            }} name="betaCfg" color="primary"/>} label={t("Enable Beta Environment")}/>
      <TextField disabled={props.config.useBetaHost === 'false'} label="BETA_HOST" style={{ margin: 8 }} value={props.config.betaHost} fullWidth margin="normal" onChange={event => {
            runInAction(() => (props.config.betaHost = event.target.value));
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
      <FormControl className={classes.formControl} disabled={props.config.useBetaHost === 'false'}>
        <InputLabel htmlFor="betadeploymode-native-helper">
              {t("Deployment")}</InputLabel>
        <NativeSelect value={props.config.betaDeployMode} onChange={(event: any) => {
            runInAction(() => (props.config.betaDeployMode = event.target.value));
        }} inputProps={{
            name: 'betaDeployMode',
            id: 'betaDeployMode-native-helper'
        }}>
          <option value={0}>{t("Manual")}</option>
          <option value={1}>{t("Auto")}</option>
        </NativeSelect>
      </FormControl>
      <FormControl className={classes.formControl} disabled={props.config.useBetaHost === 'false'}>
        <InputLabel htmlFor="regdomainmode-native-helper">
              BETA_DOMAIN_MODE
        </InputLabel>
        <NativeSelect value={props.config.betaDomainMode} onChange={(event: any) => {
            runInAction(() => (props.config.betaDomainMode = event.target.value));
        }} inputProps={{
            name: 'betaDomainMode',
            id: 'betaDomainMode-native-helper'
        }}>
          <option aria-label={t("Default (unencrypted)")} value={0}>
                {t("Default, HTTP")}</option>
          <option value={1}>{t("Wildcard HTTP")}</option>
          <option value={2}>{t("SSL encrypted")}</option>
          <option value={3}>{t("Wildcard SSL encrypted")}</option>
        </NativeSelect>
        <FormHelperText>{props.config.betaHostInfo.url}</FormHelperText>
      </FormControl>
      <TextField label="BETA_SSL" disabled={props.config.useBetaHost === 'false'
            || props.config.betaDomainMode < 2} value={props.config.betaSSL} style={{ margin: 8 }} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.config.betaSSL = event.target.value));
        }} helperText={t("Path to Registry SSL Certificate")} slotProps={{
        inputLabel: { shrink: true },
        input: {
            startAdornment: <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
            {props.config.main.config.seedDir}</InputAdornment>
        }
    }}/>
      <TextField label="BETA_SSL_KEY" disabled={props.config.useBetaHost === 'false' || props.config.betaDomainMode < 2} value={props.config.betaSSLKey} style={{ margin: 8 }} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.config.betaSSLKey = event.target.value));
        }} helperText={t("Path to SSL Key")} slotProps={{
        inputLabel: { shrink: true },
        input: {
            startAdornment: <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
            {props.config.main.config.seedDir}</InputAdornment>
        }
    }}/>
      <ApplicationAliasesFields config={props.config} context="beta"/>
    </>);
});
export default BetaFields;
