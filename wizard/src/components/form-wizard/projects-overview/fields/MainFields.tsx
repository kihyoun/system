import { useI18n } from '../../../../i18n';
import React from 'react';
import TextField from '@mui/material/TextField';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react';
const MainFields = observer((props: any) => {
    const { t } = useI18n();
    if (props.hidden)
        return null;
    return <>
    <TextField label={t("Project Key")} value={props.config.projectKey} fullWidth margin="normal" disabled={props.editing} error={!props.editing && props.availability !== 'available'} helperText={props.editing ? t("Existing keys are preserved.") : t(props.message)} onChange={event => {
            const value = event.target.value;
            runInAction(() => { props.config._projectKey = value; });
        }}/>
    <TextField select label={t("GitLab namespace")} fullWidth margin="normal" value={props.config.namespaceId} disabled={props.editing} onChange={event => {
            const value = event.target.value;
            runInAction(() => { props.config.namespaceId = value; });
        }} slotProps={{
        select: { native: true },
        inputLabel: { shrink: true }
    }}>
      <option value="">{t("Select namespace")}</option>
      {props.namespaces.map((namespace: any) => <option key={namespace.id} value={namespace.id}>{namespace.path}</option>)}
    </TextField>
    <p>{props.destination}</p>
    <TextField select label={t("Application template")} fullWidth margin="normal" value={props.config.template} disabled={props.editing} helperText={t("Creates editable source, Dockerfile and matching CI. The first pipeline starts automatically.")} onChange={event => { const value = event.target.value; runInAction(() => { props.config.template = value; }); }} slotProps={{
        select: { native: true }
    }}>
      <option value="react">React + TypeScript + Vite</option>
      <option value="angular">Angular + TypeScript</option>
      <option value="web">{t("General web project — HTML, CSS, JavaScript")}</option>
      <option value="empty">{t("Empty repository — add your own source later")}</option>
    </TextField>
  </>;
});
export default MainFields;
