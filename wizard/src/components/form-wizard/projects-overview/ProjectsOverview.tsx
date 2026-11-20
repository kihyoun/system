import { useI18n } from '../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useState } from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import { Button, Collapse, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Grid, IconButton, Snackbar, Toolbar } from '@mui/material';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import ProjectFormDialog from './ProjectFormDialog';
import ProjectConfig from '../../../api/ProjectConfig';
import { observer } from 'mobx-react';
import ProjectCard from './ProjectCard';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { runInAction } from 'mobx';
import ButtonGroup from '@mui/material/ButtonGroup';
import DownloadReactCiDialog from '../dialog/DownloadReactCiDialog';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import WizardSourceDialog from './WizardSourceDialog';
import WizardBuildDialog from './WizardBuildDialog';
import WizardEnvironmentsDialog from './WizardEnvironmentsDialog';
const useStyles = makeStyles()({
    table: {
        minWidth: 650,
        overflow: 'hidden'
    },
    button: {
        marginBottom: '1ch',
        marginTop: '3ch'
    },
    divider: {
        flexGrow: 1,
        witdh: '100%'
    }
});
const useRowStyles = makeStyles()({ root: { '& > *': { borderBottom: 'unset' } } });
const ProjectsOverview = observer((props: any) => {
    const { t } = useI18n();
    const { classes } = useStyles();
    const { classes: rowClasses } = useRowStyles();
    const [open, setOpen] = useState(false);
    const [cellOpen, setCellOpen] = useState('');
    const [openDelete, setOpenDelete] = useState(false);
    const [activeProject, setActiveProject] = useState('');
    const [openDeleteSuccess, setOpenDeleteSuccess] = useState(false);
    const [downloadReactCi, setDownloadReactCi] = useState(false);
    const [wizardSourceOpen, setWizardSourceOpen] = useState(false);
    const [wizardBuildOpen, setWizardBuildOpen] = useState(false);
    const [wizardEnvironmentsOpen, setWizardEnvironmentsOpen] = useState(false);
    const handleDelete = () => {
        runInAction(() => {
            setOpenDelete(false);
            props.main.projects.delete(activeProject);
            setActiveProject('');
            setOpenDeleteSuccess(true);
        });
    };
    const projects = [...props.main.projects.values()].sort((a: ProjectConfig, b: ProjectConfig) => Number(!!b.repository?.systemProject) - Number(!!a.repository?.systemProject));
    return (<>
      {wizardSourceOpen && <WizardSourceDialog sync={props.main.sync} onClose={() => setWizardSourceOpen(false)}/>}
      {wizardBuildOpen && <WizardBuildDialog sync={props.main.sync} onClose={() => setWizardBuildOpen(false)}/>}
      {wizardEnvironmentsOpen && <WizardEnvironmentsDialog sync={props.main.sync} onClose={() => setWizardEnvironmentsOpen(false)}/>}
      <Snackbar open={openDeleteSuccess} autoHideDuration={6000} onClose={() => setOpenDeleteSuccess(false)} message={t("Project successfully deleted.")}/>
      {downloadReactCi && <DownloadReactCiDialog main={props.main} project={activeProject} setClose={() => setDownloadReactCi(false)}/>}
      <TableContainer component={Paper} elevation={0}>
        <Table className={classes.table} size="small" aria-label={t("a dense table")}>
          <TableHead>
            <TableRow>
              <TableCell>{t("Project Key")}</TableCell>
              <TableCell>URL</TableCell>
              <TableCell>{t("Beta URL")}</TableCell>
              <TableCell>{t("Review App Domain(s)")}</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {projects.map((projectConfig: ProjectConfig) => (<React.Fragment key={projectConfig.projectKey}>
                <TableRow className={rowClasses.root} onClick={() => setCellOpen(cellOpen !== projectConfig.projectKey ? projectConfig.projectKey : '')}>
                  <TableCell component="th" scope="row">
                    {projectConfig.projectKey}
                    {projectConfig.repository?.systemProject && t(" · System interface")}
                  </TableCell>
                  <TableCell>{projectConfig.useProdHost === 'true' && projectConfig.prodHostInfo.url || '-'}</TableCell>
                  <TableCell>{projectConfig.useBetaHost === 'true' && projectConfig.betaHostInfo.url || '-'}</TableCell>
                  <TableCell>{projectConfig.useReviewHost === 'true'
                && projectConfig.reviewHostInfo.url || '-'}</TableCell>
                  <TableCell>
                    <ButtonGroup variant="text" color="primary" aria-label={t("text primary button group")}>

                      <IconButton aria-label={t("edit")} disabled={!!projectConfig.repository?.systemProject} onClick={event => {
                setActiveProject(projectConfig.projectKey);
                setOpen(true);
                event.stopPropagation();
                event.preventDefault();
            }}>
                        <EditIcon />
                      </IconButton>
                      <IconButton aria-label={t("delete")} disabled={!!projectConfig.repository?.systemProject} onClick={event => {
                setActiveProject(projectConfig.projectKey);
                setOpenDelete(true);
                event.stopPropagation();
                event.preventDefault();
            }}>
                        <DeleteIcon />
                      </IconButton>
                      <IconButton aria-label={t("export")} onClick={event => {
                runInAction(() => {
                    setActiveProject(projectConfig.projectKey);
                    setDownloadReactCi(true);
                });
                event.stopPropagation();
                event.preventDefault();
            }}>
                        <SaveAltIcon />
                      </IconButton>
                    </ButtonGroup>

                  </TableCell>

                </TableRow>
                <TableRow>
                  <TableCell colSpan={5}>
                    <Collapse in={cellOpen === projectConfig.projectKey} timeout="auto" unmountOnExit>
                      {projectConfig.repository && <p>
                        <a href={projectConfig.repository.webUrl} target="_blank" rel="noopener noreferrer">
                          {t("Repository")}</a>{' · '}
                        <a href={projectConfig.repository.pipelineUrl} target="_blank" rel="noopener noreferrer">
                          {t("Pipelines")}</a>{' · '}
                        {projectConfig.repository.systemProject
                    ? projectConfig.repository.managementMode === 'source-primary'
                        ? t("Canonical Wizard repository — develop, review and build here. Production promotion remains explicit.")
                        : t("Existing Wizard interface — configured under General. Initialize source, verify a candidate and configure optional Review/Beta explicitly.")
                    : projectConfig.repository.deploymentState === 'awaiting-source'
                        ? t("Repository ready — deployment awaits application source.")
                        : <a href={projectConfig.repository.initialPipeline?.webUrl ||
                                projectConfig.repository.pipelineUrl} target="_blank" rel="noopener noreferrer">
                              {t("Application generated — check build and deployment status")}</a>}
                      </p>}
                      <Grid container spacing={3}>
                        {projectConfig.repository?.systemProject && <Grid size={12}>
                          <p>{t("Production points to the running system interface. Configure Beta and Review separately.")}{' '}{projectConfig.repository.managementMode === 'source-primary'
                                ? t(" Native pipeline checks and environment configuration preserve the running interface.")
                                : t(" Importing source and configuring environments preserve the running interface.")}</p>
                          <Button color="primary" disabled={!props.main.sync.connected} onClick={() => setWizardSourceOpen(true)}>{projectConfig.repository.managementMode === 'source-primary' ? t("Wizard source") : t("Initialize Wizard source")}</Button>
                          <Button color="primary" disabled={!props.main.sync.connected} onClick={() => setWizardBuildOpen(true)}>{projectConfig.repository.managementMode === 'source-primary' ? t("Native build status") : t("Build and verify Wizard")}</Button>
                          <Button color="primary" disabled={!props.main.sync.connected} onClick={() => setWizardEnvironmentsOpen(true)}>{t("Configure Review and Beta")}</Button>
                        </Grid>}
                        <ProjectCard hostInfo={projectConfig.prodHostInfo} systemProject={!!projectConfig.repository?.systemProject} handleChange={(checked: boolean) => {
                if (!projectConfig.repository?.systemProject)
                    runInAction(() => projectConfig.useProdHost = checked.toString());
            }}/>
                        <ProjectCard hostInfo={projectConfig.betaHostInfo} systemProject={!!projectConfig.repository?.systemProject} handleChange={(checked: boolean) => {
                if (!projectConfig.repository?.systemProject)
                    runInAction(() => projectConfig.useBetaHost = checked.toString());
            }}/>
                        <ProjectCard hostInfo={projectConfig.reviewHostInfo} systemProject={!!projectConfig.repository?.systemProject} handleChange={(checked: boolean) => {
                if (!projectConfig.repository?.systemProject)
                    runInAction(() => projectConfig.useReviewHost = checked.toString());
            }}/>
                      </Grid>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>))}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog transitionDuration={0} open={openDelete} aria-labelledby="alert-dialog-title" aria-describedby="alert-dialog-description">
        <DialogTitle id="alert-dialog-title">{t("Delete")}{' '}{activeProject}</DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
           {t("Are you sure?")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDelete(false)} color="primary">
            {t("Disagree")}</Button>
          <Button onClick={handleDelete} color="primary" autoFocus>
            {t("Agree")}</Button>
        </DialogActions>
      </Dialog>

      <Toolbar>
        <div className={classes.divider}/>
        <Button variant="contained" color="primary" disableElevation onClick={() => {
            setActiveProject('');
            setOpen(true);
        }} className={classes.button} startIcon={<PlaylistAddIcon />}>
        {t("Add Project")}</Button>
      </Toolbar>

      <ProjectFormDialog open={open} activeProject={activeProject} main={props.main} handleClose={() => setOpen(false)}/>
    </>);
});
export default ProjectsOverview;
