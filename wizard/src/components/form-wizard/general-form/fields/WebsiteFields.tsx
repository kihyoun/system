import { useI18n } from '../../../../i18n';
import { Stack, TextField, Typography } from '@mui/material';
import { observer } from 'mobx-react';
import { runInAction } from 'mobx';
import type Main from '../../../../api/Main';
import { publicNoticeUrl } from '../../../legal/PublicSiteInfo';
import { websiteSetupDefaults } from '../../../../api/WebsiteConfig';

const fields = [
    { key: 'WIZARD_OPERATOR_NAME', label: 'Operator name', placeholder: 'Max Mustermann' },
    { key: 'WIZARD_OPERATOR_ADDRESS', label: 'Postal address', placeholder: 'Musterstraße 1\n12345 Musterstadt\nDeutschland', multiline: true },
    { key: 'WIZARD_OPERATOR_EMAIL', label: 'Contact email', placeholder: 'kontakt@example.com' },
    { key: 'WIZARD_PRIVACY_NOTICE_URL', label: 'Additional privacy notice URL', placeholder: 'https://example.com/privacy' },
    { key: 'WIZARD_ACCESS_LOG_RETENTION', label: 'Access-log retention', placeholder: 'For example: 7 days. Enter the actual retention used by your deployment.', multiline: true },
    { key: 'WIZARD_PRIVACY_TEXT', label: 'Additional privacy information', placeholder: 'Describe any additional data processing and privacy information for your deployment.', multiline: true }
];

export default observer(function WebsiteFields({ main, hidden }: { main: Main; hidden: boolean }) {
    const { t } = useI18n();
    if (hidden) return null;
    return (<Stack spacing={2}>
      <Typography component="h2" variant="h6">{t("Website / Legal information")}</Typography>
      <Typography color="text.secondary">
        {t("These details are public. A successful Push publishes them on this website’s Privacy and Imprint pages. Enter only information intended for public display. The prefilled name, address and email are setup examples and will be published until you replace or clear them. Optional fields remain blank until you fill them in.")}</Typography>
      {fields.map(field => {
          const value = main.config?.runtimeOptions[field.key] ?? '';
          const invalidEmail = field.key === 'WIZARD_OPERATOR_EMAIL' && value !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
          const invalidUrl = field.key === 'WIZARD_PRIVACY_NOTICE_URL' && value !== '' && !publicNoticeUrl(value);
          const example = websiteSetupDefaults[field.key as keyof typeof websiteSetupDefaults] === value;
          return (<TextField key={field.key} label={t(field.label)} placeholder={t(field.placeholder)}
            value={value} fullWidth multiline={field.multiline} minRows={field.multiline ? 3 : undefined}
            type={field.key === 'WIZARD_OPERATOR_EMAIL' ? 'email' : 'text'}
            error={Boolean(invalidEmail || invalidUrl)}
            helperText={invalidEmail ? t("Check the public contact email address.") : invalidUrl ? t("Use an HTTP or HTTPS URL without embedded credentials.") : example ? t("Setup example — replace or clear it. Public after Push.") : field.key === 'WIZARD_ACCESS_LOG_RETENTION' ? t("Describe the retention actually configured. This field does not change log handling. Public after Push.") : t("Public after Push.")}
            onChange={event => runInAction(() => { if (main.config) main.config.runtimeOptions[field.key] = event.target.value; })}
            slotProps={{ inputLabel: { shrink: true } }} />);
      })}
    </Stack>);
});
