import express from "express";
import bodyParser from 'body-parser';
import fs from 'fs';
import morgan from 'morgan';
import md5 from 'md5';
import path from 'path';
import { execSync } from "child_process";
import fileUpload from 'express-fileupload';
import jwt from 'jsonwebtoken';
import sha256 from 'crypto-js/sha256';
import hmacSHA512 from 'crypto-js/hmac-sha512';
import Base64 from 'crypto-js/enc-base64';
import cors from 'cors';
import Helper from "./Helper";

export const app = express();
app.use(bodyParser.json());
app.use(cors({
  "origin": "*",
  "methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
  "preflightContinue": false,
  "optionsSuccessStatus": 204
}));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers",
   "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
app.use(bodyParser.urlencoded({extended: true}));
app.use(fileUpload({createParentPath: true}));
app.use(morgan('combined'))
const privateKey = Math.random().toString(36).slice(-8);
const nonce = Math.random().toString(36).slice(-8);
const message = Math.random().toString(36).slice(-8);
const hashDigest = sha256(nonce + message);
const serverSecret = Base64.stringify(hmacSHA512(Math.random().toString(36).slice(-8) + hashDigest, privateKey));
const serverTokenSecret = Base64.stringify(hmacSHA512(Math.random().toString(36).slice(-8) + hashDigest, privateKey));
const SYNC_USER = process.env.SYNC_USER || Base64.stringify(hmacSHA512(Math.random().toString(36).slice(-8) + hashDigest, privateKey));
const SYNC_PASS = process.env.SYNC_PASS || Base64.stringify(hmacSHA512(Math.random().toString(36).slice(-8) + hashDigest, privateKey));
let refreshTokens: any[] = [];

const status = {
  needRestart: false
};

const port = 8071;

app.listen( port, () => {
    console.log(Helper.textLogo);
    if (process.env.SYNC_ENABLE !== 'true') {
      console.log( `server listening on http://${process.env.BOOTSTRAPPER_IP}:8071` );
    } else {
      console.log( `server listening on ${parseInt(process.env.SYNC_DOMAIN_MODE, 10) > 1
          ? "https://" : "http://"}${process.env.SYNC_HOST}` );
    }
    console.log( `SYNC_USER: ${SYNC_USER}` );
    console.log( `SYNC_PASS: ${SYNC_PASS}` );
} );

const authenticateJWT = (req:any, res:any, next:any) => {
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, serverSecret, (err:any, user:any) => {
            if (err) return res.sendStatus(403);
            req.user = user;
            next();
        });
    } else {
        res.sendStatus(401);
    }
};

const stopExecution = async () => {
  console.log('Restarting System...');
  process.exit(0);
};

