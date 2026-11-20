import { useI18n } from '../../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useState } from 'react';
import TextField from '@mui/material/TextField';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react';
import { FormControl, FormControlLabel, FormHelperText, InputAdornment, InputLabel, NativeSelect } from '@mui/material';
import Switch from '@mui/material/Switch';
import DerivedLabel from '../../../DerivedLabel';
const useStyles = makeStyles()(theme => ({
    formControl: {
        margin: theme.spacing(1),
        minWidth: 120
    },
    positionStart: { marginRight: 0 }
}));
const SyncServerFields = observer((props: any) => {
    const { t } = useI18n();
    const { classes } = useStyles();
    const [init, setInit] = useState(props.main.init);
    useEffect(() => {
        if (!props.hidden && init && props.main.init) {
            runInAction(() => {
                props.main.config.generateSyncConfig();
                setInit(false);
            });
        }
        if (!props.init && init) {
            setInit(false);
        }
    }, [props.hidden, props.main.init]);
    if (props.hidden)
        return null;
    return (<>
      <FormControlLabel control={<Switch checked={props.main.config.syncEnable === 'true'} onChange={event => {
                runInAction(() => props.main.config.syncEnable = event.target.checked ? 'true' : 'false');
            }} color="primary"/>} label={t("Enable Synchronization Server")}/>
      <FormControl className={classes.formControl} disabled={props.main.config.syncEnable === 'false'}>
        <InputLabel htmlFor="syncdomainmode-native-helper">
          <DerivedLabel label="SYNC_DOMAIN_MODE" source={props.main.derivedFields.syncDomainMode}/>
        </InputLabel>
        <NativeSelect value={props.main.config.syncDomainMode} onChange={(event: any) => {
            runInAction(() => (props.main.config.syncDomainMode = event.target.value));
        }} inputProps={{
            name: 'syncDomainMode',
            id: 'syncDomainMode-native-helper'
        }}>
          <option aria-label={t("Default (unencrypted)")} value={0}>
                {t("Default, HTTP")}</option>
          <option value={2}>{t("SSL encrypted")}</option>
        </NativeSelect>
        <FormHelperText>{props.main.config.syncHostInfo.url}</FormHelperText>
      </FormControl>
      <TextField label={<DerivedLabel label="SYNC_HOST" source={props.main.derivedFields.syncHost}/>} disabled={props.main.config.syncEnable === 'false'} value={props.main.config.syncHost} style={{ margin: 8 }} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.main.config.syncHost = event.target.value));
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
      <TextField label="SYNC_USER" disabled={props.main.config.syncEnable === 'false'} value={props.main.config.syncUser} style={{ margin: 8 }} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.main.config.syncUser = event.target.value));
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
      <TextField label="SYNC_PASS" disabled={props.main.config.syncEnable === 'false'} value={props.main.config.syncPass} style={{ margin: 8 }} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.main.config.syncPass = event.target.value));
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
      <TextField label={<DerivedLabel label="SYNC_SSL" source={props.main.derivedFields.syncSSL}/>} disabled={props.main.config.syncEnable === 'false' || props.main.config.syncDomainMode < 2} value={props.main.config.syncSSL} style={{ margin: 8 }} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.main.config.syncSSL = event.target.value));
        }} helperText={t("Path to SSL Certificate")} slotProps={{
        inputLabel: { shrink: true },
        input: {
            startAdornment: <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
            {props.main.config.seedDir}</InputAdornment>
        }
    }}/>
      <TextField label={<DerivedLabel label="SYNC_SSL_KEY" source={props.main.derivedFields.syncSSLKey}/>} disabled={props.main.config.syncEnable === 'false' || props.main.config.syncDomainMode < 2} value={props.main.config.syncSSLKey} style={{ margin: 8 }} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.main.config.syncSSLKey = event.target.value));
        }} helperText={t("Path to SSL Key")} slotProps={{
        inputLabel: { shrink: true },
        input: {
            startAdornment: <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
            {props.main.config.seedDir}</InputAdornment>
        }
    }}/>
    </>);
});
export default SyncServerFields;
