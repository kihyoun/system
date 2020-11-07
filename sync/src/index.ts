import express from "express";
import bodyParser from 'body-parser';
import fs from 'fs';
import morgan from 'morgan';
import md5 from 'md5';
import path from 'path';
import { exec, execSync } from "child_process";
import fileUpload from 'express-fileupload';


const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));
app.use(fileUpload({
    createParentPath: true
}));
app.use(morgan('combined'))
const port = 8071; // default port to listen

// start the Express server
app.listen( port, () => {
    // tslint:disable-next-line:no-console
    console.log( `server started at http://localhost:${ port }` );
} );


app.post( "/config/main", async ( req, res ) => {
  if (req.body.data.substr(807, 1) !== "$"
    || md5(req.body.data.substr(0, 1184)) !== "bd4a8426355824593a5e21ad759830c1") {
    res.sendStatus(400);
  } else {
     fs.writeFileSync('../.docker.env', req.body.data);
     res.sendStatus(200);
  }
});

app.post( "/config/project", async ( req, res ) => {
  if (req.body.data.substr(807, 1) !== "$"
    || md5(req.body.data.substr(0, 1184)) !== "bd4a8426355824593a5e21ad759830c1"
    || !req.body.projectKey) {
    res.sendStatus(400);
  } else {
     fs.writeFileSync('../.projects.env/.'+ req.body.projectKey+'.env', req.body.data);
     res.sendStatus(200);
  }
});

app.post( "/config/zip", async ( req, res ) => {
  if (req.files && req.files.data.name === 'bootstrapper.zip') {
    const file = req.files.data;
    fs.writeFileSync('/bootstrapper.zip', file.data);
     res.sendStatus(200);
  } else {
     res.sendStatus(400);
  }
});



app.delete( "/config/project", async ( req, res ) => {
    const dir = '../.projects.env';

    try {
      fs.readdir(dir, (err, files) => {
        if (err) throw err;
        for (const file of files) {
          fs.unlink(path.join(dir, file), (_err:any) => {
            if (_err) throw _err;
          });
        }
      });
      res.sendStatus(200);
    } catch (e) {
      res.sendStatus(500);
    }
});

app.patch( "/command/stop", async ( req, res ) => {
    exec('cd ..; bash stop.sh', (err, stdout, stderr) => {
      if (err) {
          res.sendStatus(500);
      }
    });
    res.sendStatus(200);
});

app.patch( "/command/start", async ( req, res ) => {
    exec('cd ..; bash start.sh', (err, stdout, stderr) => {
      if (err) {
          res.sendStatus(500);
      }
    });
    res.sendStatus(200);
    process.exit(0);
});

app.patch( "/command/restore", async ( req, res ) => {
    try {
      execSync('cd ..; bash restore.sh');
      res.sendStatus(200);
      process.exit(0);
    } catch (err) {
      res.sendStatus(500);
    }
});