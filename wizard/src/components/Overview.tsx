import { useRef } from 'react';
import QuickInstall from './QuickInstall';
import { useI18n } from '../i18n';
import { Box, Button, Grid, Link, Paper, Stack, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import MenuBookIcon from '@mui/icons-material/MenuBook';

const documentation = 'https://github.com/kihyoun/system/blob/master/';
const steps = [
    {
        title: 'Prepare your platform',
        description: 'Start with an Ubuntu host and choose where to keep persistent service data. The handbook guides you through checkout, Docker and the first startup.',
        link: '#docs/getting-started',
        label: 'Follow the handbook'
    },
    {
        title: 'Connect and configure',
        description: 'Open the Wizard and enter your Sync address and credentials. Fetch the saved settings, then review your services, domains and runner count.',
        link: '#docs/configuration',
        label: 'Read the connection guide'
    },
    {
        title: 'Create your first project',
        description: 'Choose an application starter and configure its environments. Follow the build and test results before a deliberate production rollout.',
        link: '#docs/projects',
        label: 'Explore application projects'
    }
];

export default function Overview() {
    const quickInstall = useRef<HTMLElement>(null);
    const showInstall = () => {
        const section = quickInstall.current;
        if (!section) return;
        section.focus({ preventScroll: true });
        section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    };
    const { t } = useI18n();
    return (<Stack spacing={3} sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Paper component="section" elevation={0} sx={{ p: { xs: 3, md: 5 }, borderTop: 4, borderColor: 'secondary.main' }}>
       <Grid container spacing={{ xs: 3, md: 5 }} sx={{ alignItems: 'center' }}>
        <Grid size={{ xs: 12, md: 7 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.14em' }}>{t("System Bootstrapper · Open source")}</Typography>
        <Typography component="h1" variant="h3" sx={{ mt: 1, mb: 2, fontWeight: 700, fontSize: { xs: '2.375rem', md: '3.75rem' }, letterSpacing: '-0.04em' }}>
          You build it. You own it.
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 850, lineHeight: 1.75 }}>{t("System Bootstrapper is an open-source platform that brings your development tools together on your own server.")}</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 3, alignItems: { sm: 'center' } }}>
          <Button variant="contained" color="secondary" disableElevation endIcon={<ArrowForwardIcon />} onClick={showInstall}>{t("Install System Bootstrapper")}</Button>
          <Button component="a" href="#docs/getting-started" startIcon={<MenuBookIcon />} sx={{ color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark' }}>{t("Read the handbook")}</Button>
        </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ borderRadius: 2, bgcolor: 'action.hover', p: { xs: 2, md: 3 }, textAlign: 'center' }}>
            <Box component="svg" viewBox="0 0 360 320" aria-hidden="true" sx={{ display: 'block', width: '100%', maxWidth: 320, mx: 'auto', color: 'secondary.main' }}>
              <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
                <path d="M105 100 150 55H325V215L280 260H105Z M105 100H280L325 55 M280 100V260" />
                <path d="M150 55V215H325 M105 260 150 215" opacity="0.3" />
                <path d="M28 240 45 223H94V272L77 289H28Z M28 240H77L94 223 M77 240V289" />
                <path d="M94 248H105" strokeDasharray="2 4" />
              </g>
              <g fill="currentColor" fontFamily="monospace">
                <text x="126" y="165" fontSize="21" fontWeight="700">SYSTEM</text>
                <text x="126" y="190" fontSize="13" letterSpacing="1">BOOTSTRAPPER</text>
              </g>
            </Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.09em' }}>{t("Your tools. Your infrastructure.")}</Typography>
          </Box>
        </Grid>
       </Grid>
      </Paper>

      <Paper component="section" elevation={0} sx={{ p: { xs: 3, md: 4 } }} aria-labelledby="overview-steps-heading">
        <Typography component="h2" variant="h5" id="overview-steps-heading" sx={{ mb: 3 }}>{t("How it works")}</Typography>
        <Grid component="ol" container spacing={3} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {steps.map((step, index) => (<Grid component="li" key={step.title} size={{ xs: 12, md: 4 }}>
            <Box aria-hidden="true" sx={{ color: 'secondary.main', fontWeight: 700, mb: 1 }}>0{index + 1}</Box>
            <Typography component="h3" variant="h6" sx={{ mb: 1 }}>{t(step.title)}</Typography>
            <Typography color="text.secondary" sx={{ mb: 2, lineHeight: 1.7 }}>{t(step.description)}</Typography>
            <Link href={step.link} underline="hover" sx={{ color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark' }}>{t(step.label)}</Link>
          </Grid>))}
        </Grid>
      </Paper>

      <QuickInstall sectionRef={quickInstall} />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper component="section" elevation={0} sx={{ p: { xs: 3, md: 4 }, height: '100%' }} aria-labelledby="overview-capabilities-heading">
            <Typography component="h2" variant="h5" id="overview-capabilities-heading" sx={{ mb: 2 }}>{t("Make room for your ideas")}</Typography>
            <Stack component="ul" spacing={2} sx={{ pl: 2, mb: 0 }}>
              <li><Typography><strong>{t("Configure your toolchain.")}</strong>{' '}{t("Manage GitLab, the registry, runner managers and service routing from one interface.")}</Typography></li>
              <li><Typography><strong>{t("Build and deliver applications.")}</strong>{' '}{t("Start with React, Angular, a general web project or an empty repository, then work with editable source and CI.")}</Typography></li>
              <li><Typography><strong>{t("Keep a path back.")}</strong>{' '}{t("Back up configuration separately and retain your persistent storage. Harvest and Seed provide service-data snapshots for recovery.")}</Typography></li>
            </Stack>
            <Link href="#docs/recovery" underline="hover" sx={{ display: 'inline-block', mt: 3, color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark' }}>{t("Understand persistence and recovery")}</Link>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper component="section" elevation={0} sx={{ p: { xs: 3, md: 4 }, height: '100%' }} aria-labelledby="overview-vision-heading">
            <Typography component="h2" variant="h5" id="overview-vision-heading" sx={{ mb: 2 }}>{t("Built to evolve")}</Typography>
            <Typography color="text.secondary" sx={{ lineHeight: 1.75, mb: 2 }}>{t("The long-term goal is a platform that can build and validate its next generation. Today’s explicit Wizard source, build and promotion steps provide a foundation; complete autonomous renewal remains a vision.")}</Typography>
            <Link href={`${documentation}docs/ARCHITECTURE.md`} underline="hover" sx={{ color: theme => theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark' }}>{t("Explore the project and architecture")}</Link>
          </Paper>
        </Grid>
      </Grid>
    </Stack>);
}
