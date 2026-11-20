import { useI18n } from '../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useState } from 'react';
import { Button, Grid, Paper, Step, StepButton, StepContent, Stepper } from '@mui/material';
import StartFields from './fields/StartFields';
import SSLSettingsFields from './fields/SSLSettingsFields';
import { observer } from 'mobx-react';
import { runInAction } from 'mobx';
import SyncServerFields from './fields/SyncServerFields';
import WizardFields from './fields/WizardFields';
import WebsiteFields from './fields/WebsiteFields';
const useStyles = makeStyles()(theme => ({
    paper: {
        padding: theme.spacing(2),
        margin: 'auto',
        maxWidth: 1900,
        marginBottom: '1ch'
    },
    actionsContainer: { marginBottom: theme.spacing(2) },
    resetContainer: { padding: theme.spacing(3) },
    button: {
        marginTop: theme.spacing(1),
        marginRight: theme.spacing(1)
    }
}));
const GeneralForm = observer((props: any) => {
    const { t } = useI18n();
    const { classes } = useStyles();
    const [startInit, setStartInit] = useState(props.main.init);
    const [sslInit, setSSLInit] = useState(props.main.init);
    const [syncInit, setSyncInit] = useState(props.main.init);
    const [wizardInit, setWizardInit] = useState(props.main.init);
    useEffect(() => {
        runInAction(() => {
            setStartInit(props.main.init);
            setSyncInit(props.main.init);
            setWizardInit(props.main.init);
            setSSLInit(props.main.init);
            props.main.init = false;
        });
    }, [props.main.id]);
    const [activeStep, setActiveStep] = useState(0);
    const steps = [{
            label: 'Start',
            enabled: true
        }, {
            label: 'SSL',
            enabled: !sslInit
        }, {
            label: 'Sync',
            enabled: !syncInit
        }, {
            label: 'Wizard',
            enabled: !wizardInit
        }, {
            label: 'Website',
            enabled: true
        }];
    const handleStep = (step: number) => () => {
        runInAction(() => {
            switch (step) {
                case 0:
                    setStartInit(false);
                    break;
                case 1:
                    setSSLInit(false);
                    break;
                case 2:
                    setSyncInit(false);
                    break;
                case 3:
                    setWizardInit(false);
                    break;
            }
            if (step > steps.length - 1) {
                console.log('laststep');
            }
            else {
                setActiveStep(step);
            }
        });
    };
    return (<Paper className={classes.paper} elevation={0}>
      <Grid container spacing={3} sx={{
        justifyContent: "center"
    }}>
        <Grid size={{ xs: 12, md: 3 }}>
          <Stepper activeStep={activeStep} nonLinear orientation="vertical">
            {steps.map((step, index) => (<Step key={step.label}>
                <StepButton onClick={handleStep(index)}>
                  {t(step.label)}
                </StepButton>
                <StepContent>
                  <div className={classes.actionsContainer}>
                    <div>
                      <Button disableElevation disabled={activeStep === 0} onClick={handleStep(index - 1)} className={classes.button}>{t("Back")}</Button>
                      <Button disableElevation variant="contained" onClick={handleStep(index + 1)} color="primary" className={classes.button}>
                        {activeStep === steps.length - 1 ? t("Finish") : t("Next")}
                      </Button>
                    </div>
                  </div>
                </StepContent>
              </Step>))}
          </Stepper>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <StartFields init={startInit} hidden={activeStep !== 0} main={props.main}/>
          <SSLSettingsFields init={sslInit} hidden={activeStep !== 1} main={props.main}/>
          <SyncServerFields init={syncInit} hidden={activeStep !== 2} main={props.main}/>
          <WizardFields init={wizardInit} hidden={activeStep !== 3} main={props.main}/>
          <WebsiteFields hidden={activeStep !== 4} main={props.main}/>
        </Grid>
      </Grid>
    </Paper>);
});
export default GeneralForm;
