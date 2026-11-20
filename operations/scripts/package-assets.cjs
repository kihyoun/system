'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
// Remove obsolete generated validators from incremental package builds.
fs.rmSync(path.join(root,'operations/assets/project-bootstrap/preview-setup'),{recursive:true,force:true});
fs.copyFileSync(path.join(root,'LICENSE'),path.join(root,'operations/LICENSE'));
