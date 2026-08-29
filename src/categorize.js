// 依据 skill 名称 + 描述关键词，归类到主题分类。
// 分类表来自 config.json 的 categories，命中第一个匹配分类；无命中 → 其他。
export function categorize(name, description, categories = []) {
  const n = String(name || '').toLowerCase();
  const d = String(description || '').toLowerCase();
  // 名称命中是强信号，优先；名称未命中再按描述匹配。
  for (const cat of categories) {
    const keywords = cat.keywords || [];
    if (keywords.some((kw) => n.includes(String(kw).toLowerCase()))) {
      return cat.name;
    }
  }
  for (const cat of categories) {
    const keywords = cat.keywords || [];
    if (keywords.some((kw) => d.includes(String(kw).toLowerCase()))) {
      return cat.name;
    }
  }
  return '其他';
}

export const DEFAULT_CATEGORY = '其他';
