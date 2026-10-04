import { GPU_FLOW, GPU_FLOW_DESC, parseKva, requiredKvaFor } from '@/data/gpu-rules'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionContext, ActionResult, EntryRow } from '@/data/types'

// 地面电源（电源车）专属规则层。职责与归属、功率核对、电缆检查、排队、状态链、
// 资源缺口同源全部在这里裁决；页面和其它模块只读结果，不各自写判断。
//
// 供电记录（gpuLog）与排队队列（gpuQueue）复用本地持久化层，按独立 key 存放。

const GPU_KEY = 'gpu'
const LOG_KEY = 'gpuLog'
const QUEUE_KEY = 'gpuQueue'
const RESPLAN_KEY = 'resplan'
const FLIGHT_KEY = 'flight'

function nowIso(): string {
  return new Date().toISOString()
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function appendLog(entry: Record<string, string>): void {
  const log = listRows(LOG_KEY)
  const row: EntryRow = {
    id: nextId(log),
    status: '已记录',
    pending: false,
    abnormal: false,
    时间: nowText(),
    类型: '',
    设备编号: '',
    航班号: '',
    班组: '',
    值班员: '',
    说明: '',
    ...entry,
  }
  saveRows(LOG_KEY, [...log, row])
}

/** 供电记录：所有人可查看，任何角色都改不了（本模块之外没有写入口）。 */
export function listGpuLog(): EntryRow[] {
  return [...listRows(LOG_KEY)].sort((a, b) => Number(b.id) - Number(a.id))
}

function queueFor(deviceId: number): EntryRow[] {
  return listRows(QUEUE_KEY)
    .filter((row) => row.status === '排队中' && Number(row.设备ID) === deviceId)
    .sort((a, b) => String(a.申请时间).localeCompare(String(b.申请时间)) || Number(a.id) - Number(b.id))
}

/** 排队中的供电请求，按裁决次序（申请时间先到先得，同刻按航班号升序）排列。 */
export function listGpuQueue(): EntryRow[] {
  return listRows(QUEUE_KEY)
    .filter((row) => row.status === '排队中')
    .sort(
      (a, b) =>
        String(a.申请时间).localeCompare(String(b.申请时间)) ||
        String(a.航班号).localeCompare(String(b.航班号)) ||
        Number(a.id) - Number(b.id),
    )
}

/** 电源车可用台数：资源调度侧与电源车页面共用这一个口径，保证同源。 */
export function gpuAvailability(): { total: number; standby: number; supplying: number; maintenance: number } {
  const rows = listRows(GPU_KEY)
  const count = (status: string) => rows.filter((row) => String(row.status) === status).length
  return {
    total: rows.length,
    standby: count('待命'),
    supplying: count('供电中'),
    maintenance: count('待检修'),
  }
}

/**
 * 把电源车可调度台数折算进资源计划的「资源缺口」字段。
 * 每次电源车状态变动后重算，资源调度侧看到的缺口与可用台数始终同源。
 */
export function syncGpuGapToResplan(): number {
  const available = gpuAvailability().standby
  const rows = listRows(RESPLAN_KEY)
  let changed = false
  const next = rows.map((row) => {
    if (String(row.status) === '已作废') {
      return row
    }
    const matched = String(row['车辆需求'] ?? '').match(/\d+/)
    const demand = matched ? Number(matched[0]) : 0
    const gap = Math.max(0, demand - available)
    const text =
      gap > 0
        ? `电源车缺口${gap}台（可调度${available}台/需求${demand}台）`
        : `电源车可调度${available}台，满足需求${demand}台`
    if (String(row['资源缺口'] ?? '') === text) {
      return row
    }
    changed = true
    return { ...row, 资源缺口: text }
  })
  if (changed) {
    saveRows(RESPLAN_KEY, next)
  }
  return available
}

function ensureFlow(current: string, target: string): ActionResult | null {
  const allowed = GPU_FLOW[current] ?? []
  if (!allowed.includes(target)) {
    return {
      ok: false,
      message: `设备状态只能按 ${GPU_FLOW_DESC} 的顺序变动，不允许从「${current}」直接到「${target}」，已拦下`,
    }
  }
  return null
}

function findFlight(flightNo: string): EntryRow | undefined {
  return listRows(FLIGHT_KEY).find((row) => String(row['航班号'] ?? '').trim() === flightNo)
}

/** 功率核对：需求、设备能力、差值一次性算清，供发起前预检和正式发起共用。 */
function checkPower(row: EntryRow, flightNo: string): ActionResult & { required?: number; capacity?: number } {
  const flight = findFlight(flightNo)
  if (!flight) {
    return { ok: false, message: `航班 ${flightNo} 未在航班保障模块登记，无法核对机型功率需求` }
  }
  const model = String(flight['机型'] ?? '').trim()
  const required = requiredKvaFor(model)
  if (required === null) {
    return { ok: false, message: `机型「${model || '未登记'}」没有登记的功率需求，无法核对，已拒绝` }
  }
  const capacity = parseKva(row['功率等级'])
  if (capacity === null) {
    return { ok: false, message: `${row['设备编号']}功率等级「${row['功率等级'] || '未登记'}」无法识别，无法核对，已拒绝` }
  }
  if (capacity < required) {
    return {
      ok: false,
      required,
      capacity,
      message: `功率等级不够：${model}需${required}kVA，${row['设备编号']}仅${capacity}kVA，差${required - capacity}kVA，已拒绝接机供电`,
    }
  }
  return {
    ok: true,
    required,
    capacity,
    message: `功率核对通过：${model}需${required}kVA，${row['设备编号']}${capacity}kVA，富余${capacity - required}kVA`,
  }
}

/** 发起前的全部前置核对（电缆、排队、功率），只读不写，页面用来做实时预检。 */
function checkSupplyEligible(row: EntryRow, flightNo: string): ActionResult {
  if (!flightNo) {
    return { ok: false, message: '请填写接机航班号' }
  }
  if (String(row['电缆检查']) !== '已通过') {
    return { ok: false, message: `${row['设备编号']}电缆检查未通过，进不了供电中，请先完成电缆检查` }
  }
  const head = queueFor(Number(row.id))[0]
  if (head && String(head['航班号']) !== flightNo) {
    return {
      ok: false,
      message: `${row['设备编号']}已有排队航班，按先到先得次序应先保障 ${head['航班号']}，${flightNo} 请登记排队`,
    }
  }
  return checkPower(row, flightNo)
}

export function preflightGpu(deviceId: number, flightNo: string): ActionResult {
  const row = listRows(GPU_KEY).find((item) => Number(item.id) === deviceId)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${deviceId} 的电源车` }
  }
  if (String(row.status) === '供电中') {
    return { ok: true, message: `${row['设备编号']}正在供电中，提交后将按先到先得次序登记排队` }
  }
  const blocked = ensureFlow(String(row.status), '供电中')
  if (blocked) {
    return blocked
  }
  return checkSupplyEligible(row, flightNo.trim())
}

function startSupply(rows: EntryRow[], index: number, flightNo: string, ctx: ActionContext): ActionResult {
  const row = rows[index]
  const device = String(row['设备编号'])

  if (String(row.status) === '供电中') {
    // 同一台设备同一时段只能保障一个航班：冲突请求登记排队，先到先得。
    if (!flightNo) {
      return { ok: false, message: `${device}正在供电中，登记排队也要先填写接机航班号` }
    }
    const queue = listRows(QUEUE_KEY)
    const waiting = queueFor(Number(row.id))
    if (waiting.some((item) => String(item['航班号']) === flightNo)) {
      return { ok: false, message: `航班 ${flightNo} 已在 ${device} 的排队队列中，无需重复登记` }
    }
    const entry: EntryRow = {
      id: nextId(queue),
      status: '排队中',
      pending: true,
      abnormal: false,
      设备ID: Number(row.id),
      设备编号: device,
      航班号: flightNo,
      申请人: ctx.operator,
      申请班组: ctx.team,
      申请时间: nowIso(),
    }
    saveRows(QUEUE_KEY, [...queue, entry])
    appendLog({
      类型: '排队',
      设备编号: device,
      航班号: flightNo,
      班组: ctx.team,
      值班员: ctx.operator,
      说明: `设备供电中，航班 ${flightNo} 登记排队，第${waiting.length + 1}位（先到先得）`,
    })
    return {
      ok: true,
      message: `${device}正在供电中，已为航班 ${flightNo} 登记排队（第${waiting.length + 1}位，按申请先后次序保障）`,
    }
  }

  const blocked = ensureFlow(String(row.status), '供电中')
  if (blocked) {
    return blocked
  }
  const eligible = checkSupplyEligible(row, flightNo)
  if (!eligible.ok) {
    return eligible
  }

  const flight = findFlight(flightNo)
  const updated: EntryRow = {
    ...row,
    status: '供电中',
    pending: true,
    abnormal: false,
    接机航班: flightNo,
    操作人员: ctx.operator,
    归属班组: ctx.team,
    归属值班员: ctx.operator,
    供电开始时间: nowIso(),
    供电时长: '',
    设备状态: '供电中',
  }
  const next = [...rows]
  next[index] = updated
  saveRows(GPU_KEY, next)

  // 队首航班被正式受理，从队列里销记。
  const head = queueFor(Number(row.id))[0]
  if (head && String(head['航班号']) === flightNo) {
    const queue = listRows(QUEUE_KEY).map((item) =>
      Number(item.id) === Number(head.id) ? { ...item, status: '已受理', pending: false } : item,
    )
    saveRows(QUEUE_KEY, queue)
  }

  appendLog({
    类型: '供电',
    设备编号: device,
    航班号: flightNo,
    班组: ctx.team,
    值班员: ctx.operator,
    说明: `发起接机供电，机型 ${String(flight?.['机型'] ?? '')}，${eligible.message}`,
  })
  const available = syncGpuGapToResplan()
  return {
    ok: true,
    message: `${device}已为航班 ${flightNo} 接机供电（${eligible.message}），归属${ctx.team}；当前可调度电源车 ${available} 台，资源缺口清单已同步`,
  }
}

function formatDuration(startIso: unknown): string {
  const start = Date.parse(String(startIso ?? ''))
  if (!Number.isFinite(start)) {
    return '时长未知'
  }
  const minutes = Math.max(1, Math.round((Date.now() - start) / 60000))
  if (minutes < 60) {
    return `${minutes}分钟`
  }
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`
}

function stopSupply(rows: EntryRow[], index: number, ctx: ActionContext): ActionResult {
  const row = rows[index]
  const device = String(row['设备编号'])
  const blocked = ensureFlow(String(row.status), '待命')
  if (blocked) {
    return blocked
  }
  const ownerTeam = String(row['归属班组'] ?? '')
  if (ownerTeam && ownerTeam !== ctx.team) {
    return {
      ok: false,
      message: `该供电由${ownerTeam}（${row['归属值班员'] || '未知值班员'}）发起，跨班组结束一律拒绝；请先交接班，归属随班次移交后再操作`,
    }
  }
  const flightNo = String(row['接机航班'] ?? '')
  const duration = formatDuration(row['供电开始时间'])
  const updated: EntryRow = {
    ...row,
    status: '待命',
    pending: true,
    abnormal: false,
    接机航班: '',
    供电时长: duration,
    供电开始时间: '',
    归属班组: '',
    归属值班员: '',
    设备状态: '待命',
  }
  const next = [...rows]
  next[index] = updated
  saveRows(GPU_KEY, next)
  appendLog({
    类型: '结束供电',
    设备编号: device,
    航班号: flightNo,
    班组: ctx.team,
    值班员: ctx.operator,
    说明: `结束供电，供电时长 ${duration}，设备回到待命`,
  })
  const available = syncGpuGapToResplan()
  const head = queueFor(Number(row.id))[0]
  const queueHint = head ? `；下一位排队航班 ${head['航班号']}，请值班员核对后发起` : ''
  return {
    ok: true,
    message: `${device}已结束对航班 ${flightNo} 的供电（时长 ${duration}），回到待命；当前可调度电源车 ${available} 台，资源缺口清单已同步${queueHint}`,
  }
}

function requestMaintenance(rows: EntryRow[], index: number, ctx: ActionContext): ActionResult {
  const row = rows[index]
  const device = String(row['设备编号'])
  const blocked = ensureFlow(String(row.status), '待检修')
  if (blocked) {
    return blocked
  }
  const updated: EntryRow = { ...row, status: '待检修', pending: false, abnormal: false, 设备状态: '待检修' }
  const next = [...rows]
  next[index] = updated
  saveRows(GPU_KEY, next)
  appendLog({
    类型: '检修',
    设备编号: device,
    班组: ctx.team,
    值班员: ctx.operator,
    说明: '申请检修，设备转入待检修',
  })
  const available = syncGpuGapToResplan()
  return { ok: true, message: `${device}已转入待检修；当前可调度电源车 ${available} 台，资源缺口清单已同步` }
}

function cableCheck(rows: EntryRow[], index: number, ctx: ActionContext): ActionResult {
  const row = rows[index]
  const device = String(row['设备编号'])
  if (String(row.status) !== '待命') {
    return { ok: false, message: `只有待命中的设备才能登记电缆检查，${device}当前为「${row.status}」` }
  }
  if (String(row['电缆检查']) === '已通过') {
    return { ok: false, message: `${device}电缆检查已通过，无需重复登记` }
  }
  const next = [...rows]
  next[index] = { ...row, 电缆检查: '已通过' }
  saveRows(GPU_KEY, next)
  appendLog({
    类型: '电缆检查',
    设备编号: device,
    班组: ctx.team,
    值班员: ctx.operator,
    说明: '电缆检查登记为已通过，设备具备供电条件',
  })
  return { ok: true, message: `${device}电缆检查已通过，可以发起接机供电` }
}

/** 电源车动作统一入口：先卡身份，再按动作分发。 */
export function runGpuAction(
  id: number,
  action: string,
  payload: Record<string, string>,
  ctx: ActionContext,
): ActionResult {
  const rows = listRows(GPU_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的电源车` }
  }
  if (ctx.role !== '值班员') {
    return { ok: false, message: `「${action}」只能由当班值班员操作，${ctx.role || '其他人员'}只能查看供电记录，不能改动` }
  }
  const flightNo = String(payload['航班号'] ?? '').trim()
  switch (action) {
    case '接机供电':
      return startSupply(rows, index, flightNo, ctx)
    case '结束供电':
      return stopSupply(rows, index, ctx)
    case '申请检修':
      return requestMaintenance(rows, index, ctx)
    case '电缆检查':
      return cableCheck(rows, index, ctx)
    default:
      return { ok: false, message: `电源车没有登记「${action}」这个动作` }
  }
}

/**
 * 交接班：供电中设备的归属随班次移交给新班组，并留一条变更记录。
 * 只迁移供电中的归属；待命设备没有供电归属，不受影响。
 */
export function handoverGpuOwnership(ctx: ActionContext): ActionResult {
  const rows = listRows(GPU_KEY)
  const moved: string[] = []
  const next = rows.map((row) => {
    const owner = String(row['归属班组'] ?? '')
    if (String(row.status) === '供电中' && owner && owner !== ctx.team) {
      moved.push(`${row['设备编号']}（${owner}→${ctx.team}）`)
      return { ...row, 归属班组: ctx.team, 归属值班员: ctx.operator }
    }
    return row
  })
  if (moved.length > 0) {
    saveRows(GPU_KEY, next)
  }
  const detail =
    moved.length > 0
      ? `交接班至${ctx.team}（${ctx.shiftLabel}），${moved.length}台供电中设备归属随班次移交：${moved.join('、')}`
      : `交接班至${ctx.team}（${ctx.shiftLabel}），无供电中设备，归属不变`
  appendLog({ 类型: '交接班', 班组: ctx.team, 值班员: ctx.operator, 说明: detail })
  return { ok: true, message: detail }
}
