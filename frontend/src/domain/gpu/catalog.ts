import type { FlightDemand, GpuDevice, ShiftKey } from './types'

/** 班次字典：归属与交接班都用这套，页面上不再各自拼字符串。 */
export const SHIFTS: Record<ShiftKey, { key: ShiftKey; label: string; window: string; defaultOperator: string }> = {
  day: { key: 'day', label: '白班', window: '08:00-20:00', defaultOperator: '王值班' },
  night: { key: 'night', label: '夜班', window: '20:00-次日08:00', defaultOperator: '李值班' },
}

export const SHIFT_ORDER: ShiftKey[] = ['day', 'night']

export function otherShift(shift: ShiftKey): ShiftKey {
  return shift === 'day' ? 'night' : 'day'
}

/** 各机型地面电源需求（kVA）：发起供电前拿设备功率等级和这里核对。 */
export const AIRCRAFT_DEMAND: Record<string, number> = {
  A320: 90,
  B737: 90,
  A330: 180,
 B787: 180,
  A380: 280,
}

/** 当日需供电的航班台账。 */
export const FLIGHTS: FlightDemand[] = [
  { no: 'CA1202', aircraft: 'A320', demandKva: AIRCRAFT_DEMAND.A320, etd: '10:20' },
  { no: 'MU5103', aircraft: 'B737', demandKva: AIRCRAFT_DEMAND.B737, etd: '10:40' },
  { no: 'CZ3107', aircraft: 'A330', demandKva: AIRCRAFT_DEMAND.A330, etd: '11:05' },
  { no: 'HU7805', aircraft: 'B787', demandKva: AIRCRAFT_DEMAND.B787, etd: '11:30' },
  { no: 'CA981', aircraft: 'B747', demandKva: 200, etd: '12:10' },
  { no: 'EK307', aircraft: 'A380', demandKva: AIRCRAFT_DEMAND.A380, etd: '13:00' },
]

/** 电源车台账：额定功率、电缆检查结果决定能不能接哪型飞机。 */
export const SEED_DEVICES: GpuDevice[] = [
  { id: 1, code: 'GPU-0001', kind: '静变电源车', kva: 90, cablePassed: true, status: '待命' },
  { id: 2, code: 'GPU-0002', kind: '静变电源车', kva: 90, cablePassed: true, status: '待命' },
  { id: 3, code: 'GPU-0003', kind: '柴油电源车', kva: 180, cablePassed: true, status: '待命' },
  { id: 4, code: 'GPU-0004', kind: '静变电源车', kva: 90, cablePassed: false, status: '待命' },
  { id: 5, code: 'GPU-0005', kind: '柴油电源车', kva: 280, cablePassed: true, status: '供电中' },
  { id: 6, code: 'GPU-0006', kind: '静变电源车', kva: 60, cablePassed: true, status: '待检修' },
]
