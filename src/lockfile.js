import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 读写 ~/.agents/.skill-lock.json，记录 skill 的安装来源。
// 任何读取/解析异常都安全降级，不影响主流程。
const LOCK_PATH = path.join(os.homedir(), '.agents', '.skill-lock.json');

export function readLock() {
  try {
    if (!fs.existsSync(LOCK_PATH)) return { version: 3, skills: {} };
    const raw = fs.readFileSync(LOCK_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return { version: 3, skills: {} };
    data.skills = data.skills || {};
    return data;
  } catch {
    return { version: 3, skills: {} };
  }
}

export function writeLock(data) {
  try {
    fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
    fs.writeFileSync(LOCK_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function getLockEntry(lock, name) {
  return lock.skills?.[name] || null;
}

export function setLockEntry(lock, name, entry) {
  lock.skills = lock.skills || {};
  lock.skills[name] = entry;
}

export function removeLockEntry(lock, name) {
  if (lock.skills && lock.skills[name]) {
    delete lock.skills[name];
    return true;
  }
  return false;
}

export function lockPath() {
  return LOCK_PATH;
}
