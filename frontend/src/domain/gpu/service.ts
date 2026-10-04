import { ref } from 'vue'

import { saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

import { FLIGHTS, SEED_DEVICES, SHIFTS } from './catalog'
import type {
  AuditEntry,
  Availability,
  GapEntry,
  GpuDevice,
  GpuStatus,
  SessionContext,
  SupplyRecord,
  SupplyRequest,
} from './types'

/**
 * 地面电源领域服务：页面只做展示与入参收集，能不能做、先给谁、状态往哪走，
 * 全部在这里裁决。换后端时把这一层换成 API 调用即可，页面规则不用重写。
 */

const STORAGE_KEY = 'airport-ground-ops:gpu-domain:v1'
const STATUS_FLOW: GpuStatus[] = ['待命', '供电中', '待检修']

type GpuState = {
  devices: GpuDevice[]
  requests: SupplyRequest[]
  records: SupplyRecord[]
  gaps: GapEntry[]
  audits: AuditEntry[]
  seq: { request: number; record: number; gap: number; audit: number }
}

/** 数据版本号：每次落库 +1，页面靠它感知变化重新取值。 */
export const gpuStateVersion = ref(0)

function now(): number {
  return Date.now()
}

function seedState(): GpuState {
  const startTs = now() - (2 * 60 + 15) * 60 * 1000
  return {
    devices: JSON.parse(JSON.stringify(SEED_DEVICES)) as GpuDevice[],
    requests: [
      {
        id: 1,
        deviceId: 5,
        flightNo: 'CA981',
        aircraft: 'B747',
        demandKva: 200,
        appliedAt: now() - 40 * 60 * 1000,
        etd: '12:10',
        ownerShift: 'day',
        applicant: SHIFTS.day.defaultOperator,
        status: '排队中',
      },
      {
        id: 2,
        deviceId: 5,
        flightNo: 'CZ3107',
        aircraft: 'A330',
        demandKva: 180,
        appliedAt: now() - 25 * 60 * 1000,
        etd: '11:05',
        ownerShift: 'day',
        applicant: SHIFTS.day.defaultOperator,
        status: '排队中',
      },
    ],
    records: [
      {
        id: 1,
        deviceId: 3,
        deviceCode: 'GPU-0003',
        flightNo: 'CZ3107',
        aircraft: 'A330',
        demandKva: 180,
        startedAt: now() - 26 * 60 * 60 * 1000,
        ownerShift: 'night',
        initiator: SHIFTS.night.defaultOperator,
        endedAt: now() - 25 * 60 * 60 * 1000,
        endOperator: SHIFTS.night.defaultOperator,
        endShift: 'night',
        status: '已结束',
        requestId: null,
      },
      {
        id: 2,
        deviceId: 5,
        deviceCode: 'GPU-0005',
        flightNo: 'EK307',
        aircraft: 'A380',
        demandKva: 280,
        startedAt: startTs,
        ownerShift: 'day',
        initiator: SHIFTS.day.defaultOperator,
        endedAt: null,
        endOperator: null,
        endShift: null,
        status: '供电中',
        requestId: null,
      },
    ],
    gaps: [
      {
        id: 1,
        reason: '供电结束',
        deviceId: 3,
        deviceCode: 'GPU-0003',
        flightNo: 'CZ3107',
        aircraft: 'A330',
        demandKva: 180,
        availableKva: 180,
        shortfallKva: 0,
        status: '已关闭',
        detail: 'GPU-0003 结束供电后回到待命，无排队待供航班占用该功率档',
        createdAt: now() - 25 * 60 * 60 * 1000,
        closedAt: now() - 25 * 60 * 60 * 1000,
        requestId: null,
      },
    ],
    audits: [
      {
        id: 1,
        at: now() - 26 * 60 * 60 * 1000,
        operator: SHIFTS.night.defaultOperator,
        role: '值班员',
        shift: 'night',
        action: '接机供电',
        target: 'GPU-0003 / CZ3107',
        ok: true,
        detail: '功率等级 180kVA 满足 A330 需求 180kVA，电缆检查通过',
      },
      {
        id: 2,
        at: now() - (2 * 60 + 15) * 60 * 1000,
        operator: SHIFTS.day.defaultOperator,
        role: '值班员',
        shift: 'day',
        action: '接机供电',
        target: 'GPU-0005 / EK307',
        ok: true,
        detail: '功率等级 280kVA 满足 A380 需求 280kVA，电缆检查通过',
      },
    ],
    seq: { request: 3, record: 3, gap: 2, audit: 3 },
  }
}

function loadState(): GpuState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedState()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return seedState()
  }
  try {
    return JSON.parse(raw) as GpuState
  } catch {
    return seedState()
  }
}

