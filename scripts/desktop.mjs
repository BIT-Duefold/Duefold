import { spawn } from 'node:child_process';
import electron from 'electron';
import {fileURLToPath} from 'node:url';
import {launchDesktop} from './desktop-launcher.mjs';
launchDesktop({spawn, executable: electron, cwd: fileURLToPath(new URL('..', import.meta.url)), args: process.argv.slice(2)});
