// Execução de comandos no Domain Controller via SSH (coletor de auditoria de AD).
import fs from 'node:fs';
import { Client } from 'ssh2';
import { config } from '../config.js';

export function adEnabled() {
  return !!config.ad.host;
}

function connectOpts() {
  const o = { host: config.ad.host, port: config.ad.port, username: config.ad.user, readyTimeout: 15000 };
  if (config.ad.privateKeyPath) o.privateKey = fs.readFileSync(config.ad.privateKeyPath);
  else if (config.ad.password) o.password = config.ad.password;
  return o;
}

// Roda um comando e resolve com a stdout (string). Rejeita em erro/timeout.
export function runCommand(command) {
  return new Promise((resolve, reject) => {
    if (!adEnabled()) return reject(new Error('AD/SSH não configurado (defina AD_SSH_*).'));
    const conn = new Client();
    let out = '';
    let err = '';
    const done = (fn, arg) => { try { conn.end(); } catch {} fn(arg); };
    conn.on('ready', () => {
      conn.exec(command, (e, stream) => {
        if (e) return done(reject, e);
        stream.on('close', () => (err && !out ? done(reject, new Error(err.trim())) : done(resolve, out)))
          .on('data', (d) => { out += d.toString('utf8'); })
          .stderr.on('data', (d) => { err += d.toString('utf8'); });
      });
    }).on('error', (e) => done(reject, e)).connect(connectOpts());
  });
}

// Monta a chamada ao script PowerShell no DC.
export function psCommand(args) {
  const a = args.map((x) => `${x}`).join(' ');
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${config.ad.scriptPath}" ${a}`;
}
