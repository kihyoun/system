import { useState, type RefObject } from 'react';
import { Box, Button, Link, Paper, Stack, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { useI18n } from '../i18n';

export const installCommand = 'curl -fsSL https://github.com/kihyoun/system/releases/latest/download/quickstart.sh | sudo bash';

export default function QuickInstall({ sectionRef }: { sectionRef: RefObject<HTMLElement | null> }) {
    const { t } = useI18n();
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(installCommand);
            setCopyState('copied');
        } catch {
            setCopyState('failed');
        }
    };
    return <Paper component="section" ref={sectionRef} tabIndex={-1} elevation={0}
        aria-labelledby="quick-install-heading" sx={{ p: { xs: 3, md: 4 }, scrollMarginTop: 88 }}>
        <Typography component="h2" variant="h5" id="quick-install-heading" sx={{ mb: 1 }}>{t('Quick Install')}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>{t('Run this command in the terminal on your own Ubuntu host.')}</Typography>
        <Box sx={{ bgcolor: '#121c2b', color: '#e9f0fa', borderRadius: 2, overflow: 'hidden', mb: 2 }}>
            <Stack direction="row" sx={{ px: 2, py: 1, bgcolor: 'rgba(255,255,255,.06)', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="caption" component="span" sx={{ fontFamily: 'monospace' }}>ubuntu ~</Typography>
                <Button size="small" onClick={() => void copy()} aria-label={t('Copy install command')}
                    startIcon={copyState === 'copied' ? <CheckIcon /> : <ContentCopyIcon />} sx={{ color: '#fff' }}>
                    {t(copyState === 'copied' ? 'Copied!' : 'Copy')}
                </Button>
            </Stack>
            <Box component="pre" sx={{ m: 0, p: { xs: 2, md: 3 }, overflowX: 'auto', fontSize: '.9rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                <code>{installCommand}</code>
            </Box>
        </Box>
        <Typography role="status" variant="body2" sx={{ mb: copyState === 'idle' ? 0 : 1 }}>
            {copyState === 'copied' ? t('Copied!') : copyState === 'failed' ? t('Could not copy. Select the command and copy it manually.') : ''}
        </Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>{t('Ubuntu 24.04 / 26.04 LTS · x86_64 · sudo · curl, Python 3 and internet · 8 GiB RAM · 40 GiB data + 1 GiB source · free ports 80/443.')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('The installer downloads the tested public release and starts the initial Wizard. Downloads and service startup take time; continue setup in your browser.')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('Fresh installations only. For DNS, public HTTPS or recovery, follow Docs.')}</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
            <Link sx={{ color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark' }} href="#docs/quickstart">{t('Installation requirements and details')}</Link>
            <Link sx={{ color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark' }} href="#docs/getting-started">{t('Getting Started guide')}</Link>
            <Link sx={{ color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark' }} href="#docs">{t('Full Docs')}</Link>
        </Stack>
    </Paper>;
}
