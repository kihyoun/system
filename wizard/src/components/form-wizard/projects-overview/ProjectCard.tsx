import { useI18n } from '../../../i18n';
import { makeStyles } from 'tss-react/mui';
import React from 'react';
import { Card, CardContent, FormControlLabel, Grid, List, ListItem, ListItemText, Switch, Theme, Toolbar } from '@mui/material';
import { observer } from 'mobx-react';
import { green } from '@mui/material/colors';
const useCardStyles = makeStyles()({
    root: { minWidth: 275 },
    bullet: {
        display: 'inline-block',
        margin: '0 2px',
        transform: 'scale(0.8)'
    },
    title: {
        fontSize: 14,
        flexGrow: 1
    },
    pos: { marginBottom: 12 },
    green: { color: green[500] }
});
const useListSyles = makeStyles()((theme: Theme) => ({
    root: {
        backgroundColor: theme.palette.background.paper,
        overflow: 'hidden'
    }
}));
const ProjectCard = observer((props: any) => {
    const { t } = useI18n();
    const { classes: cardClasses } = useCardStyles();
    const { classes: listClasses } = useListSyles();
    return (<Grid size={4}>
      <Card color="primary.main" className={cardClasses.root}>
        <CardContent>
          <Toolbar>
            <FormControlLabel control={<Switch disabled={props.systemProject} checked={props.hostInfo.useHost === 'true'} onChange={ev => props.handleChange(ev.target.checked)} name="prodCfg" color="primary"/>} label={t(props.hostInfo.context)}/>
          </Toolbar>

          {props.hostInfo.useHost === 'true' &&
            <List className={listClasses.root}>
            <ListItem>
              <ListItemText primary={t("Host")} secondary={props.hostInfo.url}/>
            </ListItem>
            <ListItem>
              <ListItemText primary={t("Deployment")} secondary={props.systemProject ? t("Managed by Bootstrapper") :
                    props.hostInfo.deployMode === 0 ? t("Manual") : t("Auto")}/>
            </ListItem>
            <ListItem>
              <ListItemText primary={t("Internal Port")} secondary={props.hostInfo.port}/>
            </ListItem>
            {props.hostInfo.domainMode > 1 && (<>
                <ListItem>
                  <ListItemText primary={t("SSL Certificate Path")} secondary={props.hostInfo.ssl}/>
                </ListItem>
                <ListItem>
                  <ListItemText primary={t("SSL Certificate Key")} secondary={props.hostInfo.sslKey}/>
                </ListItem>
              </>)}
          </List>}
        </CardContent>
      </Card>
    </Grid>);
});
export default ProjectCard;
