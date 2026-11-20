import { useI18n } from '../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { Theme, useTheme } from '@mui/material/styles';
import SyntaxHighlighter from '../../../SyntaxHighlighter';
import duotoneLight from 'react-syntax-highlighter/dist/esm/styles/prism/duotone-light';
import Zoom from '@mui/material/Zoom';
import FileCopyIcon from '@mui/icons-material/FileCopy';
import CheckIcon from '@mui/icons-material/Check';
import Tooltip from '@mui/material/Tooltip';
import GetAppIcon from '@mui/icons-material/GetApp';
const useStyles = makeStyles()((theme: Theme) => ({
    root: {
        backgroundColor: theme.palette.background.paper,
        width: 500,
        position: 'relative',
        minHeight: 200
    },
    fab: {
        position: 'absolute',
        top: theme.spacing(2),
        right: theme.spacing(2)
    },
    fabGreen: {
        position: 'absolute',
        top: theme.spacing(2),
        right: theme.spacing(2)
    }
}));
export default function DownloadDockerDialog(props: any) {
    const { t } = useI18n();
    const [open, setOpen] = useState(true);
    const theme = useTheme();
    const [clipboard, setClipboard] = useState(false);
    const { classes } = useStyles();
    const copyListener = (e: any) => {
        e?.clipboardData?.setData('text/plain', props.main.config.content);
        e?.clipboardData?.setData('text/html', props.main.config.content);
        e?.preventDefault();
    };
    useEffect(() => {
        document.addEventListener('copy', copyListener);
        return () => document.removeEventListener('copy', copyListener);
    }, []);
    const handleClose = () => {
        setOpen(false);
        props.setClose();
    };
    if (!open) {
        return null;
    }
    const transitionDuration = {
        enter: theme.transitions.duration.enteringScreen,
        exit: theme.transitions.duration.leavingScreen
    };
    const fabs = [
        {
            color: 'primary' as const,
            className: classes.fab,
            icon: <FileCopyIcon />,
            label: 'Copy .docker.env to Clipboard',
            tooltip: 'Copy .docker.env to Clipboard'
        },
        {
            color: 'secondary' as const,
            className: classes.fabGreen,
            icon: <CheckIcon />,
            label: 'Done',
            tooltip: 'Contents have been successfully copied to Clipboard'
        }
    ];
    return (<div>
      <Dialog transitionDuration={0} fullWidth={true} maxWidth={'lg'} open={open} onClose={handleClose} aria-labelledby="responsive-dialog-title">
        {fabs.map((fab, index) => (<Zoom key={fab.color} in={clipboard === Boolean(index)} timeout={transitionDuration} style={{ transitionDelay: `${clipboard === Boolean(index) ? transitionDuration.exit : 0}ms` }} unmountOnExit>
            <Tooltip title={t(fab.tooltip)} aria-label={t(fab.tooltip)}>
              <Button onClick={() => {
                /* Copy the text inside the text field */
                document.execCommand('copy');
                setClipboard(true);
            }} aria-label={t(fab.label)} className={fab.className} color={fab.color} startIcon={fab.icon}>{t(fab.label)}
              </Button>
            </Tooltip>
          </Zoom>))}
        <DialogTitle id="responsive-dialog-title">{t("Save Main Configuration")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <SyntaxHighlighter language="bash" style={duotoneLight}>
              {props.main.config.content}
            </SyntaxHighlighter>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => props.main.config.exportConfig()} color="primary" startIcon={<GetAppIcon />}>
            {t("Download")}</Button>
          <Button onClick={handleClose} color="primary" autoFocus>
            {t("Close")}</Button>
        </DialogActions>
      </Dialog>
    </div>);
}
