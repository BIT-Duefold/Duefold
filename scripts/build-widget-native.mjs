import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';

if (process.platform !== 'win32') {console.log('Windows fullscreen helper is only built on Windows.');process.exit(0);}
const compiler=process.env.DUEFOLD_WIDGET_CC || (existsSync('C:/Program Files/MinGW-w64/bin/gcc.exe')?'C:/Program Files/MinGW-w64/bin/gcc.exe':'gcc');
mkdirSync('electron/native',{recursive:true});
const result=spawnSync(compiler,['-std=c11','-O2','-Wall','-Wextra','-Werror','-Wno-cast-function-type','-shared','-nostdlib','-Wl,--entry,0','-s','-o','electron/native/fullscreen-win32-x64.node','electron/native/fullscreen.c','-luser32','-lkernel32'],{stdio:'inherit',windowsHide:true});
if (result.error) throw result.error;
process.exitCode=result.status??1;
