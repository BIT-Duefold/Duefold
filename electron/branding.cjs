const path = require('node:path');

const APP_NAME = '归序';
const APP_ID = 'cn.duefold.desktop';
const DATA_DIR_NAME = 'duefold';
const APP_ICON = path.join(__dirname, '../assets', process.platform === 'win32' ? 'duefold.ico' : 'duefold.png');

function resolveDataDirectory(appData, override) {
  return override ? path.resolve(override) : path.join(appData, DATA_DIR_NAME);
}

module.exports = {APP_NAME, APP_ID, DATA_DIR_NAME, APP_ICON, resolveDataDirectory};