let state: GpuState | null = null

function get(): GpuState {
  if (state === null) {
    state = loadState()
    reconcileGaps(state)
    syncGenericRows(state)
  }
  return state
}

function persist(s: GpuState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  }
  reconcileGaps(s)
  syncGenericRows(s)
  gpuStateVersion.value += 1
}

/** 设备表镜像回通用条目表：概览、导出 CSV、通用列表都跟领域数据同源。 */
function syncGenericRows(s: GpuState): void {
  const rows: EntryRow[] = s.devices.map((device) => ({
    id: device.id,
    status: device.status,
    pending: device.status !== '待检修',
    abnormal: false,
    设备编号: device.code,
    设备类型: device.kind,
    功率等级: `${device.kva}kVA`,
    接机航班: activeRecord(s, device.id)?.flightNo ?? '',
    供电时长: activeRecord(s, device.id) ? formatDuration(now() - activeRecord(s, device.id)!.startedAt) : '',
    操作人员: activeRecord(s, device.id)?.initiator ?? '',
    电缆检查: device.cablePassed ? '通过' : '未通过',
    设备状态: device.status,
  }))
  saveRows('gpu', rows)
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export function getDevices(): GpuDevice[] {
  return get().devices
}

export function getDevice(id: number): GpuDevice | undefined {
  return get().devices.find((item) => item.id === id)
}

export function getRequests(): SupplyRequest[] {
  return [...get().requests].sort(compareRequest)
}

export function pendingRequests(deviceId?: number): SupplyRequest[] {
  return getRequests().filter(
    (item) => item.status === '排队中' && (deviceId === undefined || item.deviceId === deviceId),
  )
}

export function getRecords(): SupplyRecord[] {
  return [...get().records].sort((a, b) => b.startedAt - a.startedAt)
}

export function getGaps(): GapEntry[] {
  return [...get().gaps].sort((a, b) => b.createdAt - a.createdAt)
}

export function getAudits(): AuditEntry[] {
  return [...get().audits].sort((a, b) => b.at - a.at)
}

function activeRecord(s: GpuState, deviceId: number): SupplyRecord | undefined {
  return s.records.find((item) => item.deviceId === deviceId && item.status === '供电中')
}

export function activeForDevice(deviceId: number): SupplyRecord | undefined {
  return activeRecord(get(), deviceId)
}

function activeForFlight(s: GpuState, flightNo: string): SupplyRecord | undefined {
  return s.records.find((item) => item.flightNo === flightNo && item.status === '供电中')
}

/** 排队裁决（固定次序，不接受人为插队）：申请时刻 → 计划起飞时刻 → 航班号。 */
function compareRequest(a: SupplyRequest, b: SupplyRequest): number {
  if (a.appliedAt !== b.appliedAt) return a.appliedAt - b.appliedAt
  if (a.etd !== b.etd) return a.etd.localeCompare(b.etd)
  return a.flightNo.localeCompare(b.flightNo)
}

function queueFor(s: GpuState, deviceId: number): SupplyRequest[] {
  return s.requests
    .filter((item) => item.deviceId === deviceId && item.status === '排队中')
    .sort(compareRequest)
}

/** 调度侧口径：待命且电缆检查通过，随时能接飞机。 */
function capableStandbyDevices(s: GpuState, demandKva: number): GpuDevice[] {
  return s.devices.filter((item) => item.status === '待命' && item.cablePassed && item.kva >= demandKva)
}

/** 同一份口径，电源页和资源调度页都从这里取可用台数。 */
export function getAvailability(): Availability {
  const s = get()
  return {
    total: s.devices.length,
    supplying: s.devices.filter((item) => item.status === '供电中').length,
    standby: s.devices.filter((item) => item.status === '待命').length,
    available: s.devices.filter((item) => item.status === '待命' && item.cablePassed).length,
    maintenance: s.devices.filter((item) => item.status === '待检修').length,
    queueLength: s.requests.filter((item) => item.status === '排队中').length,
    openGaps: s.gaps.filter((item) => item.status === '开放').length,
  }
}

// ---------------------------------------------------------------------------
// 缺口清单：结束供电必落一条；排队要不到功率的缺口在这里对账，状态自动开关
// ---------------------------------------------------------------------------

function nextId(s: GpuState, key: keyof GpuState['seq']): number {
  s.seq[key] += 1
  return s.seq[key]
}

function maxAvailableKva(s: GpuState): number {
  const kvas = s.devices.filter((item) => item.status === '待命' && item.cablePassed).map((item) => item.kva)
  return kvas.length ? Math.max(...kvas) : 0
}

/**
 * 对账排队待供缺口：有排队申请、且全场找不到一台带得动的待命设备时，缺口开放；
 * 一旦有了可调用设备（释放、修复、电缆复检通过），缺口自动关闭。
 */
function reconcileGaps(s: GpuState): void {
  for (const request of s.requests.filter((item) => item.status === '排队中')) {
    const short = capableStandbyDevices(s, request.demandKva).length === 0
    const existing = s.gaps.find(
      (gap) => gap.reason === '排队待供' && gap.requestId === request.id && gap.status === '开放',
    )
    if (short && !existing) {
      const availableKva = maxAvailableKva(s)
      s.gaps.push({
        id: nextId(s, 'gap'),
        reason: '排队待供',
        deviceId: request.deviceId,
        deviceCode: deviceCode(s, request.deviceId),
        flightNo: request.flightNo,
        aircraft: request.aircraft,
        demandKva: request.demandKva,
        availableKva,
        shortfallKva: Math.max(0, request.demandKva - availableKva),
        status: '开放',
        detail: `${request.flightNo}（${request.aircraft}）排队待供，需求 ${request.demandKva}kVA，全场待命设备最高仅 ${availableKva}kVA`,
        createdAt: now(),
        closedAt: null,
        requestId: request.id,
      })
    } else if (!short && existing) {
      existing.status = '已关闭'
      existing.closedAt = now()
      existing.detail = `${existing.flightNo} 已有可调用电台车（功率满足、电缆通过），缺口关闭`
    }
  }
  // 申请已开始/撤销，挂在它名下的缺口关闭。
  for (const gap of s.gaps) {
    if (gap.reason !== '排队待供' || gap.status !== '开放' || gap.requestId === null) continue
    const request = s.requests.find((item) => item.id === gap.requestId)
    if (!request || request.status !== '排队中') {
      gap.status = '已关闭'
      gap.closedAt = now()
    }
  }
}

function deviceCode(s: GpuState, deviceId: number): string {
  return s.devices.find((item) => item.id === deviceId)?.code ?? `#${deviceId}`
}

// ---------------------------------------------------------------------------
// 审计：每个写操作（含被拒绝的）都留痕，解决「说不清是谁改的状态」
// ---------------------------------------------------------------------------

function audit(
  s: GpuState,
  ctx: SessionContext,
  action: string,
  target: string,
  ok: boolean,
  detail: string,
): void {
  s.audits.unshift({
    id: nextId(s, 'audit'),
    at: now(),
    operator: ctx.operator,
    role: ctx.role,
    shift: ctx.shift,
    action,
    target,
    ok,
    detail,
  })
}

function deny(message: string): ActionResult {
  return { ok: false, message }
}

// ---------------------------------------------------------------------------
// 动作
// ---------------------------------------------------------------------------

/**
 * 接机供电：值班员发起。设备空闲且无排队则立即开始；设备被占用则进入排队，
 * 由固定裁决规则定位次；功率不够、电缆没过、跳级、重复供电一律拒绝。
 */
export function startSupply(deviceId: number, flightNo: string, ctx: SessionContext): ActionResult {
  const s = get()
  const device = s.devices.find((item) => item.id === deviceId)
  if (!device) {
    return deny(`没有找到编号为 ${deviceId} 的电源车`)
  }
  const target = `${device.code} / ${flightNo}`

  if (ctx.role !== '值班员') {
    audit(s, ctx, '接机供电', target, false, '仅当班值班员可发起供电，当前为查看权限')
    persist(s)
    return deny('只有当班值班员能发起接机供电，你当前只有查看权限')
  }

  const flight = FLIGHTS.find((item) => item.no === flightNo)
  if (!flight) {
    audit(s, ctx, '接机供电', target, false, '航班不在当日供电台账')
    persist(s)
    return deny(`航班 ${flightNo} 不在当日供电台账，无法核对机型需求`)
  }

  if (device.status === '待检修') {
    audit(s, ctx, '接机供电', target, false, '设备处于待检修，状态机不允许跳到供电中')
    persist(s)
    return deny(`${device.code} 当前待检修，不能直接进入供电中（状态只能按 待命→供电中→待命→待检修 流转）`)
  }

  // 同一时段独占性优先：一个航班只能占用一台设备（供电中或排队中）。
  const occupiedBy = activeForFlight(s, flight.no)
  if (occupiedBy) {
    audit(
      s,
      ctx,
      '接机供电',
      target,
      false,
      `该航班已由 ${deviceCode(s, occupiedBy.deviceId)} 供电中，同一时段不得重复供电`,
    )
    persist(s)
    return deny(`航班 ${flight.no} 正由 ${deviceCode(s, occupiedBy.deviceId)} 供电，同一时段一台航班只能接一路电源`)
  }

  const duplicate = queueFor(s, device.id).some((item) => item.flightNo === flight.no)
  if (duplicate) {
    audit(s, ctx, '接机供电', target, false, '该航班已在本设备排队中')
    persist(s)
    return deny(`航班 ${flight.no} 已在 ${device.code} 的供电队列里，不用重复申请`)
  }
  const queuedElsewhere = s.requests.find(
    (item) => item.status === '排队中' && item.flightNo === flight.no && item.deviceId !== device.id,
  )
  if (queuedElsewhere) {
    audit(
      s,
      ctx,
      '接机供电',
      target,
      false,
      `该航班已在 ${deviceCode(s, queuedElsewhere.deviceId)} 排队，同一时段只能等一台设备`,
    )
    persist(s)
    return deny(`航班 ${flight.no} 已在 ${deviceCode(s, queuedElsewhere.deviceId)} 排队，同一航班同一时段不能再占另一台设备的队列`)
  }

  if (!device.cablePassed) {
    audit(s, ctx, '接机供电', target, false, '电缆检查未通过')
    persist(s)
    return deny(`${device.code} 电缆检查未通过，不得进入供电中，请先完成电缆复检`)
  }

  if (flight.demandKva > device.kva) {
    const diff = flight.demandKva - device.kva
    audit(
      s,
      ctx,
      '接机供电',
      target,
      false,
      `功率不足：${device.kind} ${device.kva}kVA，机型需求 ${flight.demandKva}kVA，差值 ${diff}kVA`,
    )
    persist(s)
    return deny(
      `功率等级不够：${device.code} 额定 ${device.kva}kVA，${flight.aircraft} 需 ${flight.demandKva}kVA，差值 ${diff}kVA，拒绝接机`,
    )
  }


  const queue = queueFor(s, device.id)
  const beginNow = device.status === '待命' && (queue.length === 0 || queue[0].flightNo === flight.no)

  if (!beginNow) {
    // 设备占用或队首另有航班：按固定次序入队，不允许挑着供。
    const request: SupplyRequest = {
      id: nextId(s, 'request'),
      deviceId: device.id,
      flightNo: flight.no,
      aircraft: flight.aircraft,
      demandKva: flight.demandKva,
      appliedAt: now(),
      etd: flight.etd,
      ownerShift: ctx.shift,
      applicant: ctx.operator,
      status: '排队中',
    }
    s.requests.push(request)
    const position = queueFor(s, device.id).findIndex((item) => item.id === request.id) + 1
    audit(
      s,
      ctx,
      '供电排队',
      target,
      true,
      `${device.code} ${device.status === '供电中' ? '正在供电' : '队列非空'}，${flight.no} 按裁决次序排第 ${position} 位（申请时刻→起飞时刻→航班号）`,
    )
    persist(s)
    return {
      ok: true,
      message: `${device.code} 暂不可用，${flight.no}（${flight.aircraft}）已进入供电队列，当前第 ${position} 位`,
    }
  }

  // 立即开始；若队首正是该航班，同步核销申请。
  const head = queue.find((item) => item.flightNo === flight.no)
  if (head) head.status = '已开始'
  const record: SupplyRecord = {
    id: nextId(s, 'record'),
    deviceId: device.id,
    deviceCode: device.code,
    flightNo: flight.no,
    aircraft: flight.aircraft,
    demandKva: flight.demandKva,
    startedAt: now(),
    ownerShift: ctx.shift,
    initiator: ctx.operator,
    endedAt: null,
    endOperator: null,
    endShift: null,
    status: '供电中',
    requestId: head ? head.id : null,
  }
  s.records.push(record)
  device.status = '供电中'
  audit(
    s,
    ctx,
    '接机供电',
    target,
    true,
    `功率等级 ${device.kva}kVA 满足 ${flight.aircraft} 需求 ${flight.demandKva}kVA，电缆检查通过，归属${SHIFTS[ctx.shift].label}`,
  )
  persist(s)
  return { ok: true, message: `${device.code} 已开始为 ${flight.no}（${flight.aircraft}）供电，归属${SHIFTS[ctx.shift].label}` }
}

/** 结束供电：只能由归属班次的当班值班员执行；结果必落资源缺口清单。 */
export function endSupply(deviceId: number, ctx: SessionContext): ActionResult {
  const s = get()
  const device = s.devices.find((item) => item.id === deviceId)
  if (!device) {
    return deny(`没有找到编号为 ${deviceId} 的电源车`)
  }
  const record = activeRecord(s, deviceId)

  if (ctx.role !== '值班员') {
    audit(s, ctx, '结束供电', device.code, false, '仅当班值班员可结束供电，当前为查看权限')
    persist(s)
    return deny('只有当班值班员能结束供电，你当前只有查看权限')
  }
  if (device.status !== '供电中' || !record) {
    audit(s, ctx, '结束供电', device.code, false, '设备并非供电中，不允许跳级/重复操作')
    persist(s)
    return deny(`${device.code} 当前是「${device.status}」，没有供电中的任务可结束`)
  }
  if (record.ownerShift !== ctx.shift) {
    audit(
      s,
      ctx,
      '结束供电',
      `${device.code} / ${record.flightNo}`,
      false,
      `跨班组结束被拒：该供电归属${SHIFTS[record.ownerShift].label}，当前为${SHIFTS[ctx.shift].label}`,
    )
    persist(s)
    return deny(
      `拒绝跨班组操作：${record.flightNo} 的供电由${SHIFTS[record.ownerShift].label}发起并归属，${SHIFTS[ctx.shift].label}无权结束，请先交接班`,
    )
  }

  record.status = '已结束'
  record.endedAt = now()
  record.endOperator = ctx.operator
  record.endShift = ctx.shift
  device.status = '待命'

  const waiting = queueFor(s, device.id)
  const nextDemand = waiting[0]
  const availableKva = maxAvailableKva(s)
  const remainsShort = waiting.some((item) => capableStandbyDevices(s, item.demandKva).length === 0)
  s.gaps.push({
    id: nextId(s, 'gap'),
    reason: '供电结束',
    deviceId: device.id,
    deviceCode: device.code,
    flightNo: record.flightNo,
    aircraft: record.aircraft,
    demandKva: record.demandKva,
    availableKva,
    shortfallKva: Math.max(0, record.demandKva - availableKva),
    status: remainsShort ? '开放' : '已关闭',
    detail: remainsShort
      ? `${device.code} 已结束 ${record.flightNo} 供电回待命；下一排队 ${nextDemand.flightNo}（${nextDemand.aircraft}）需求 ${nextDemand.demandKva}kVA，暂无同功率档可调设备`
      : `${device.code} 已结束 ${record.flightNo} 供电回待命${waiting.length ? `，下一排队 ${waiting[0].flightNo} 可接续` : '，无排队待供'}`,
    createdAt: now(),
    closedAt: remainsShort ? null : now(),
    requestId: null,
  })

  audit(s, ctx, '结束供电', `${device.code} / ${record.flightNo}`, true, '设备回到待命，结束结果已写入资源缺口清单')
  persist(s)
  return {
    ok: true,
    message: `${device.code} 已结束 ${record.flightNo} 供电并回到待命，结果已落入资源缺口清单${waiting.length ? `，队首 ${waiting[0].flightNo} 可接续供电` : ''}`,
  }
}

/** 申请检修：只允许从待命进入待检修，供电中跳过来一律拦下。 */
export function requestMaintenance(deviceId: number, ctx: SessionContext): ActionResult {
  const s = get()
  const device = s.devices.find((item) => item.id === deviceId)
  if (!device) {
    return deny(`没有找到编号为 ${deviceId} 的电源车`)
  }
  if (ctx.role !== '值班员') {
    audit(s, ctx, '申请检修', device.code, false, '仅当班值班员可申请检修')
    persist(s)
    return deny('只有当班值班员能申请检修，你当前只有查看权限')
  }
  if (device.status === '待检修') {
    return deny(`${device.code} 已经是待检修，不用重复申请`)
  }
  if (device.status === '供电中') {
    audit(s, ctx, '申请检修', device.code, false, '供电中直接申请检修属于跳级，已拦下')
    persist(s)
    return deny(`${device.code} 供电中，必须先结束供电回到待命才能申请检修（禁止跳级）`)
  }
  device.status = '待检修'
  audit(s, ctx, '申请检修', device.code, true, '设备由待命转入待检修')
  persist(s)
  return { ok: true, message: `${device.code} 已转入待检修` }
}

/** 修复完成：待检修 → 待命，是状态机唯一的回头路。 */
export function repairComplete(deviceId: number, ctx: SessionContext): ActionResult {
  const s = get()
  const device = s.devices.find((item) => item.id === deviceId)
  if (!device) {
    return deny(`没有找到编号为 ${deviceId} 的电源车`)
  }
  if (ctx.role !== '值班员') {
    audit(s, ctx, '修复完成', device.code, false, '仅当班值班员可确认修复')
    persist(s)
    return deny('只有当班值班员能确认修复完成，你当前只有查看权限')
  }
  if (device.status !== '待检修') {
    audit(s, ctx, '修复完成', device.code, false, '仅待检修设备可修复回待命')
    persist(s)
    return deny(`${device.code} 当前是「${device.status}」，只有待检修设备能修复回待命`)
  }
  device.status = '待命'
  audit(s, ctx, '修复完成', device.code, true, '设备修复完成，回到待命')
  persist(s)
  return { ok: true, message: `${device.code} 修复完成，已回到待命` }
}

/** 撤销排队：只有归属班次的值班员能撤。 */
export function cancelRequest(requestId: number, ctx: SessionContext): ActionResult {
  const s = get()
  const request = s.requests.find((item) => item.id === requestId)
  if (!request) {
    return deny(`没有找到编号为 ${requestId} 的供电申请`)
  }
  if (ctx.role !== '值班员') {
    audit(s, ctx, '撤销排队', `#${requestId} ${request.flightNo}`, false, '仅当班值班员可撤销排队')
    persist(s)
    return deny('只有当班值班员能撤销排队申请，你当前只有查看权限')
  }
  if (request.status !== '排队中') {
    return deny(`申请 ${request.flightNo} 已${request.status}，无需撤销`)
  }
  if (request.ownerShift !== ctx.shift) {
    audit(s, ctx, '撤销排队', `#${requestId} ${request.flightNo}`, false, '跨班组撤销被拒')
    persist(s)
    return deny(`该排队申请归属${SHIFTS[request.ownerShift].label}，${SHIFTS[ctx.shift].label}无权撤销`)
  }
  request.status = '已撤销'
  audit(s, ctx, '撤销排队', `${deviceCode(s, request.deviceId)} / ${request.flightNo}`, true, '排队申请已撤销')
  persist(s)
  return { ok: true, message: `${request.flightNo} 的排队申请已撤销` }
}

/**
 * 交接班：在供电的归属整体移交给接班班次，每一条在供电留一条变更记录；
 * 排队申请归属同步移交。交接后由发起方的下一班继续负责。
 */
export function handover(ctx: SessionContext): ActionResult {
  const s = get()
  if (ctx.role !== '值班员') {
    audit(s, ctx, '交接班', '电源归属移交', false, '查看人员无权交接班')
    persist(s)
    return deny('只有当班值班员能执行交接班')
  }
  const toShift = ctx.shift === 'day' ? 'night' : 'day'
  const active = s.records.filter((item) => item.status === '供电中' && item.ownerShift === ctx.shift)
  const queued = s.requests.filter((item) => item.status === '排队中' && item.ownerShift === ctx.shift)

  if (active.length === 0 && queued.length === 0) {
    audit(s, ctx, '交接班', '电源归属移交', true, `本班无在供电/排队，班次切到${SHIFTS[toShift].label}`)
    persist(s)
    return { ok: true, message: `本班无在供电与排队，已交接给${SHIFTS[toShift].label}` }
  }

  for (const record of active) {
    record.ownerShift = toShift
    s.audits.unshift({
      id: nextId(s, 'audit'),
      at: now(),
      operator: ctx.operator,
      role: ctx.role,
      shift: ctx.shift,
      action: '归属移交',
      target: `${record.deviceCode} / ${record.flightNo}`,
      ok: true,
      detail: `交接班：${record.flightNo} 在供电归属由${SHIFTS[ctx.shift].label}（发起人 ${record.initiator}）移交${SHIFTS[toShift].label}`,
    })
  }
  for (const request of queued) {
    request.ownerShift = toShift
  }
  if (queued.length > 0) {
    s.audits.unshift({
      id: nextId(s, 'audit'),
      at: now(),
      operator: ctx.operator,
      role: ctx.role,
      shift: ctx.shift,
      action: '归属移交',
      target: `排队申请 ×${queued.length}`,
      ok: true,
      detail: `交接班：${queued.length} 条排队待供申请归属随班次移交${SHIFTS[toShift].label}`,
    })
  }
  audit(
    s,
    ctx,
    '交接班',
    '电源归属移交',
    true,
    `在供电 ${active.length} 条、排队 ${queued.length} 条已移交${SHIFTS[toShift].label}`,
  )
  persist(s)
  return {
    ok: true,
    message: `已交接给${SHIFTS[toShift].label}：${active.length} 条在供电、${queued.length} 条排队的归属已随班次移交并留痕`,
  }
}

// ---------------------------------------------------------------------------
// 展示辅助
// ---------------------------------------------------------------------------

export function formatTime(ts: number | null): string {
  if (ts === null) return '—'
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}小时` : `${hours}小时${rest}分`
}

export { STATUS_FLOW }
