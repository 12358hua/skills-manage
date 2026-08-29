import fs from 'node:fs';
import path from 'node:path';

// 用户通过界面添加的自定义 agent，持久化在项目目录下的 custom-agents.json。
// 内容形如 { "agents": { "<key>": { "label": "xx", "path": "D:/xx/skills" } } }
const CUSTOM_PATH = path.join(process.cwd(), 'custom-agents.json');

export function readCustomAgents() {
  try {
    if (!fs.existsSync(CUSTOM_PATH)) return {};
    const data = JSON.parse(fs.readFileSync(CUSTOM_PATH, 'utf8'));
    return data && typeof data.agents === 'object' && data.agents ? data.agents : {};
  } catch {
    return {};
  }
}

export function writeCustomAgents(agents) {
  try {
    fs.writeFileSync(CUSTOM_PATH, JSON.stringify({ agents }, null, 2) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function customAgentsPath() {
  return CUSTOM_PATH;
}
