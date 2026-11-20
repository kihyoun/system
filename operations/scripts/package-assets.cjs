'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const target=path.join(root,'operations/assets/project-bootstrap/preview-setup');
fs.mkdirSync(target,{recursive:true});
fs.copyFileSync(path.join(root,'project-bootstrap/preview-setup/settings.js'),path.join(target,'settings.js'));
fs.copyFileSync(path.join(root,'LICENSE'),path.join(root,'operations/LICENSE'));
