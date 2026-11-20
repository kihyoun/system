import { useI18n } from '../i18n';
import React from 'react';
import Tooltip from '@mui/material/Tooltip';
export const derivedWarning = 'These values were derived automatically. '
    + 'Please verify that they are correct and usable before pushing the configuration.';
export default function DerivedLabel(props: {
    label: string;
    source?: string;
}) {
    const { t } = useI18n();
    return <>{props.label}{props.source && (<Tooltip title={`${t(derivedWarning)} ${t('Source:')} ${props.source}`}>
      <span tabIndex={0} aria-label={`${props.label}: ${t('derived value.')} ${t(derivedWarning)}`} style={{ cursor: 'help' }}> *</span>
    </Tooltip>)}</>;
}
