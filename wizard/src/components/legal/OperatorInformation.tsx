import { useI18n } from '../../i18n';
import { Link, Stack, Typography } from '@mui/material';
import type { PublicSiteInfo } from './PublicSiteInfo';
import { websiteSetupDefaults } from '../../api/WebsiteConfig';

export default function OperatorInformation({ info }: { info: PublicSiteInfo }) {
    const { t } = useI18n();
    const configured = info.operatorName || info.operatorAddress || info.contactEmail;
    const hasExample = info.operatorName === websiteSetupDefaults.WIZARD_OPERATOR_NAME ||
        info.operatorAddress === websiteSetupDefaults.WIZARD_OPERATOR_ADDRESS ||
        info.contactEmail === websiteSetupDefaults.WIZARD_OPERATOR_EMAIL;
    return configured ? (<Stack spacing={1}>
      {hasExample && <Typography role="note" sx={{ p: 2, bgcolor: 'action.hover', borderLeft: 3, borderColor: 'secondary.main' }}>{t("Example operator details. Some details still use setup examples; they do not establish this deployment’s legal identity. Replace or clear them in Wizard → General → Website.")}</Typography>}
      {info.operatorName && <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{info.operatorName}</Typography>}
      {info.operatorAddress && <Typography sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{info.operatorAddress}</Typography>}
      {info.contactEmail && <Typography sx={{ overflowWrap: 'anywhere' }}>
        {t('Contact:')} {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.contactEmail)
            ? <Link href={`mailto:${encodeURIComponent(info.contactEmail)}`} sx={{ color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark' }}>{info.contactEmail}</Link>
            : info.contactEmail}
      </Typography>}
    </Stack>) : (<Typography color="text.secondary">{t("The operator has not yet published contact details through this interface. The operator of this deployment is responsible for providing the applicable operator, contact and legal information.")}</Typography>);
}
