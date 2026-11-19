import {TextField} from '@mui/material';
import {observer} from 'mobx-react';
import {runInAction} from 'mobx';
import {useI18n} from '../../../../i18n';
import {applicationAliasError} from '../../../../api/ApplicationAliases';
const ApplicationAliasesFields = observer(({config, context}: {config: any; context: string}) => {
  const {t} = useI18n();
  const error = applicationAliasError(config);
  return <TextField label={context.toUpperCase() + '_ALIASES'} fullWidth margin="normal" style={{margin: 8}}
    disabled={config['use' + context[0].toUpperCase() + context.slice(1) + 'Host'] !== 'true'}
    value={config[context + 'Aliases']} error={!!error}
    onChange={event => runInAction(() => { config[context + 'Aliases'] = event.target.value; })}
    helperText={t(error || 'Optional exact host aliases, separated by spaces. HTTP and HTTPS redirect to this environment’s canonical host, preserving path and query. Its certificate must cover every alias. ACME HTTP-01 remains reachable.')}
    slotProps={{inputLabel: {shrink: true}}}/>;
});
export default ApplicationAliasesFields;
