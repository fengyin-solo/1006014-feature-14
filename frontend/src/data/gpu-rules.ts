// 地面电源（电源车）业务规则常量：功率需求表、状态流转链、班组名册。
// 规则判断在 api/gpu-service.ts，这里只放数据，方便换后端时整体搬走。

/** 机型 → 地面电源需求功率（kVA）。键已归一化：大写、去掉非字母数字。 */
export const AIRCRAFT_POWER_KVA: Record<string, number> = {
  ARJ21: 60,
  E190: 60,
  C919: 90,
  A319: 90,
  A320: 90,
  A321: 90,
  B737: 90,
  B738: 90,
  A330: 120,
  A350: 120,
  B787: 120,
  B777: 140,
  B747: 160,
  A380: 180,
}

/** 设备状态只允许沿这条链走：待命→供电中→待命→待检修，其余一律算跳级。 */
export const GPU_FLOW: Record<string, string[]> = {
  待命: ['供电中', '待检修'],
  供电中: ['待命'],
  待检修: [],
}

export const GPU_FLOW_DESC = '待命→供电中→待命→待检修'

/** 参与交接班的班组名册，交接班时按顺序轮到下一班。 */
export const GPU_TEAMS = ['一班', '二班', '三班']

export const GPU_SHIFTS = ['白班 08:00-20:00', '夜班 20:00-08:00']

/** 从「90kVA」这类功率等级文本里取出千瓦数，取不到返回 null。 */
export function parseKva(raw: unknown): number | null {
  const matched = String(raw ?? '').match(/(\d+(?:\.\d+)?)/)
  if (!matched) {
    return null
  }
  const value = Number(matched[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

/** 机型归一化后查需求功率；先精确，再容忍「B737-800」这类加长写法做前缀互配。 */
export function requiredKvaFor(model: string): number | null {
  const normalize = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const key = normalize(model)
  if (!key) {
    return null
  }
  if (AIRCRAFT_POWER_KVA[key] !== undefined) {
    return AIRCRAFT_POWER_KVA[key]
  }
  for (const [code, kva] of Object.entries(AIRCRAFT_POWER_KVA)) {
    if (key.startsWith(code) || code.startsWith(key)) {
      return kva
    }
  }
  return null
}
