import { useI18n } from '../i18n';
import { Link, Paper, Stack, Typography } from '@mui/material';
import OperatorInformation from './legal/OperatorInformation';
import { publicNoticeUrl, type PublicSiteInfo } from './legal/PublicSiteInfo';

export default function Privacy({ info, loading }: { info: PublicSiteInfo; loading: boolean }) {
    const { t } = useI18n();
    const notice = publicNoticeUrl(info.privacyNoticeUrl);
    return (<Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, maxWidth: 1000, mx: 'auto' }}>
      <Stack spacing={3}>
        <Typography component="h1" variant="h3" id="privacy-heading" tabIndex={-1}>{t("Privacy")}</Typography>
        <Typography>{t("This page describes how the Wizard handles information. The operator of each deployment is responsible for its hosting, connected services and any additional privacy information that applies to them.")}</Typography>
        <Typography component="h2" variant="h5">{t("Operator and contact")}</Typography>
        {loading ? <Typography role="status">{t("Loading published operator information…")}</Typography> : <OperatorInformation info={info} />}
        {notice && <Link href={notice} sx={{ color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark' }}>{t("Read the operator’s additional privacy notice")}</Link>}
        <Typography component="h2" variant="h5">{t("Information in your browser")}</Typography>
        <Typography>{t("Configuration and Sync session tokens are held in the page’s memory. The Wizard does not store them in cookies, local storage or session storage. Navigation within the interface preserves your work; reloading the page resets that browser state. Open reads a file you choose locally, while Backup downloads a configuration file. Backups can contain credentials and other confidential settings.")} {t("Your language preference is saved in local storage on this device.")}</Typography>
        <Typography component="h2" variant="h5">{t("When you connect to an instance")}</Typography>
        <Typography>{t("Connect sends your login details to the Sync address you select. Authenticated actions use session tokens: Fetch reads configuration, and Push sends your edited configuration to that instance. The instance can retain configuration on its persistent storage and create or update projects in its GitLab. Those services process the information needed for the actions you request.")}</Typography>
        <Typography component="h2" variant="h5">{t("Hosting, access logs and external links")}</Typography>
        <Typography>{t("The web server or reverse proxy receives connection details such as your IP address, request time and requested path, and may record them in access logs. The operator determines the log configuration and retention. Opening Privacy or Imprint loads the published operator information from this same website; it does not fetch the authenticated Sync configuration.")}</Typography>
        <Typography sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
          {info.accessLogRetention ? `${t('Published access-log retention:')} ${info.accessLogRetention}` :
              t('The operator has not provided a deployment-specific access-log retention period here.')}
        </Typography>
        <Typography>{t("The interface includes no analytics or advertising trackers and loads its fonts from your device. GitHub and handbook links are ordinary external links; following one sends a request to that destination, whose own privacy information applies.")}</Typography>
        {info.additionalPrivacyText && <>
          <Typography component="h2" variant="h5">{t("Additional information from the operator")}</Typography>
          <Typography sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{info.additionalPrivacyText}</Typography>
        </>}
      </Stack>
    </Paper>);
}
