'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
// Remove obsolete generated validators from incremental package builds.
fs.rmSync(path.join(root,'operations/assets/project-bootstrap/preview-setup'),{recursive:true,force:true});
fs.copyFileSync(path.join(root,'LICENSE'),path.join(root,'operations/LICENSE'));
const validators=['guided-preview-evidence.js','guided-preview-evidence-v1.js','job-diagnostics.js'];
fs.mkdirSync(path.join(root,'operations/assets/gitlab'),{recursive:true});
for(const file of validators)fs.copyFileSync(path.join(root,'gitlab',file),path.join(root,'operations/assets/gitlab',file));
