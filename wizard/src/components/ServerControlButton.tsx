import { useI18n } from '../i18n';
import React from 'react';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import SyncIcon from '@mui/icons-material/Sync';
import { runInAction } from 'mobx';
import PushDialog from './dialogs/PushDialog';
export default function ServerControlButton(props: any) {
    const { t } = useI18n();
    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
    const [push, setPush] = React.useState(false);
    const [harvestPending, setHarvestPending] = React.useState(false);
    const harvestActive = React.useRef(false);
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (!harvestActive.current) setAnchorEl(event.currentTarget);
    };
    const handleClose = () => {
        setAnchorEl(null);
    };
    const handleFetch = () => {
        runInAction(() => {
            props.main.sync.fetch().then((res: any) => {
                const msg = (Object.keys(props.main.derivedFields).length > 0
                    ? 'Derived suggestions loaded. Please verify all settings before pushing. '
                    : 'Import finished. ') +
                    (res > 0 ? `(Skipped ${res} File(s)` : '');
                props.setOpenSuccess(msg);
                props.setLastStatusMessage(msg);
                handleClose();
            }).catch((err: any) => {
                props.setOpenAlert(err.toString());
                handleClose();
            });
        });
    };
    const handlePush = (impact?: string) => {
        runInAction(async () => {
            try {
                props.setOpenSuccess('Sending Data...');
                const result = await props.main.sync.push(impact);
                props.setOpenSuccess(result.data?.message || 'Ready.');
                handleClose();
                setPush(false);
            }
            catch (err: any) {
                const msg = err.response?.data || err.toString();
                props.setOpenAlert(msg);
                props.setLastStatusMessage(msg);
                handleClose();
                setPush(false);
            }
        });
    };
    const handleRestart = () => {
        runInAction(async () => {
            try {
                props.setOpenSuccess('Restarting...');
                await props.main.sync.restart();
                props.setOpenSuccess('Ready.');
                handleClose();
            }
            catch (err: any) {
                props.setOpenAlert(err.response?.data || err.toString());
                handleClose();
            }
        });
    };
    const handleReset = () => {
        runInAction(async () => {
            try {
                props.setOpenSuccess('Shutting down Project Proxies...');
                await props.main.sync.deleteProjects();
                props.setOpenSuccess('Deleting main Config and restarting');
                await props.main.sync.deleteMain();
                props.setOpenSuccess('Ready.');
            }
            catch (err: any) {
                props.setOpenAlert(err.response?.data || err.toString());
            }
            handleClose();
        });
    };
    const handleSeed = () => {
        runInAction(async () => {
            try {
                props.setOpenSuccess('Pushing Seed Information...');
                await props.main.sync.pushMain();
                props.setOpenSuccess('Initiating Seed...');
                await props.main.sync.seed();
                props.setOpenSuccess('Ready.');
            }
            catch (err) {
                props.setOpenAlert(err.response?.data || err.toString());
            }
            handleClose();
        });
    };
    const handleHarvest = async () => {
        if (harvestActive.current) return;
        harvestActive.current = true;
        setHarvestPending(true);
        handleClose();
        props.setOpenSuccess('');
        props.setOpenAlert('');
        props.setLastStatusMessage('Harvest in progress...');
        try {
            await props.main.sync.harvest();
            props.setOpenSuccess('Harvest completed.');
            props.setLastStatusMessage('Harvest completed.');
        } catch (error) {
            props.setOpenAlert(error.response?.data || error.toString());
            props.setLastStatusMessage('Harvest failed.');
        } finally {
            harvestActive.current = false;
            setHarvestPending(false);
        }
    };
    const handleRegister = () => {
        runInAction(async () => {
            try {
                props.setOpenSuccess('Registering runners...');
                await props.main.sync.registerRunners();
                props.setOpenSuccess('Ready.');
            }
            catch (err) {
                props.setOpenAlert(err.response?.data || err.toString());
            }
            handleClose();
        });
    };
    const handleUnregister = () => {
        runInAction(async () => {
            try {
                props.setOpenSuccess('Unregistering runners...');
                await props.main.sync.unregisterRunners();
                props.setOpenSuccess('Ready.');
            }
            catch (err) {
                props.setOpenAlert(err.response?.data || err.toString());
            }
            handleClose();
        });
    };
    const handleHotPatch = () => {
        runInAction(async () => {
            props.setOpenSuccess('Hotpatch started...');
            await props.main.sync.hotPatch();
            props.setOpenSuccess('Ready.');
            handleClose();
        });
    };
    return (<React.Fragment>
      <PushDialog main={props.main} open={push} setOpen={setPush} handlePush={handlePush} onClose={() => setPush(false)}/>
      <Button disabled={harvestPending} style={{ marginRight: '1ch' }} variant="text" aria-controls="simple-menu" aria-haspopup="true" color={'primary'} component="span" startIcon={<SyncIcon />} onClick={handleClick}>
        {harvestPending ? t("Harvest in progress...") : t("Synchronize")}
      </Button>
      {harvestPending && <span role="status">{t("Harvest in progress...")}</span>}
      <Menu elevation={1} id="simple-menu" anchorEl={anchorEl} transitionDuration={0} keepMounted open={Boolean(anchorEl)} onClose={handleClose}>
        <MenuItem disabled={harvestPending} onClick={() => setPush(true)}>{t("Push")}</MenuItem>
        <MenuItem disabled={harvestPending} onClick={() => handleSeed()}>Seed</MenuItem>
        <MenuItem disabled={harvestPending} onClick={() => handleRestart()}>{t("Restart")}</MenuItem>
        <MenuItem disabled={harvestPending} onClick={handleFetch}>{t("Fetch")}</MenuItem>
        <MenuItem disabled={harvestPending} onClick={() => handleReset()}>{t("Reset")}</MenuItem>
        <MenuItem disabled={harvestPending} onClick={() => handleHotPatch()}>{t("Update")}</MenuItem>
        <MenuItem disabled={harvestPending} onClick={() => handleRegister()}>{t("Register")}</MenuItem>
        <MenuItem disabled={harvestPending} onClick={() => handleUnregister()}>{t("Unregister")}</MenuItem>
        <MenuItem disabled={harvestPending} onClick={() => handleHarvest()}>Harvest</MenuItem>
      </Menu>
    </React.Fragment>);
}
