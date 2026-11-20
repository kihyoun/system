import { useI18n } from '../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React, { useState } from 'react';
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
import { Toolbar } from '@mui/material';
import GetAppIcon from '@mui/icons-material/GetApp';
const useStyles = makeStyles()((theme: Theme) => ({
    root: {
        backgroundColor: theme.palette.background.paper,
        width: 500,
        position: 'relative',
        minHeight: 200
    },
    fab: {
        top: theme.spacing(2),
        right: 0
    },
    fabGreen: {
        top: theme.spacing(2),
        right: 0
    },
    toolbarWrapper: {
        '& .MuiToolbar-gutters': {
            paddingLeft: 0,
            paddingRight: 0
        }
    }
}));
export default function DownloadReactCiDialog(props: any) {
    const { t } = useI18n();
    const [open, setOpen] = useState(true);
    const theme = useTheme();
    const [clipboard, setClipboard] = useState(false);
    const { classes } = useStyles();
    const project = props.main.projects.get(props.project);
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
            icon: <FileCopyIcon />
        },
        {
            color: 'secondary' as const,
            className: classes.fabGreen,
            icon: <CheckIcon />
        }
    ];
    return (<div>
      <Dialog transitionDuration={0} fullWidth={true} maxWidth={'lg'} open={open} onClose={handleClose} aria-labelledby="responsive-dialog-title">

        <DialogTitle id="responsive-dialog-title">{t("Pipeline Configuration (.gitlab-ci.yml)")}</DialogTitle>
        <DialogContent>
          <React.Fragment>
            <div className={classes.toolbarWrapper}>
              <Toolbar>
                <div />
                {fabs.map((fab, index) => {
            const tooltip = index < 1
                ? 'Copy the contents into Clipboard'
                : 'Copy successful.';
            return (<Zoom key={fab.color} in={clipboard === Boolean(index)} timeout={transitionDuration} style={{ transitionDelay: `${clipboard === Boolean(index) ? transitionDuration.exit : 0}ms` }} unmountOnExit>
                      <Tooltip title={t(tooltip)} aria-label={t(tooltip)}>
                        <Button size="small" onClick={() => {
                    const copyListener = (e: any) => {
                        e?.clipboardData?.setData('text/plain', project.gitlabCi);
                        e?.clipboardData?.setData('text/html', project.gitlabCi);
                        e?.preventDefault();
                    };
                    document.addEventListener('copy', copyListener);
                    document.execCommand('copy');
                    document.removeEventListener('copy', copyListener);
                    setClipboard(true);
                }} aria-label={t(tooltip)} className={fab.className} color={fab.color} startIcon={fab.icon}>{index === 0 && t("Copy & Paste") || t("Done")}
                        </Button>
                      </Tooltip>
                    </Zoom>);
        })}
              </Toolbar>
            </div>
            <DialogContentText>
              <SyntaxHighlighter language="yaml" style={duotoneLight}>
                {project.gitlabCi}
              </SyntaxHighlighter>
            </DialogContentText>
          </React.Fragment>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => project.exportGitlabCi()} color="primary" startIcon={<GetAppIcon />}>
            {t("Download")}</Button>
          <Button onClick={handleClose} color="primary" autoFocus>
            {t("Close")}</Button>
        </DialogActions>
      </Dialog>
    </div>);
}
