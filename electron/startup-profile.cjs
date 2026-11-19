const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

// A failed single-instance lock can also mean the profile is unwritable.
// Check with the actual Electron process before treating it as a handoff.
function verifyProfileWritable(directory, io = fs) {
  const probe = path.join(directory, `.duefold-startup-${randomUUID()}`);
  let created = false;
  try {
    io.mkdirSync(directory, {recursive: true});
    io.writeFileSync(probe, '', {flag: 'wx', mode: 0o600});
    created = true;
    io.unlinkSync(probe);
  } catch (error) {
    if (created) {try {io.unlinkSync(probe);} catch {}}
    throw new Error(`无法写入归序的数据目录（${error.code || '未知错误'}）。请检查目录权限和 Electron 启动文件的 Windows 完整性级别。\n数据目录：${directory}`, {cause: error});
  }
}

module.exports = {verifyProfileWritable};
