// npm 11 may skip dependency install scripts (allow-scripts policy), which leaves Electron
// without its binary ("Error: Electron uninstall"). This root postinstall always runs, so we
// download the binary here if it is missing.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const dir = 'node_modules/electron';
if (existsSync(`${dir}/install.js`) && !existsSync(`${dir}/path.txt`)) {
  console.log('[pixel] Electron binary missing — downloading…');
  execFileSync(process.execPath, [`${dir}/install.js`], { stdio: 'inherit' });
}