app.post('/token', (req, res) => {
    const { token } = req.body;
    if (!token)  return res.sendStatus(401);
    if (!refreshTokens.includes(token))  return res.sendStatus(403);

    jwt.verify(token, serverTokenSecret, (err:any, user:any) => {
        if (err) return res.sendStatus(403);
        const accessToken = jwt.sign({ username: user.username, role: user.role },
          serverSecret, { expiresIn: '20m' });
        res.json({ accessToken });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === SYNC_USER && password === SYNC_PASS) {
        const accessToken = jwt.sign({ username }, serverSecret,
          { expiresIn: '20m' });
        const refreshToken = jwt.sign({ username }, serverTokenSecret);
        refreshTokens.push(refreshToken);
        res.json({ accessToken, refreshToken });
    } else {
        res.status(401).send('Username or Password incorrect');
    }
});

app.post('/logout', authenticateJWT, (req, res) => {
    const authHeader = req.headers.authorization;
    const t = authHeader.split(' ')[1];
    refreshTokens = refreshTokens.filter(token => t !== token);
    res.send("Logout successful");
});

app.get( "/status", authenticateJWT, async ( req, res ) => {
  res.status(200).json(status)
});

app.get( "/config/main", authenticateJWT, async ( req, res ) => {
  if (fs.existsSync('../system/.docker.env')) {
    const data = fs.readFileSync('../system/.docker.env',
      {encoding:'utf8', flag:'r'});

    res.status(200).json({filename: ".docker.env", data})
  } else {
     res.sendStatus(404);
  }
});

app.post( "/config/project", authenticateJWT, async ( req, res ) => {
  try {
    if (req.body.data.substr(807, 1) !== "$"
      || md5(req.body.data.substr(0, 1184)) !== "bd4a8426355824593a5e21ad759830c1"
      || !req.body.projectKey) {
      res.sendStatus(400);
    } else {
      console.log('Stopping intermediate Services...')
      const out = execSync('cd ../system; bash stop-intermediate.sh');
      fs.writeFileSync('../system/.projects.env/.'+ req.body.projectKey+'.env',
        req.body.data);
      status.needRestart = true;
      res.status(200).json({message: 'New Project added.', status,
        output: out.toString()});
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

app.get( "/config/projects", authenticateJWT, async ( req, res ) => {
 const dir = '../system/.projects.env';
 try {
  const fileNames = fs.readdirSync(dir);
  const ret = [];
  for (const fileName of fileNames) {
    if (fileName === '.projects.env' || fileName.substr(-3,3) !== 'env') continue;
    const data = fs.readFileSync(path.join(dir, fileName),
      {encoding:'utf8', flag:'r'});
    ret.push({
      filename: fileName,
      data
    })
  }
    res.status(200).json(ret);
  } catch (e) {
    res.status(500).send(e.toString());
  }
});

app.post( "/config/zip", authenticateJWT, async ( req, res ) => {
  try {
    if (req.files && req.files['bootstrapper.zip']?.name==='bootstrapper.zip') {
      const file = req.files['bootstrapper.zip'];
      console.log('Stopping intermediate services...')
      const out = execSync('cd ../system; bash ./stop-intermediate.sh');
      fs.writeFileSync('../bootstrapper.zip', file.data);
      status.needRestart = true;
      res.status(200).json({message: 'Config written.',
        status, output: out.toString()});
    } else {
      res.sendStatus(400);
    }
  } catch (err) {
    res.status(500).send(err)
  }
});

app.post( "/config/main", authenticateJWT, async ( req, res ) => {
  try {
    if (req.files && req.files['.docker.env']?.name==='.docker.env') {
      const file = req.files['.docker.env'];
      console.log('Stopping intermediate services...');
      const out = execSync('cd ../system; bash stop-intermediate.sh');
      fs.writeFileSync('../system/.docker.env', file.data);
      status.needRestart = true;
      res.status(200).json({message: 'Main config written.',
        status, output: out.toString()});
    } else {
      res.sendStatus(400);
    }
  } catch (err) {
    res.status(500).send(err)
  }
});

app.delete( "/config/projects", authenticateJWT, async ( req, res ) => {
    try {
      console.log('Stopping intermediate services...');
      const out = execSync('cd ../system; bash stop-intermediate.sh');
      console.log('Deleting project configurations...');
      const out2 = execSync('cd ../system; bash delete-projects.sh');
      status.needRestart = true;
      res.status(200).json({message: "Deleting project configuration done.",
        status, output: out.toString() + out2.toString()});
    } catch (e) {
      res.status(500).send(e.toString());
    }
});

app.delete( "/config/main", authenticateJWT, async ( req, res ) => {
  if (!fs.existsSync('../system/.docker.env')) {
     res.status(404).send('File does not exist.');
  }

  try {
    console.log('Stopping intermediate services...');
    const out = execSync('cd ../system; bash stop-intermediate.sh');
    console.log('Unlink ../systen/.docker.env');
    fs.unlinkSync('../system/.docker.env');
    status.needRestart = true;
    res.status(200).json({ message: "Main config deleted.", status,
      output: out.toString()});
  } catch (e) {
    res.status(500).send(e.toString());
  }
});

app.patch( "/command/system/patch", authenticateJWT, async ( req, res, next) => {
    try {
      console.log('Stopping intermediate services...');
      execSync('cd ../system; bash stop-intermediate.sh');
      const out = execSync('cd ..; git reset --hard; git pull -r; git submodule update');
      status.needRestart = true;
      res.status(200).json({ message: "Repository updated.", status,
        output: out.toString()});
    } catch (err) {
      res.status(500).send(err.toString());
    }
});

app.patch( "/command/seed", authenticateJWT, async ( req, res ) => {
    try {
      console.log('Stopping intermediate services...');
      const out1 = execSync('cd ../system; bash stop-intermediate.sh');
      console.log('Apply Seed...');
      const out = execSync('cd ../system; bash seed.sh');
      res.status(200).json({ message: "Seed has been applied.", status,
        output: out1.toString() + out.toString()});
    } catch (err) {
      res.status(500).send(err.toString());
    }
});

app.patch( "/command/restart", authenticateJWT, async ( req, res, next ) => {
    try {
      console.log('Stopping intermediate services...');
      const out = execSync('cd ../system; bash stop-intermediate.sh');
      res.status(200).json({ message: "Restarting system.", status,
        output: out.toString()});
      next();
    } catch (err) {
      res.status(500).send(err.toString());
    }
});

app.use( "/command/restart", authenticateJWT, stopExecution);

app.patch( "/command/harvest", authenticateJWT, async ( req, res ) => {
    try {
      const out = execSync('cd ../system; bash harvest.sh');
      res.status(200).json({ message: "Harvesting complete.", status,
        output: out.toString()});
    } catch (err) {
      res.status(500).send(err.toString());
    }
});

app.patch( "/command/runners/register", authenticateJWT, async ( req, res ) => {
    try {
      const out = execSync('cd ../gitlab-runner; bash register.sh');
      res.status(200).json({message: "Runner registration completed.",
        status, output: out.toString()});
    } catch (err) {
      res.status(500).send(err.toString());
    }
});

app.patch( "/command/runners/unregister", authenticateJWT, async ( req, res ) => {
    try {
      const out = execSync('cd ../gitlab-runner; bash unregister.sh');
      res.status(200).json({ message: "Runner unregistered.", status,
        output: out.toString() });
    } catch (err) {
      res.status(500).send(err.toString());
    }
});