import { defineStore } from 'pinia'

import { GPU_SHIFTS, GPU_TEAMS } from '@/data/gpu-rules'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: '值班员',
    team: GPU_TEAMS[0],
    shiftLabel: GPU_SHIFTS[0],
    scope: '机场地面保障作业管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isDuty: (state) => state.role === '值班员',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: string) {
      this.role = role
    },
    setTeam(team: string) {
      this.team = team
    },
    /** 交接班：轮到下一班组、切换昼夜班次；电源车归属迁移由 gpu-service 跟进。 */
    handover() {
      const index = GPU_TEAMS.indexOf(this.team)
      this.team = GPU_TEAMS[(index + 1) % GPU_TEAMS.length]
      this.shiftLabel = this.shiftLabel === GPU_SHIFTS[0] ? GPU_SHIFTS[1] : GPU_SHIFTS[0]
    },
  },
})
