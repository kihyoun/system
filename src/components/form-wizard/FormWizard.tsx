import { useI18n } from '../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useState } from 'react';
import Paper from '@mui/material/Paper';
import Grid from '@mui/material/Grid';
import { Button, ButtonGroup, ListItemIcon, Tabs, Toolbar, Typography } from '@mui/material';
import Tab from '@mui/material/Tab';
import GeneralForm from './general-form/GeneralForm';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import DownloadDockerDialog from './dialog/DownloadDockerDialog';
import DownloadProjectsDialog from './dialog/DownloadProjectsDialog';
import ProjectsOverview from './projects-overview/ProjectsOverview';
import DownloadJsonDialog from './dialog/DownloadJsonDialog';
import LaunchIcon from '@mui/icons-material/Launch';
import { observer } from 'mobx-react';
import { runInAction } from 'mobx';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import GetAppIcon from '@mui/icons-material/GetApp';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import { derivedWarning } from '../DerivedLabel';
import PreviewSetupDialog from './projects-overview/PreviewSetupDialog';
import BackupWorkflowDialog from './dialog/BackupWorkflowDialog';
import SystemDiagnosticsDialog from '../dialogs/SystemDiagnosticsDialog';
import TokenOverviewDialog from '../dialogs/TokenOverviewDialog';
const TabPanel = (props: any) => {
    const { children, value, index, ...other } = props;
    return (<div role="tabpanel" hidden={value !== index} id={`simple-tabpanel-${index}`} aria-labelledby={`simple-tab-${index}`} {...other}>
      {value === index && <>{children}</>}
    </div>);
};
const a11yProps = (index: any) => {
    return {
        id: `simple-tab-${index}`,
        'aria-controls': `simple-tabpanel-${index}`
    };
};
const useStyles = makeStyles<{
    progress?: number;
}>()((theme, props) => ({
    paper: {
        padding: theme.spacing(2),
        margin: 'auto',
        maxWidth: 1900,
        marginBottom: '1ch'
    },
    divider: { flexGrow: 1 },
    buttonDivider: { width: '1ch' },
    input: { display: 'none' },
    progressBar: {
        width: props.progress === 100 ? 0 : `${props.progress ?? 0}%`,
        backgroundColor: theme.palette.primary.main,
        height: '1ch'
    },
    downloadButtons: { textAlign: 'center' }
}));
const FormWizard = observer((props: any) => {
    const { t } = useI18n();
    const [main, setMain] = useState(props.main);
    const [tab, setTab] = useState(0);
    const [downloadDocker, setDownloadDocker] = useState(false);
    const [downloadProjects, setDownloadProjects] = useState(false);
    const [downloadJson, setDownloadJson] = useState(false);
    const [files, setFiles] = useState([]);
    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
    const [progress, setProgress] = useState(100);
    const [operation, setOperation] = useState('');
    const { classes } = useStyles({ progress: progress });
    useEffect(() => {
        runInAction(() => {
            setMain(props.main);
        });
    }, [props.main]);
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };
    const handleClose = () => {
        setAnchorEl(null);
    };
    const handleChange = (event: any, newTab: number) => {
        setTab(newTab);
    };
    const onChangeHandler = (event: any) => {
        if (event.target?.files?.length < 1 || event.dataTransfer?.files?.length < 1) {
            return;
        }
        const file = event.target?.files?.[0] || event.dataTransfer?.files?.[0];
        const reader = new FileReader();
        reader.readAsText(file, 'UTF-8');
        reader.onprogress = function (evt: any) {
            setProgress(100 * (evt.loaded / evt.total));
        };
        reader.onload = function (evt: any) {
            try {
                runInAction(() => {
                    main.importFile(file, evt.target.result);
                    props.setOpenSuccess('Import finished: ' + file.name);
                    if (event.target) {
                        setFiles([]);
                    }
                });
            }
            catch (e) {
                runInAction(() => {
                    props.setOpenAlert('error reading file: ' + e.toString());
                    if (event.target) {
                        setFiles([]);
                    }
                });
            }
        };
        reader.onerror = function () {
            props.setOpenAlert('error reading file');
        };
    };
    return (<React.Fragment>
      {operation === 'previews' && <PreviewSetupDialog main={main} close={() => setOperation('')}/>}
      {operation === 'backup' && <BackupWorkflowDialog sync={main.sync} onClose={() => setOperation('')}/>}
      {operation === 'credentials' && <TokenOverviewDialog main={main} onClose={() => setOperation('')}/>}
      {operation === 'diagnostics' && <SystemDiagnosticsDialog open onClose={() => setOperation('')}
        loadTargets={() => main.sync.diagnosticRequest('/diagnostics')}
        checkConnection={target => main.sync.diagnosticRequest('/diagnostics/connection', {target})}
        tryHelperPull={runner => main.sync.diagnosticRequest('/diagnostics/pull', {runner})}/>}
      {downloadDocker && <DownloadDockerDialog main={main} setClose={() => setDownloadDocker(false)}/>}
      {downloadProjects && <DownloadProjectsDialog main={main} setClose={() => setDownloadProjects(false)}/>}
      {downloadJson && <DownloadJsonDialog main={main} setClose={() => setDownloadJson(false)}/>}
      <Grid size={12}>
        <div className={classes.progressBar}></div>
      </Grid>
      <Grid container direction="row" spacing={0} onDragOver={ev => {
            ev.preventDefault();
        }} onDrop={(ev: any) => {
            if (ev.dataTransfer.files.length > 0
                && (ev.dataTransfer.files[0].name.substr(-4) === '.env'
                    || ev.dataTransfer.files[0].name.substr(-4) === 'json')) {
                onChangeHandler(ev);
                ev.preventDefault();
            }
        }} sx={{
        alignItems: "center",
        justifyContent: "center"
    }}>
        <Grid size={12}>
          <Paper className={classes.paper} elevation={0}>
            {Object.keys(main.derivedFields).length > 0 && (<Typography role="status" color="textSecondary">
                * {t(derivedWarning)} {t("Unavailable values are left blank; credentials and runner settings must be supplied manually.")}</Typography>)}
            <Toolbar>
              <Tabs indicatorColor="primary" textColor="primary" value={tab} onChange={handleChange}>
                <Tab label={t("General")} {...a11yProps(0)}/>
                <Tab label={t("Projects")} {...a11yProps(1)}/>
              </Tabs>

              <div className={classes.divider}/>

              <ButtonGroup disableElevation color="primary" className={classes.downloadButtons} aria-label={t("vertical contained primary button group")} variant="text">

                <Button htmlFor="contained-button-file" aria-haspopup="true" component="label" startIcon={<InsertDriveFileIcon />} color="primary">
                {t("Open")}</Button>
                <input accept="application/json, .env" className={classes.input} id="contained-button-file" multiple value={files} type="file" onChange={onChangeHandler}/>
                <Button aria-controls="simple-menu" aria-haspopup="true" color="primary" startIcon={<CloudDownloadIcon />} onClick={handleClick}>
                {t("Backup")}</Button>

              </ButtonGroup>

              <Menu anchorEl={anchorEl} keepMounted transitionDuration={0} elevation={1} open={Boolean(anchorEl)} onClose={handleClose}>
                <MenuItem onClick={() => props.main.exportZip()}>
                  <ListItemIcon>
                    <GetAppIcon fontSize="small"/>
                  </ListItemIcon>
                  <Typography variant="inherit">bootstrapper.zip</Typography>
                </MenuItem>
                <MenuItem onClick={() => setDownloadJson(true)}>
                  <ListItemIcon>
                    <LaunchIcon fontSize="small"/>
                  </ListItemIcon>
                  <Typography variant="inherit">bootstrapper.json</Typography>
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => setDownloadDocker(true)}>
                  <ListItemIcon>
                    <LaunchIcon fontSize="small"/>
                  </ListItemIcon>
                  <Typography variant="inherit">.docker.env</Typography>
                </MenuItem>
                <MenuItem onClick={() => setDownloadProjects(true)}>
                  <ListItemIcon>
                    <LaunchIcon fontSize="small"/>
                  </ListItemIcon>
                  <Typography variant="inherit">{t("Proxies")}</Typography>
                </MenuItem>
              </Menu>
            </Toolbar>
            <ButtonGroup variant="text" sx={{flexWrap: 'wrap'}} aria-label={t('Platform operations')}>
              <Button disabled={!main.sync.connected} onClick={() => setOperation('previews')}>{t('Set up development previews')}</Button>
              <Button disabled={!main.sync.connected} onClick={() => setOperation('backup')}>{t('Harvest and configuration backup')}</Button>
              <Button disabled={!main.sync.connected} onClick={() => setOperation('credentials')}>{t('Credential expiry')}</Button>
              <Button disabled={!main.sync.connected} onClick={() => setOperation('diagnostics')}>{t('System diagnostics')}</Button>
            </ButtonGroup>
          </Paper>
        </Grid>
        <Grid size={12}>
          <TabPanel value={tab} index={0}>
            <GeneralForm main={main}/>
          </TabPanel>
          <TabPanel value={tab} index={1}>
            <ProjectsOverview main={main}/>
          </TabPanel>
        </Grid>
      </Grid>
    </React.Fragment>);
});
export default FormWizard;
