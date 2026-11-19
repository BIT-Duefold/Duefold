import { spawn } from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
import electron from 'electron';
import {fileURLToPath} from 'node:url';
import {launchDesktop} from './desktop-launcher.mjs';

const env = {...process.env};
if (!env.DUEFOLD_DATA_DIR) {
  const appData = env.APPDATA || path.join(homedir(), '.config');
  env.DUEFOLD_DATA_DIR = path.join(appData, 'duefold-dev');
}
launchDesktop({spawn, executable: electron, cwd: fileURLToPath(new URL('..', import.meta.url)), args: process.argv.slice(2), env});
