import { useI18n } from '../i18n';
import { Paper, Stack, Typography } from '@mui/material';
import OperatorInformation from './legal/OperatorInformation';
import type { PublicSiteInfo } from './legal/PublicSiteInfo';

export default function Imprint({ info, loading }: { info: PublicSiteInfo; loading: boolean }) {
    const { t } = useI18n();
    return (<Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, maxWidth: 1000, mx: 'auto' }}>
      <Stack spacing={3}>
        <Typography component="h1" variant="h3" id="imprint-heading" tabIndex={-1}>{t("Imprint")}</Typography>
        <Typography color="text.secondary">{t("Operator information for this deployment of System Bootstrapper.")}</Typography>
        {loading ? <Typography role="status">{t("Loading published operator information…")}</Typography> : <OperatorInformation info={info} />}
        <Typography color="text.secondary">{t("System Bootstrapper is open-source software. Each deployment has its own operator; the software project does not supply a legal identity on that operator’s behalf.")}</Typography>
      </Stack>
    </Paper>);
}
