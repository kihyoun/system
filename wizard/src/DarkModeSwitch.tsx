import { useI18n } from './i18n';
import React, { useState } from 'react';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
const DarkModeSwitch = (props: any) => {
    const { t } = useI18n();
    const [dark, setDark] = useState(false);
    const handleChange = (event: any) => {
        setDark(event.target.checked);
        props.handleChange(event);
    };
    return (<FormGroup row sx={{ flexWrap: 'nowrap' }}>
      <FormControlLabel sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.875rem' } }} control={<Switch onChange={handleChange} color="default" defaultChecked={false}/>} label={t(dark ? 'Light' : 'Dark')}/>
    </FormGroup>);
};
export default DarkModeSwitch;
