import express from "express";
import bodyParser from 'body-parser';
import fs from 'fs';
import morgan from 'morgan';
import md5 from 'md5';
import path from 'path';
import { exec } from "child_process";


const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));
app.use(morgan('combined'))
const port = 8080; // default port to listen

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
    exec('cd ..; ./stop.sh', (err, stdout, stderr) => {
      if (err) {
          res.sendStatus(500);
      }
    });
    res.sendStatus(200);
});

app.patch( "/command/start", async ( req, res ) => {
    exec('cd ..; ./start.sh', (err, stdout, stderr) => {
      if (err) {
          res.sendStatus(500);
      }
    });
    res.sendStatus(200);
});
