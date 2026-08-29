import fs from 'node:fs';
import path from 'node:path';
import { readLock, writeLock, removeLockEntry } from './lockfile.js';

// 删除一个 skill。skill 来自扫描结果（含 path / isSymlink / realPath / name）。
// 若 deleteShared=true 且是软链接，则连同共享库真实目录一起删除。
export function removeSkill(skill, { deleteShared = false } = {}) {
  if (!skill) return { error: '未找到要删除的 skill' };
  const removed = [];
  const errors = [];

  const isSymlink = Boolean(skill.isSymlink);
  const targetPath = skill.path;

  if (isSymlink) {
    // 软链接：只删链接本身；可选地删除真实目标（共享库）。
    try {
      if (fs.lstatSync(targetPath).isSymbolicLink() || fs.lstatSync(targetPath).isFile()) {
        fs.unlinkSync(targetPath);
      } else {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      removed.push(targetPath);
    } catch (e) {
      errors.push(`删除软链接失败: ${e.message || e}`);
    }
    if (deleteShared && skill.realPath && skill.realPath !== targetPath) {
      try {
        fs.rmSync(skill.realPath, { recursive: true, force: true });
        removed.push(skill.realPath);
      } catch (e) {
        errors.push(`删除共享目录失败: ${e.message || e}`);
      }
    }
  } else {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      removed.push(targetPath);
    } catch (e) {
      errors.push(`删除失败: ${e.message || e}`);
    }
  }

  // 联动 lockfile
  const lock = readLock();
  const changed = removeLockEntry(lock, skill.name);
  if (changed) writeLock(lock);

  return { removed, errors, lockUpdated: changed };
}
