import { I18nProvider, useI18n } from './i18n';
import { deDE, enUS, koKR } from '@mui/material/locale';
import ListItemButton from '@mui/material/ListItemButton';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useRef, useState } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import Paper from '@mui/material/Paper';
import Grid from '@mui/material/Grid';
import { Box, Button, ButtonGroup, Link, Snackbar, Tab, Tabs, Theme, useMediaQuery } from '@mui/material';
import DarkModeSwitch from './DarkModeSwitch';
import FormWizard from './components/form-wizard/FormWizard';
import Main from './api/Main';
import AddIcon from '@mui/icons-material/Add';
import { observer } from 'mobx-react';
import { blue, pink } from '@mui/material/colors';
import { grey } from '@mui/material/colors';
import clsx from 'clsx';
import Drawer from '@mui/material/Drawer';
import CssBaseline from '@mui/material/CssBaseline';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import List from '@mui/material/List';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import InboxIcon from '@mui/icons-material/MoveToInbox';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { green } from '@mui/material/colors';
import { runInAction } from 'mobx';
import ConnectServerDialog from './components/form-wizard/dialog/ConnectServerDialog';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import moment from 'moment';
import ServerControlButton from './components/ServerControlButton';
import EditIcon from '@mui/icons-material/Edit';
import Helper from './api/Helper';
import Overview from './components/Overview';
import Docs, { DocsNavigation } from './components/Docs';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import Privacy from './components/Privacy';
import Imprint from './components/Imprint';
import { usePublicSiteInfo } from './components/legal/PublicSiteInfo';
const drawerWidth = 240;
type MainView = 'overview' | 'wizard' | 'docs' | 'privacy' | 'imprint';
const viewFromLocation = (): MainView => {
    const path = window.location.pathname.replace(/\/$/, '');
    if (path === '/privacy' || path === '/imprint') return path.slice(1) as MainView;
    if (window.location.hash.startsWith('#docs/') || path === '/docs') return 'docs';
    return path === '/configuration' ? 'wizard' : 'overview';
};
const useStyles = makeStyles<{
    progress: number;
    theme: Theme;
}>()((theme, props) => ({
    root: {},
    paper: {
        padding: theme.spacing(2),
        margin: '0 auto',
        width: '100%',
        maxWidth: 1900,
        marginBottom: theme.spacing(2)
    },
    divider: { flexGrow: 1 },
    progressBar: {
        width: props.progress === 100 ? 0 : `${props.progress}%`,
        backgroundColor: props.theme.palette.primary.main,
        height: '1ch'
    }
}));
const useDrawerStyles = makeStyles()((theme: Theme) => ({
    root: { display: 'flex' },
    appBar: {
        transition: theme.transitions.create(['margin', 'width'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen
        })
    },
    menuButton: { marginRight: theme.spacing(2) },
    hide: { display: 'none' },
    drawerPaper: { width: drawerWidth },
    drawerHeader: {
        display: 'flex',
        alignItems: 'center',
        padding: theme.spacing(0, 1),
        // necessary for content to be below app bar
        minHeight: 64,
        justifyContent: 'flex-end'
    },
    content: {
        flexGrow: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: theme.spacing(3),
        [theme.breakpoints.down('sm')]: { padding: theme.spacing(1.5) }
    }
}));
const AppContent = observer(() => {
    const { locale, setLocale, t } = useI18n();
    useEffect(() => {
        console.log(Helper.textLogo);
    }, []);
    const { classes: drawerClasses } = useDrawerStyles();
    const [dark, setDark] = useState(false);
    const [view, setView] = useState<MainView>(viewFromLocation);
    const [docsNavigationVersion, setDocsNavigationVersion] = useState(0);
    const headerRef = useRef<HTMLElement>(null);
    const drawerOpener = useRef<HTMLButtonElement>(null);
    const restoreDrawerFocus = useRef(false);
    const [headerHeight, setHeaderHeight] = useState(112);
    useEffect(() => {
        const syncView = () => setView(viewFromLocation());
        window.addEventListener('popstate', syncView);
        window.addEventListener('hashchange', syncView);
        return () => {
            window.removeEventListener('popstate', syncView);
            window.removeEventListener('hashchange', syncView);
        };
    }, []);
    useEffect(() => {
        const header = headerRef.current;
        if (!header) return;
        const observer = new ResizeObserver(() => setHeaderHeight(header.getBoundingClientRect().height));
        observer.observe(header);
        return () => observer.disconnect();
    }, []);
    const publicSite = usePublicSiteInfo(view === 'privacy' || view === 'imprint');
    const handleDarkMode = (event: any) => {
        setDark(event.target.checked);
    };
    const [activeServer, setActiveServer] = useState(new Main());
    const [servers, setServers] = useState([activeServer]);
    const [connected, setConnected] = useState(activeServer.sync.connected);
    const [connectServer, setConnectServer] = useState(false);
    const [lastStatusMessage, setLastStatusMessage] = useState('Not connected.');
    const [openSuccess, setOpenSuccess] = useState('');
    const [openAlert, setOpenAlert] = useState('');
    const [progress, setProgress] = useState(activeServer.sync.progress);
    useEffect(() => {
        setConnected(activeServer.sync.connected);
    }, [activeServer.sync.connected]);
    useEffect(() => {
        setProgress(activeServer.sync.progress);
    }, [activeServer.sync.progress]);
    const getServerName = (server: Main) => {
        if (server.sync?.connected &&
            server.sync?.serverAddress) {
            return server.sync.serverAddress;
        }
        else {
            return t('Server');
        }
    };
    const handleAddServer = () => {
        runInAction(() => {
            const main = new Main();
            servers.push(main);
            setServers(servers);
            setActiveServer(main);
        });
    };
    const handleDrawerOpen = () => {
        setOpen(true);
    };
    const handleDrawerClose = () => {
        restoreDrawerFocus.current = true;
        setOpen(false);
    };
    const theme = createTheme({
        typography: { fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR", sans-serif' },
        palette: {
            primary: dark ? grey : blue,
            secondary: {
                light: pink.A200,
                main: pink.A400,
                dark: pink.A700,
                contrastText: '#fff'
            },
            background: dark
                ? { default: '#303030', paper: grey[800] }
                : { default: grey[50], paper: '#fff' },
            mode: dark ? 'dark' : 'light'
        }
    }, locale === 'ko' ? koKR : locale === 'de' ? deDE : enUS);
    const compact = useMediaQuery(theme.breakpoints.down('md'));
    const [open, setOpen] = React.useState(() => !compact);
    useEffect(() => {
        if (!open && restoreDrawerFocus.current) {
            restoreDrawerFocus.current = false;
            drawerOpener.current?.focus();
        }
    }, [open]);
    const barSurface = { bgcolor: dark ? 'background.paper' : 'primary.main', backgroundImage: 'none', color: '#fff' };
    const wizardActive = view === 'wizard';
    const docsActive = view === 'docs';
    const drawerActive = wizardActive || docsActive;
    const activeDrawerWidth = docsActive ? 360 : drawerWidth;
    const desktopDrawerOpen = drawerActive && open && !compact;
    const showView = (nextView: MainView, focusNavigation = false) => {
        const destination = nextView === 'overview' ? '/' : nextView === 'wizard' ? '/configuration' : nextView === 'docs' ? '/docs#docs/getting-started' : `/${nextView}`;
        if (`${window.location.pathname}${window.location.hash}` !== destination) {
            window.history.pushState(null, '', destination);
        }
        setView(nextView);
        window.scrollTo({ top: 0 });
        if (focusNavigation) window.requestAnimationFrame(() => {
            document.getElementById(nextView === 'privacy' || nextView === 'imprint' ? `${nextView}-heading` : `main-tab-${nextView}`)?.focus();
        });
    };
    useEffect(() => {
        if (compact) setOpen(false);
    }, [compact]);
    const { classes } = useStyles({
        progress: progress,
        theme: theme
    });
    const handleLogout = () => {
        runInAction(() => {
            activeServer.sync.logout()
                .then((res: any) => {
                setConnected(false);
                setOpenSuccess('Logged out.');
                setLastStatusMessage(res.message);
            })
                .catch((err: any) => {
                setOpenAlert(err.response?.data || err.toString());
            });
        });
    };
    const handleServerDialog = () => {
        runInAction(() => {
            setConnectServer(true);
        });
    };
    const onLoginSuccess = () => {
        runInAction(() => {
            setOpenSuccess('Login successful.');
            setLastStatusMessage('Last Login: ' + moment().format());
            setConnectServer(false);
        });
    };
    const handleSubmit = async (password: any) => {
        if (activeServer.sync.connected) {
            handleLogout();
        }
        else {
            runInAction(() => {
                activeServer.sync.login(activeServer.sync.userName, password)
                    .then(() => {
                    onLoginSuccess();
                })
                    .catch((err: any) => {
                    setOpenAlert(err.response?.data || err.toString());
                });
            });
        }
    };
    return (<ThemeProvider theme={theme}>
      <CssBaseline />
      <div className={classes.root}>
        <Snackbar open={openSuccess.length > 0} autoHideDuration={6000} onClose={() => setOpenSuccess('')} message={t(openSuccess)}/>
        <Snackbar open={openAlert.length > 0} autoHideDuration={6000} onClose={() => setOpenAlert('')} message={t(openAlert)}/>
        {connectServer && <ConnectServerDialog onLoginSuccess={onLoginSuccess} handleSubmit={(password: string) => handleSubmit(password)} connectServer={connectServer} setOpenAlert={(err: string) => setOpenAlert(err)} main={activeServer} setClose={() => setConnectServer(false)}/>}
        <Grid container spacing={0}>
          <Grid size={12}>

            <div className={drawerClasses.root}>
              <AppBar ref={headerRef} elevation={0} position="fixed" sx={{ ...barSurface, containerType: 'inline-size', width: desktopDrawerOpen ? `calc(100% - ${activeDrawerWidth}px)` : '100%', ml: desktopDrawerOpen ? `${activeDrawerWidth}px` : 0 }} className={drawerClasses.appBar}>
                <Toolbar sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 1, py: 1, '@container (min-width: 1200px)': { gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)' } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                    {drawerActive && <IconButton ref={drawerOpener} color="inherit" aria-label={t(docsActive ? 'Open docs drawer' : 'open drawer')} aria-controls={open ? (docsActive ? 'docs-drawer' : 'server-drawer') : undefined} aria-expanded={open} onClick={handleDrawerOpen} edge="start" className={clsx(drawerClasses.menuButton, open && drawerClasses.hide)}>
                      <MenuIcon />
                    </IconButton>}
                    <Typography variant="h6" sx={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: { xs: '1rem', sm: '1.25rem' } }}>
                      {wizardActive ? t('System Bootstrapper Control Panel') : 'System Bootstrapper'}
                    </Typography>
                  </Box>
                  <Box component="nav" aria-label={t('Main navigation')} sx={{ gridColumn: '1 / -1', gridRow: 2, justifySelf: 'center', minWidth: 0, maxWidth: '100%', '@container (min-width: 1200px)': { gridColumn: 2, gridRow: 1 } }}>
                    <Tabs value={view === 'overview' || view === 'wizard' || view === 'docs' ? view : false} onChange={(_event, nextView: MainView) => showView(nextView)} aria-label={t('Main navigation')} indicatorColor="secondary" textColor="inherit" sx={{ minHeight: 44, '& .MuiTab-root': { minHeight: 44, minWidth: 0, px: { xs: 1.5, sm: 2 }, fontSize: '0.8125rem' } }}>
                      <Tab value="overview" label={t('Overview')} id="main-tab-overview" aria-controls="main-panel-overview" />
                      <Tab value="wizard" label="Wizard" icon={<ViewInArIcon fontSize="small" />} iconPosition="start" id="main-tab-wizard" aria-controls="main-panel-wizard" />
                      <Tab value="docs" label="Docs" icon={<MenuBookIcon fontSize="small" />} iconPosition="start" id="main-tab-docs" aria-controls="main-panel-docs" />
                    </Tabs>
                  </Box>
                  <Box sx={{ gridColumn: 2, gridRow: 1, justifySelf: 'end', display: 'flex', flexWrap: { xs: 'wrap', sm: 'nowrap' }, justifyContent: 'flex-end', alignItems: 'center', gap: 1, maxWidth: { xs: 156, sm: 'none' }, '@container (min-width: 1200px)': { gridColumn: 3 } }}>
                    <Box role="group" aria-label={t('Language')} sx={{ display: 'flex', alignItems: 'center', '& .MuiButton-root': { minWidth: 32, px: 0.75, fontWeight: 700, color: 'inherit', '&:focus-visible': { outline: '2px solid currentColor', outlineOffset: 2 } } }}>
                      <Button lang="en" aria-label={t('English')} aria-pressed={locale === 'en'} onClick={() => setLocale('en')} sx={{ textDecoration: locale === 'en' ? 'underline' : 'none', textUnderlineOffset: '0.3em' }}>EN</Button>
                      <Box component="span" aria-hidden="true">|</Box>
                      <Button lang="de" aria-label={t('German')} aria-pressed={locale === 'de'} onClick={() => setLocale('de')} sx={{ textDecoration: locale === 'de' ? 'underline' : 'none', textUnderlineOffset: '0.3em' }}>DE</Button>
                      <Box component="span" aria-hidden="true">|</Box>
                      <Button lang="ko" aria-label={t('Korean')} aria-pressed={locale === 'ko'} onClick={() => setLocale('ko')} sx={{ whiteSpace: 'nowrap', textDecoration: locale === 'ko' ? 'underline' : 'none', textUnderlineOffset: '0.3em' }}>한국어</Button>
                    </Box>
                    <DarkModeSwitch handleChange={handleDarkMode}/>
                  </Box>
                </Toolbar>
              </AppBar>
              {drawerActive && <Drawer id={docsActive ? 'docs-drawer' : 'server-drawer'} variant={compact ? 'temporary' : 'persistent'} anchor="left" open={open} onClose={handleDrawerClose} sx={{ width: desktopDrawerOpen ? activeDrawerWidth : 0, flexShrink: 0, '& .MuiDrawer-paper': { width: activeDrawerWidth, maxWidth: 'calc(100vw - 32px)' } }} classes={{ paper: drawerClasses.drawerPaper }}>
                <div className={drawerClasses.drawerHeader}>
                  <IconButton onClick={handleDrawerClose} aria-label={t(docsActive ? 'Close docs drawer' : 'Close server drawer')}>
                    {theme.direction === 'ltr' ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                  </IconButton>
                </div>
                <Divider />

                {docsActive ? <DocsNavigation onNavigate={() => {
                  setDocsNavigationVersion(version => version + 1);
                  if (compact) setOpen(false);
                }} /> : <List>
                  {servers.map((server: any) => (<ListItemButton key={server.id} selected={activeServer.id === server.id} onClick={() => runInAction(() => setActiveServer(server))}>
                      <ListItemIcon>{server.sync.connected ?
                <FiberManualRecordIcon style={{ color: green[500] }}/> : <InboxIcon />}</ListItemIcon>
                      <ListItemText primary={getServerName(server)}/>
                    </ListItemButton>))}
                  <Divider />

                  <ListItemButton onClick={() => runInAction(() => handleAddServer())}>
                    <ListItemIcon>{<AddIcon />}</ListItemIcon>
                    <ListItemText primary={t('Add')}/>
                  </ListItemButton>
                </List>}

              </Drawer>}
              <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', flexGrow: 1, minWidth: 0 }}>
              <main className={drawerClasses.content}>
                <Box aria-hidden="true" sx={{ height: `${headerHeight}px`, flexShrink: 0, mb: 2 }} />
                <div role="tabpanel" hidden={view !== 'overview'} id="main-panel-overview" aria-labelledby="main-tab-overview">
                  <Overview />
                </div>
                <div role="tabpanel" hidden={!wizardActive} inert={!wizardActive} id="main-panel-wizard" aria-labelledby="main-tab-wizard">
                <Paper elevation={0} className={classes.paper}>
                  <Toolbar sx={{ gap: 1, flexWrap: 'wrap', px: { xs: 0, sm: 2 } }}>
                    <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
                      {getServerName(activeServer)}
                    </Typography>

                    <div className={classes.divider}/>
                    {activeServer.sync.connected &&
            <ServerControlButton setOpenAlert={(value: string) => setOpenAlert(value)} setOpenSuccess={(value: string) => setOpenSuccess(value)} setLastStatusMessage={(value: string) => setLastStatusMessage(value)} main={activeServer}/>}

                    <ButtonGroup variant={'contained'} disableElevation>
                      <Button aria-label={t('Edit connection')} color={connected ? 'secondary' : 'primary'} onClick={handleServerDialog}>
                        <EditIcon />
                      </Button>
                      <Button color={connected ? 'secondary' : 'primary'} startIcon={connected ? <LockIcon /> : <LockOpenIcon />} onClick={() => handleSubmit(activeServer.config?.syncPass)}>
                        {t(connected ? 'Disconnect' : 'Connect')}
                      </Button>
                    </ButtonGroup>

                  </Toolbar>
                </Paper>
                {activeServer.sync.connected && (<>
                    <Grid size={12}>
                      <div className={classes.progressBar}></div>
                    </Grid>
                    <Paper elevation={0} className={classes.paper}>
                      <Typography>
                        {lastStatusMessage.startsWith('Last Login: ') ? `${t('Last Login:')} ${lastStatusMessage.slice('Last Login: '.length)}` : t(lastStatusMessage)}
                      </Typography>
                    </Paper>
                  </>)}
                <FormWizard main={activeServer} setOpenAlert={setOpenAlert} setOpenSuccess={setOpenSuccess}/>
                </div>
                <div role="tabpanel" hidden={view !== 'docs'} id="main-panel-docs" aria-labelledby="main-tab-docs">
                  {view === 'docs' && <Docs navigationVersion={docsNavigationVersion} />}
                </div>
                {view === 'privacy' && <section aria-labelledby="privacy-heading">
                  <Privacy {...publicSite} />
                </section>}
                {view === 'imprint' && <section aria-labelledby="imprint-heading">
                  <Imprint {...publicSite} />
                </section>}
              </main>
                <Box component="footer" sx={{ mt: 'auto', py: 3, px: 2, textAlign: 'center', ...barSurface }}>
                    <Box component="nav" aria-label={t('Footer navigation')} sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 3, mb: 2 }}>
                      {(['overview', 'wizard', 'docs', 'privacy', 'imprint'] as const).map(destination => (<Link key={destination} component="button" type="button" id={`footer-${destination}`} color="inherit" underline="hover" aria-current={view === destination ? 'page' : undefined} onClick={() => showView(destination, true)}>
                        {t(destination === 'overview' ? 'Overview' : destination === 'wizard' ? 'Wizard' : destination === 'docs' ? 'Docs' : destination === 'privacy' ? 'Privacy' : 'Imprint')}
                      </Link>))}
                    </Box>
                    <Link href="https://github.com/kihyoun/system" color="inherit" sx={{ textDecorationColor: 'rgba(255,255,255,0.7)' }}>{t('System Bootstrapper on GitHub')}</Link>
                </Box>
              </Box>
            </div>
          </Grid>
        </Grid>
      </div>

    </ThemeProvider>);
});
export default function App() {
    return <I18nProvider><AppContent /></I18nProvider>;
}
