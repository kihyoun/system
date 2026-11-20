import { useI18n } from '../../i18n';
import React, { useEffect, useState } from 'react';
import TextField from '@mui/material/TextField';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react';
const ServerCredentialFields = observer((props: any) => {
    const { t } = useI18n();
    const [serverAddress, setServerAddress] = useState(props.main.sync.serverAddress);
    useEffect(() => {
        runInAction(() => {
            if (props.init) {
                props.main.sync.generateConfig();
            }
            if (props.main.config.syncEnable === 'true' && props.main.config.syncHost) {
                setServerAddress(props.main.config.syncHostInfo.url);
            }
        });
    }, []);
    return (<>
      <TextField label={t("Server Address")} value={serverAddress} style={{ margin: 8 }} name="serverAddress" disabled={props.main.sync.connected} fullWidth margin="normal" variant="outlined" onChange={event => {
            runInAction(() => {
                props.main.sync.serverAddress = event.target.value;
                setServerAddress(event.target.value);
            });
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
      <TextField label={t("Username")} variant="outlined" disabled={props.main.sync.connected} value={props.main.sync.userName} name="userName" style={{ margin: 8 }} fullWidth margin="normal" onChange={event => {
            runInAction(() => props.main.sync.userName = event.target.value);
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
      <TextField label={t("Password")} variant="outlined" value={props.password} disabled={props.main.sync.connected} style={{ margin: 8 }} fullWidth type={'password'} margin="normal" onChange={event => {
            runInAction(() => props.setPassword(event.target.value));
        }} slotProps={{
        inputLabel: { shrink: true }
    }}/>
    </>);
});
export default ServerCredentialFields;
