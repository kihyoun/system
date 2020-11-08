import express from "express";
import bodyParser from 'body-parser';
import fs from 'fs';
import morgan from 'morgan';
import md5 from 'md5';
import path from 'path';
import { exec, execSync } from "child_process";
import fileUpload from 'express-fileupload';
import jwt from 'jsonwebtoken';
import sha256 from 'crypto-js/sha256';
import hmacSHA512 from 'crypto-js/hmac-sha512';
import Base64 from 'crypto-js/enc-base64';

export const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(fileUpload({createParentPath: true}));
app.use(morgan('combined'))
const privateKey = Math.random().toString(36).slice(-8);
const nonce = Math.random().toString(36).slice(-8);
const message = Math.random().toString(36).slice(-8);
const hashDigest = sha256(nonce + message);
const SYNC_SECRET = Base64.stringify(hmacSHA512(Math.random().toString(36).slice(-8) + hashDigest, privateKey));
const SYNC_REFRESHTOKENSECRET = Base64.stringify(hmacSHA512(Math.random().toString(36).slice(-8) + hashDigest, privateKey));
const SYNC_USER = process.env.SYNC_USER || Base64.stringify(hmacSHA512(Math.random().toString(36).slice(-8) + hashDigest, privateKey));
const SYNC_PASS = process.env.SYNC_PASS || Base64.stringify(hmacSHA512(Math.random().toString(36).slice(-8) + hashDigest, privateKey));
let refreshTokens: any[] = [];

const port = 8071;

app.listen( port, () => {
    console.log( `server started at http://localhost:${ port }` );
    console.log( `SYNC_USER: ${SYNC_USER}` );
    console.log( `SYNC_PASS: ${SYNC_PASS}` );
} );

const authenticateJWT = (req:any, res:any, next:any) => {
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, SYNC_SECRET, (err:any, user:any) => {
            if (err) return res.sendStatus(403);
            req.user = user;
            next();
        });
    } else {
        res.sendStatus(401);
    }
};

app.post('/token', (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.sendStatus(401);
    }

    if (!refreshTokens.includes(token)) {
        return res.sendStatus(403);
    }

    jwt.verify(token, SYNC_REFRESHTOKENSECRET, (err:any, user:any) => {
        if (err) {
            return res.sendStatus(403);
        }

        const accessToken = jwt.sign({ username: user.username, role: user.role }, SYNC_SECRET, { expiresIn: '20m' });

        res.json({
            accessToken
        });
    });
});
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === SYNC_USER && password === SYNC_PASS) {
        const accessToken = jwt.sign({ username }, SYNC_SECRET, { expiresIn: '20m' });
        const refreshToken = jwt.sign({ username }, SYNC_REFRESHTOKENSECRET);
        refreshTokens.push(refreshToken);

        res.json({
            accessToken,
            refreshToken
        });
    } else {
        res.status(401).send('Username or Password incorrect');
    }
});

app.post('/logout', (req, res) => {
    const { t } = req.body;
    refreshTokens = refreshTokens.filter(token => t !== token);

    res.send("Logout successful");
});

app.post( "/config/main", authenticateJWT, async ( req, res ) => {
  if (req.body.data.substr(807, 1) !== "$"
    || md5(req.body.data.substr(0, 1184)) !== "bd4a8426355824593a5e21ad759830c1") {
    res.sendStatus(400);
  } else {
     fs.writeFileSync('../.docker.env', req.body.data);
     res.sendStatus(200);
  }
});

app.post( "/config/project", authenticateJWT, async ( req, res ) => {
  if (req.body.data.substr(807, 1) !== "$"
    || md5(req.body.data.substr(0, 1184)) !== "bd4a8426355824593a5e21ad759830c1"
    || !req.body.projectKey) {
    res.sendStatus(400);
  } else {
     fs.writeFileSync('../.projects.env/.'+ req.body.projectKey+'.env', req.body.data);
     res.sendStatus(200);
  }
});

app.post( "/config/zip", authenticateJWT, async ( req, res ) => {
  if (req.files && req.files.data.name === 'bootstrapper.zip') {
    const file = req.files.data;
    fs.writeFileSync('/bootstrapper.zip', file.data);
     res.sendStatus(200);
  } else {
     res.sendStatus(400);
  }
});

app.delete( "/config/project", authenticateJWT, async ( req, res ) => {
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
      res.status(500).send(e.toString());
    }
});

app.delete( "/config/main", authenticateJWT, async ( req, res ) => {
    const file = '../.docker.env';

    try {
      fs.unlink(file, (_err:any) => {
        if (_err) throw _err;
      });
      res.sendStatus(200);
    } catch (e) {
      res.status(500).send(e.toString());
    }
});

app.patch( "/command/system/patch", authenticateJWT, async ( req, res ) => {
    try {
      const out = execSync('cd ..; git pull -r');
      res.status(200).send(out.toString());
    } catch (err) {
      res.status(500).send(err.toString());
    }
});

app.patch( "/command/restore", authenticateJWT, async ( req, res ) => {
    try {
      const out = execSync('cd ..; bash restore.sh');
      res.status(200).send(out.toString());
    } catch (err) {
      res.status(500).send(err.toString());
    }
});

app.patch( "/command/restart", authenticateJWT, async ( req, res ) => {
    try {
      res.status(200);
      process.exit(0);
    } catch (err) {
      res.status(500).send(err.toString());
    }
});

app.patch( "/command/backup", authenticateJWT, async ( req, res ) => {
    try {
      const out = execSync('cd ..; bash backup.sh');
      res.status(200).send(out.toString());
    } catch (err) {
      res.status(500).send(err.toString());
    }
});

app.patch( "/command/runners/register", authenticateJWT, async ( req, res ) => {
    try {
      const out = execSync('cd ../gitlab-runner; bash register.sh');
      res.status(200).send(out.toString());
    } catch (err) {
      res.status(500).send(err.toString());
    }
});

app.patch( "/command/runners/unregister", authenticateJWT, async ( req, res ) => {
    try {
      const out = execSync('cd ../gitlab-runner; bash unregister.sh');
      res.status(200).send(out.toString());
    } catch (err) {
      res.status(500).send(err.toString());
    }
});