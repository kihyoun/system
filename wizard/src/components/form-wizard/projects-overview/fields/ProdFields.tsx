import ApplicationAliasesFields from './ApplicationAliasesFields';
import { useI18n } from '../../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useState } from 'react';
import TextField from '@mui/material/TextField';
import { runInAction } from 'mobx';
import {
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputAdornment,
  InputLabel,
  NativeSelect,
} from '@mui/material';
import { observer } from 'mobx-react';
import Switch from '@mui/material/Switch';
const useStyles = makeStyles()((theme) => ({
  formControl: {
    margin: theme.spacing(1),
    minWidth: 120,
  },
  positionStart: { marginRight: 0 },
}));
const ProdFields = observer((props: any) => {
  const { t } = useI18n();
  const { classes } = useStyles();
  const [init, setInit] = useState(props.init);
  useEffect(() => {
    if (init && !props.hidden) {
      runInAction(() => props.config.generateProdProxyConfig());
      setInit(false);
    }
  }, [props.init, props.hidden]);
  if (props.hidden) return null;
  return (
    <>
      <FormControlLabel
        control={
          <Switch
            checked={props.config.useProdHost === 'true'}
            onChange={(event) => {
              runInAction(
                () => (props.config.useProdHost = event.target.checked ? 'true' : 'false'),
              );
            }}
            name="prodCfg"
            color="primary"
          />
        }
        label={t('Enable Production Environment')}
      />
      <TextField
        disabled={props.config.useProdHost === 'false'}
        label="PROD_HOST"
        style={{ margin: 8 }}
        value={props.config.prodHost}
        fullWidth
        margin="normal"
        onChange={(event) => {
          runInAction(() => (props.config.prodHost = event.target.value));
        }}
        slotProps={{
          inputLabel: { shrink: true },
        }}
      />
      <FormControl className={classes.formControl} disabled={props.config.useProdHost === 'false'}>
        <InputLabel htmlFor="proddeploymode-native-helper">{t('Deployment')}</InputLabel>
        <NativeSelect
          value={parseInt(props.config.prodDeployMode)}
          onChange={(event: any) => {
            runInAction(() => (props.config.prodDeployMode = event.target.value));
          }}
          inputProps={{
            name: 'prodDeployMode',
            id: 'prodDeployMode-native-helper',
          }}
        >
          <option value={0} aria-label={t('Manual')}>
            {t('Manual')}
          </option>
          <option value={1}>{t('Auto')}</option>
        </NativeSelect>
      </FormControl>

      <FormControl className={classes.formControl} disabled={props.config.useProdHost === 'false'}>
        <InputLabel htmlFor="regdomainmode-native-helper">PROD_DOMAIN_MODE</InputLabel>
        <NativeSelect
          value={props.config.prodDomainMode}
          onChange={(event: any) => {
            runInAction(() => (props.config.prodDomainMode = event.target.value));
          }}
          inputProps={{
            name: 'prodDomainMode',
            id: 'prodDomainMode-native-helper',
          }}
        >
          <option aria-label={t('Default (unencrypted)')} value={0}>
            {t('Default, HTTP')}
          </option>
          <option value={1}>{t('Wildcard HTTP')}</option>
          <option value={2}>{t('SSL encrypted')}</option>
          <option value={3}>{t('Wildcard SSL encrypted')}</option>
        </NativeSelect>
        <FormHelperText>{props.config.prodHostInfo.url}</FormHelperText>
      </FormControl>
      <TextField
        label="PROD_SSL"
        disabled={props.config.useProdHost === 'false' || props.config.prodDomainMode < 2}
        value={props.config.prodSSL}
        style={{ margin: 8 }}
        fullWidth
        margin="normal"
        onChange={(event: any) => {
          runInAction(() => (props.config.prodSSL = event.target.value));
        }}
        helperText={t('Path to Registry SSL Certificate')}
        slotProps={{
          inputLabel: { shrink: true },
          input: {
            startAdornment: (
              <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
                {props.config.main.config.seedDir}
              </InputAdornment>
            ),
          },
        }}
      />
      <TextField
        label="PROD_SSL_KEY"
        disabled={props.config.useProdHost === 'false' || props.config.prodDomainMode < 2}
        value={props.config.prodSSLKey}
        style={{ margin: 8 }}
        fullWidth
        margin="normal"
        onChange={(event: any) => {
          runInAction(() => (props.config.prodSSLKey = event.target.value));
        }}
        helperText={t('Path to SSL Key')}
        slotProps={{
          inputLabel: { shrink: true },
          input: {
            startAdornment: (
              <InputAdornment classes={{ positionStart: classes.positionStart }} position="start">
                {props.config.main.config.seedDir}
              </InputAdornment>
            ),
          },
        }}
      />
      <ApplicationAliasesFields config={props.config} context="prod" />
    </>
  );
});
export default ProdFields;
