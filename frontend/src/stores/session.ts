import { defineStore } from 'pinia'

import { SHIFTS } from '@/domain/gpu/catalog'
import type { Role, ShiftKey } from '@/domain/gpu/types'

type SessionState = {
  operator: string
  role: Role
  shift: ShiftKey
  scope: string
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    operator: SHIFTS.day.defaultOperator,
    role: '值班员',
    shift: 'day',
    scope: '机场地面保障作业管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    /** 是否具备写权限：接机供电等写操作只对当班值班员开放。 */
    isDutyOfficer: (state) => state.role === '值班员',
    shiftLabel: (state) => `${SHIFTS[state.shift].label} ${SHIFTS[state.shift].window}`,
    shiftName: (state) => SHIFTS[state.shift].label,
  },
  actions: {
    setRole(role: Role) {
      this.role = role
    },
    setShift(shift: ShiftKey) {
      this.shift = shift
    },
    setOperator(operator: string) {
      this.operator = operator
    },
  },
})
