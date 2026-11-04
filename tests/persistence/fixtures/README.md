`wizard-dos.zip` was generated with JSZip 3.10.2 using the Wizard's default ZIP
platform and file/folder calls. It contains the public Cube, a fixture GitLab
image selection and synthetic project configuration. No ZIP metadata was edited.
To reproduce it with an installed `jszip` package:

```js
const fs = require('fs');
const JSZip = require('jszip');
const zip = new JSZip();
zip.file('bootstrapper.json', '{}');
zip.file('.docker.env', fs.readFileSync('system/.docker.env.example', 'utf8').slice(0, 1184)
  + "\nexport GITLAB_IMAGE='fixture-gitlab:under-test'\n");
zip.folder('.projects.env').file('.wizard.env', 'export PROJECT_NAME=wizard\n');
zip.generateAsync({type: 'nodebuffer'}).then(bytes => fs.writeFileSync('wizard-dos.zip', bytes));
```

ZIP timestamps may differ. The regression checks the unmodified DOS metadata;
the full native restore probe additionally executes the actual bundled Wizard
exporter produced by the candidate build.
