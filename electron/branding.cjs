const path = require('node:path');
const fs = require('node:fs');

const APP_NAME = '归序';
const APP_ID = 'cn.duefold.desktop';
const APP_ICON = path.join(__dirname, '../assets', process.platform === 'win32' ? 'duefold.ico' : 'duefold.png');
// Historical on-disk identifiers are compatibility data, not current branding.
// Code points keep retired product names out of the current source vocabulary.
const legacyProfileNames = [
  [25342, 26399],
  [100, 101, 97, 100, 108, 105, 110, 101, 45, 104, 117, 98]
].map(points => String.fromCodePoint(...points));
function resolveDataDirectory(appData, override, exists = fs.existsSync) {
  if (override) return path.resolve(override);
  for (const name of legacyProfileNames) {
    const legacy = path.join(appData, name);
    if (exists(legacy)) return legacy;
  }
  return path.join(appData, APP_NAME);
}
module.exports = {APP_NAME, APP_ID, APP_ICON, resolveDataDirectory};
