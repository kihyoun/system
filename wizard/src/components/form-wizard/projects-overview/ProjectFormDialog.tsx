import { applicationAliasError } from '../../../api/ApplicationAliases';
import { useI18n } from '../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  Snackbar,
  Step,
  StepButton,
  StepContent,
  Stepper,
} from '@mui/material';
import { observer } from 'mobx-react';
import MainFields from './fields/MainFields';
import ProjectConfig from '../../../api/ProjectConfig';
import ProdFields from './fields/ProdFields';
import BetaFields from './fields/BetaFields';
import ReviewFields from './fields/ReviewFields';
import { runInAction } from 'mobx';
import GitlabRunnerFields from './fields/GitlabRunnerFields';
const useStyles = makeStyles()((theme) => ({
  paper: {
    padding: theme.spacing(2),
    margin: 'auto',
    maxWidth: 1900,
    marginBottom: '1ch',
  },
  actionsContainer: { marginBottom: theme.spacing(2) },
  resetContainer: { padding: theme.spacing(3) },
  button: {
    marginTop: theme.spacing(1),
    marginRight: theme.spacing(1),
  },
}));
const ProjectFormDialog = observer((props: any) => {
  const { t } = useI18n();
  const { classes } = useStyles();
  const [projectConfig, setProjectConfig] = useState(new ProjectConfig(props.main));
  const [projectPlaceholderConfig, setProjectPlaceholderConfig] = useState(
    new ProjectConfig(props.main),
  );
  const [activeStep, setActiveStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [namespaces, setNamespaces] = useState<any[]>([]);
  const [availability, setAvailability] = useState('unknown');
  const [availabilityMessage, setAvailabilityMessage] = useState(
    'Connect to Sync to verify availability.',
  );
  const editing = props.activeProject !== '';
  const key = projectConfig.projectKey;
  const namespaceId = projectConfig.namespaceId;
  useEffect(() => {
    let current = true;
    if (props.open && props.main.sync.connected) {
      props.main.sync
        .projectRequest('/projects/namespaces')
        .then((result: any) => {
          if (current) setNamespaces(result.namespaces);
        })
        .catch(() => {
          if (current)
            setAvailabilityMessage('Could not load GitLab namespaces. Check Sync and GitLab.');
        });
    }
    return () => {
      current = false;
    };
  }, [props.open, props.main.sync.connected]);
  useEffect(() => {
    let current = true;
    if (!props.open || editing) return;
    setAvailability('unknown');
    if (!/^[a-z0-9]+$/.test(key)) {
      setAvailabilityMessage('Required: lowercase a-z and digits 0-9 only.');
      return;
    }
    if (props.main.projects.has(key)) {
      setAvailability('occupied');
      setAvailabilityMessage('Project Key already exists locally.');
      return;
    }
    if (!namespaceId || !props.main.sync.connected) {
      setAvailabilityMessage('Connect to Sync and select a namespace.');
      return;
    }
    setAvailability('checking');
    setAvailabilityMessage('Checking GitLab availability…');
    const timer = setTimeout(() => {
      props.main.sync
        .projectRequest(
          '/projects/availability?projectKey=' +
            encodeURIComponent(key) +
            '&namespaceId=' +
            encodeURIComponent(namespaceId),
        )
        .then((result: any) => {
          if (!current) return;
          setAvailability(result.availability);
          setAvailabilityMessage(
            result.availability === 'available'
              ? 'Available in selected namespace.'
              : 'Repository already exists. Choose another key.',
          );
        })
        .catch(() => {
          if (current) {
            setAvailability('unknown');
            setAvailabilityMessage('Could not verify availability. Check Sync and GitLab.');
          }
        });
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, namespaceId, props.open, editing, props.main.sync.connected]);
  const [openAlert, setOpenAlert] = useState('');
  const [openSuccess, setOpenSuccess] = useState(false);
  const [openEditSuccess, setOpenEditSuccess] = useState(false);
  useEffect(() => {
    const config = props.main.projects.get(props.activeProject);
    setActiveStep(0);
    setProjectConfig(
      typeof config !== 'undefined'
        ? new ProjectConfig(props.main, config)
        : new ProjectConfig(props.main),
    );
    setProjectPlaceholderConfig(
      typeof config !== 'undefined'
        ? new ProjectConfig(props.main, config)
        : new ProjectConfig(props.main),
    );
  }, [props.activeProject, props.open]);
  const steps = [
    {
      label: 'Start',
      enabled: (projectConfig.projectKey.length > 0).toString(),
    },
    {
      label: 'Production',
      enabled: projectConfig.useProdHost,
    },
    {
      label: 'Beta',
      enabled: projectConfig.useBetaHost,
    },
    {
      label: 'Review Apps',
      enabled: projectConfig.useReviewHost,
    },
    {
      label: 'Additional runners (optional)',
      enabled: (projectConfig.gitlabRunnerScale > 0).toString(),
    },
  ];
  const handleStep = (step: number) => () => {
    runInAction(() => {
      if (step > steps.length - 1) {
        handleSave();
      } else {
        setActiveStep(step);
      }
    });
  };
  const handleSave = async () => {
    if (busy) return;
    const aliasError = applicationAliasError(projectConfig);
    if (aliasError) {
      setOpenAlert(aliasError);
      return;
    }
    if (props.activeProject === '' || projectConfig.bootstrapPending) {
      if (!projectConfig.bootstrapPending && availability !== 'available') return;
      if (!/^[a-z0-9]+$/.test(projectConfig.projectKey)) return;
      setBusy(true);
      try {
        await props.main.sync.createProject(projectConfig);
      } catch (error) {
        if (error.conflict) {
          setAvailability('occupied');
          setAvailabilityMessage('Repository already exists. Choose another key.');
        }
        setOpenAlert(
          error.response?.data?.message || error.message || 'Project creation failed. Retry Save.',
        );
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    runInAction(() => {
      if (props.activeProject === '') {
        if (props.main.projects.has(projectConfig.projectKey)) {
          setOpenAlert(projectConfig.projectKey);
        } else {
          props.main.addProject(projectConfig);
          props.handleClose();
          setOpenSuccess(true);
        }
      } else {
        props.main.saveProject(projectConfig, projectPlaceholderConfig);
        props.handleClose();
        setOpenEditSuccess(true);
      }
    });
  };
  return (
    <>
      <Snackbar
        open={t(openAlert).length > 0}
        autoHideDuration={6000}
        onClose={() => setOpenAlert('')}
        message={<>{t(openAlert)}</>}
      />
      <Snackbar
        open={openSuccess}
        autoHideDuration={6000}
        onClose={() => setOpenSuccess(false)}
        message={t('Project successfully added.')}
      />
      <Snackbar
        open={openEditSuccess}
        autoHideDuration={6000}
        onClose={() => setOpenEditSuccess(false)}
        message={t('Changes successfully saved.')}
      />
      <Dialog
        transitionDuration={0}
        fullWidth={true}
        maxWidth={'lg'}
        open={props.open}
        onClose={() => {
          if (!busy) props.handleClose();
        }}
        aria-labelledby="form-dialog-title"
      >
        {(props.activeProject === '' && (
          <DialogTitle id="form-dialog-title">{t('Create Project Configuration')}</DialogTitle>
        )) || (
          <DialogTitle id="form-dialog-title">
            {t('Edit')} {projectPlaceholderConfig.projectKey}
          </DialogTitle>
        )}
        <DialogContent>
          <DialogContentText>
            {t(
              "Configure an application's Production, Beta and Review App environments. NGINX proxies route requests to the application containers. Save creates a private GitLab repository and installs the generated CI configuration. React, Angular and general web templates include source and Dockerfile; Save starts their first pipeline. Empty repositories wait for your application source.",
            )}
          </DialogContentText>
          {busy && (
            <p role="status">
              {t(
                'Creating application, installing CI, configuring routing and starting the pipeline… You can continue when setup completes.',
              )}
            </p>
          )}
          <fieldset disabled={busy} style={{ border: 0 }}>
            <Grid container>
              <Grid size={{ xs: 12, md: 3 }}>
                <Stepper activeStep={activeStep} nonLinear orientation="vertical">
                  {steps.map((step, index) => (
                    <Step key={step.label}>
                      <StepButton onClick={handleStep(index)}>{t(step.label)}</StepButton>

                      <StepContent>
                        <div className={classes.actionsContainer}>
                          <div>
                            <Button
                              disableElevation
                              disabled={activeStep === 0}
                              onClick={handleStep(index - 1)}
                              className={classes.button}
                            >
                              {t('Back')}
                            </Button>
                            <Button
                              disableElevation
                              variant="contained"
                              onClick={handleStep(index + 1)}
                              color="primary"
                              className={classes.button}
                            >
                              {activeStep === steps.length - 1 ? t('Finish') : t('Next')}
                            </Button>
                          </div>
                        </div>
                      </StepContent>
                    </Step>
                  ))}
                </Stepper>
              </Grid>
              <Grid size={{ xs: 12, md: 8 }}>
                <MainFields
                  editing={editing}
                  availability={availability}
                  message={availabilityMessage}
                  namespaces={namespaces}
                  destination={
                    (namespaces.find((n: any) => String(n.id) === String(namespaceId))?.path ||
                      '') +
                    '/' +
                    key
                  }
                  openAlert={(value: string) => runInAction(() => setOpenAlert(value))}
                  hidden={activeStep !== 0}
                  config={projectConfig}
                  placeholder={projectPlaceholderConfig}
                />
                <ProdFields
                  init={props.activeProject === ''}
                  hidden={activeStep !== 1}
                  config={projectConfig}
                  placeholder={projectPlaceholderConfig}
                />
                <BetaFields
                  init={props.activeProject === ''}
                  hidden={activeStep !== 2}
                  config={projectConfig}
                  placeholder={projectPlaceholderConfig}
                />
                <ReviewFields
                  init={props.activeProject === ''}
                  hidden={activeStep !== 3}
                  config={projectConfig}
                  placeholder={projectPlaceholderConfig}
                />
                <GitlabRunnerFields
                  init={props.activeProject === ''}
                  hidden={activeStep !== 4}
                  config={projectConfig}
                  placeholder={projectPlaceholderConfig}
                />
              </Grid>
            </Grid>
          </fieldset>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={props.handleClose} color="primary">
            {t('Cancel')}
          </Button>
          <Button
            disabled={busy || (!editing && availability !== 'available')}
            onClick={handleSave}
            color="primary"
          >
            {t('Save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
});
export default ProjectFormDialog;
