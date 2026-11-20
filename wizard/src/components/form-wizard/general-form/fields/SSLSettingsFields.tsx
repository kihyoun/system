import { useI18n } from '../../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useState } from 'react';
import DerivedLabel from '../../../DerivedLabel';
import TextField from '@mui/material/TextField';
import { FormControl, FormHelperText, InputAdornment, InputLabel, Link, NativeSelect } from '@mui/material';
import { observer } from 'mobx-react';
import { runInAction } from 'mobx';
import SyntaxHighlighter from '../../../../SyntaxHighlighter';
import duotoneLight from 'react-syntax-highlighter/dist/esm/styles/prism/duotone-light';
const useStyles = makeStyles()(theme => ({
    formControl: {
        margin: theme.spacing(1),
        minWidth: 120
    },
    paper: {
        padding: theme.spacing(2),
        margin: 'auto',
        maxWidth: 1900
    },
    selectEmpty: { marginTop: theme.spacing(2) },
    heading: {
        fontSize: theme.typography.pxToRem(15),
        flexBasis: '33.33%',
        flexShrink: 0
    },
    secondaryHeading: {
        fontSize: theme.typography.pxToRem(15),
        color: theme.palette.text.secondary
    },
    positionStart: { marginRight: 0 }
}));
const SSLSettingsFields = observer((props: any) => {
    const { t } = useI18n();
    const { classes } = useStyles();
    const [init, setInit] = useState(props.main.init);
    const entry = { 'insecure-registries': [`${props.main.config.gitlabRegistryHost}:5050`] };
    const warning = <div>
    <b>{t("Attention:")}</b> {t("You are using an insecure-registry. This is not recommended.")}{' '}<br />{t("(Insecure Registries")}{' '}<Link>https://docs.docker.com/registry/insecure/</Link>)
    <br />
    {t("In order to use it, add the following entry to /etc/docker/daemon.json:")}{' '}<SyntaxHighlighter language="json" style={duotoneLight}>
      {JSON.stringify(entry, null, 2)}
    </SyntaxHighlighter>
  </div>;
    const [insecureRegistryWarning, setInsercureRegistryWarning] = useState(props.main.config.gitlabRegistryDomainMode < 2);
    useEffect(() => {
        if (!props.hidden && init && props.main.init) {
            runInAction(() => {
                props.main.config.generateProxyConfig();
                setInit(false);
            });
        }
        if (!props.init && init) {
            setInit(false);
        }
    }, [props.hidden, props.init, props.main.init]);
    if (props.hidden)
        return null;
    return (<>
      <FormControl className={classes.formControl}>
        <InputLabel htmlFor="domainmode-native-helper">
          <DerivedLabel label="GITLAB_DOMAIN_MODE" source={props.main.derivedFields.gitlabDomainMode}/>
        </InputLabel>
        <NativeSelect value={props.main.config.gitlabDomainMode} onChange={(event: any) => {
            runInAction(() => (props.main.config.gitlabDomainMode = event.target.value));
        }} inputProps={{
            name: 'domainmode',
            id: 'domainmode-native-helper'
        }}>
          <option value={0}>{t("Default, HTTP")}</option>
          <option value={2}>{t("SSL encrypted")}</option>
        </NativeSelect>
        <FormHelperText>{props.main.config.gitlabExternalUrl}</FormHelperText>
      </FormControl>
      <TextField label={<DerivedLabel label="GITLAB_SSL" source={props.main.derivedFields.gitlabSSL}/>} disabled={props.main.config.gitlabDomainMode < 2} value={props.main.config.gitlabSSL} style={{ margin: 8 }} placeholder={props.main.placeholder.gitlabSSL} fullWidth margin="normal" helperText={t("Path to SSL Certificate")} onChange={(event: any) => {
            runInAction(() => (props.main.config.gitlabSSL = event.target.value));
        }} slotProps={{
        inputLabel: { shrink: true },
        input: {
            startAdornment: <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
            {props.main.config.seedDir}</InputAdornment>
        }
    }}/>
      <TextField label={<DerivedLabel label="GITLAB_SSL_KEY" source={props.main.derivedFields.gitlabSSLKey}/>} disabled={props.main.config.gitlabDomainMode < 2} value={props.main.config.gitlabSSLKey} style={{ margin: 8 }} placeholder={props.main.placeholder.gitlabSSLKey} fullWidth margin="normal" helperText={t("Path to SSL Key")} onChange={(event: any) => {
            runInAction(() => (props.main.config.gitlabSSLKey = event.target.value));
        }} slotProps={{
        inputLabel: { shrink: true },
        input: {
            startAdornment: <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
            {props.main.config.seedDir}</InputAdornment>
        }
    }}/>
      <FormControl className={classes.formControl}>
        <InputLabel htmlFor="regdomainmode-native-helper">
          <DerivedLabel label="GITLAB_REGISTRY_DOMAIN_MODE" source={props.main.derivedFields.gitlabRegistryDomainMode}/>
        </InputLabel>
        <NativeSelect value={props.main.config.gitlabRegistryDomainMode} onChange={(event: any) => {
            runInAction(() => {
                props.main.config.gitlabRegistryDomainMode = event.target.value;
                if (event.target.value < 2) {
                    setInsercureRegistryWarning(true);
                }
                else {
                    setInsercureRegistryWarning(false);
                }
            });
        }} inputProps={{
            name: 'regdomainmode',
            id: 'regdomainmode-native-helper'
        }}>
          <option value={0}>{t("Default, HTTP")}</option>
          <option value={2}>{t("SSL encrypted")}</option>
        </NativeSelect>
        <FormHelperText>{props.main.config.gitlabRegistryUrl}{insecureRegistryWarning && warning}</FormHelperText>
      </FormControl>
      <TextField label={<DerivedLabel label="GITLAB_REGISTRY_SSL" source={props.main.derivedFields.gitlabRegistrySSL}/>} value={props.main.config.gitlabRegistrySSL} disabled={props.main.config.gitlabRegistryDomainMode < 2} style={{ margin: 8 }} placeholder={props.main.placeholder.gitlabRegistrySSL} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.main.config.gitlabRegistrySSL = event.target.value));
        }} helperText={t("Path to Registry SSL Certificate")} slotProps={{
        inputLabel: { shrink: true },
        input: {
            startAdornment: <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
            {props.main.config.seedDir}</InputAdornment>
        }
    }}/>
      <TextField label={<DerivedLabel label="GITLAB_REGISTRY_SSL_KEY" source={props.main.derivedFields.gitlabRegistrySSLKey}/>} disabled={props.main.config.gitlabRegistryDomainMode < 2} value={props.main.config.gitlabRegistrySSLKey} style={{ margin: 8 }} placeholder={props.main.placeholder.gitlabRegistrySSLKey} fullWidth margin="normal" onChange={(event: any) => {
            runInAction(() => (props.main.config.gitlabRegistrySSLKey = event.target.value));
        }} helperText={t("Path to Registry SSL Key")} slotProps={{
        inputLabel: { shrink: true },
        input: {
            startAdornment: <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
            {props.main.config.seedDir}</InputAdornment>
        }
    }}/>
    </>);
});
export default SSLSettingsFields;
