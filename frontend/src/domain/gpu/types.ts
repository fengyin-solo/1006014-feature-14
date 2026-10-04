/** 地面电源（GPU）领域模型：职责归属、状态机、排队、缺口清单都在这一层落规则。 */

export type GpuStatus = '待命' | '供电中' | '待检修'

export type Role = '值班员' | '查看人员'
export type ShiftKey = 'day' | 'night'

/** 每次写操作的会话上下文：谁、什么角色、属于哪个班次。 */
export type SessionContext = {
  role: Role
  shift: ShiftKey
  operator: string
}

export type GpuDevice = {
  id: number
  code: string
  kind: string
  /** 额定功率，单位 kVA */
  kva: number
  /** 电缆检查是否通过：没通过的设备进不了「供电中」 */
  cablePassed: boolean
  status: GpuStatus
}

export type FlightDemand = {
  /** 航班号 */
  no: string
  /** 机型 */
  aircraft: string
  /** 机型地面电源需求，单位 kVA */
  demandKva: number
  /** 计划起飞时刻，仅用于排队裁决，格式 HH:mm */
  etd: string
}

export type RequestStatus = '排队中' | '已开始' | '已撤销'

export type SupplyRequest = {
  id: number
  deviceId: number
  flightNo: string
  aircraft: string
  demandKva: number
  /** 申请时刻（毫秒时间戳），排队第一裁决键 */
  appliedAt: number
  etd: string
  /** 归属班次：交接班时跟着班次走 */
  ownerShift: ShiftKey
  applicant: string
  status: RequestStatus
}

export type SupplyStatus = '供电中' | '已结束'

export type SupplyRecord = {
  id: number
  deviceId: number
  deviceCode: string
  flightNo: string
  aircraft: string
  demandKva: number
  startedAt: number
  /** 归属班次：谁发起归谁，交接班整体移交 */
  ownerShift: ShiftKey
  initiator: string
  endedAt: number | null
  endOperator: string | null
  endShift: ShiftKey | null
  status: SupplyStatus
  /** 来自排队申请时记录申请编号，直接发起为空 */
  requestId: number | null
}

export type GapReason = '供电结束' | '排队待供'
export type GapStatus = '开放' | '已关闭'

export type GapEntry = {
  id: number
  reason: GapReason
  deviceId: number
  deviceCode: string
  flightNo: string
  aircraft: string
  /** 机型需求功率 kVA */
  demandKva: number
  /** 当时可提供的最大功率 kVA */
  availableKva: number
  /** 差值：需求 - 可提供，正数即真正带不动的缺口 */
  shortfallKva: number
  status: GapStatus
  detail: string
  createdAt: number
  closedAt: number | null
  /** 排队待供缺口关联的申请编号 */
  requestId: number | null
}

export type AuditEntry = {
  id: number
  at: number
  operator: string
  role: Role
  shift: ShiftKey
  action: string
  target: string
  ok: boolean
  detail: string
}

export type Availability = {
  total: number
  supplying: number
  standby: number
  /** 待命且电缆检查通过：调度侧口径的真正可用台数 */
  available: number
  maintenance: number
  queueLength: number
  openGaps: number
}
