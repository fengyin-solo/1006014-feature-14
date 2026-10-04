<template>
  <section class="page" data-module="gpu">
    <header class="page-head">
      <div>
        <h2>地面电源管理</h2>
        <p class="page-desc">维护电源车，围绕设备编号、设备类型、功率等级、接机航班做登记、筛选与状态流转。供电只能由当班值班员发起，归属随班次移交，状态按待命→供电中→待命→待检修流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记电源车</button>
        <button class="btn" type="button" @click="exportRows">导出地面电源清单</button>
      </div>
    </header>

    <div class="session-bar">
      <span>当前身份：<strong>{{ store.role }}</strong> · {{ store.team }} · {{ store.shiftLabel }}</span>
      <button class="btn ghost" type="button" @click="toggleRole">
        切换为{{ store.role === '值班员' ? '观察员' : '值班员' }}
      </button>
      <label class="session-team">
        班组
        <select :value="store.team" @change="onTeamChange">
          <option v-for="team in teams" :key="team" :value="team">{{ team }}</option>
        </select>
      </label>
      <button class="btn" type="button" :disabled="store.role !== '值班员'" @click="handover">
        交接班
      </button>
      <span v-if="store.role !== '值班员'" class="readonly-hint">观察角色只能查看供电记录，不能改动</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="store.role === '值班员'">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="readonly-hint">只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无地面电源数据，可先登记电源车</td>
        </tr>
      </tbody>
    </table>

    <section class="gpu-side">
      <h3>排队中的供电请求</h3>
      <p class="gpu-side-desc">同一台设备同一时段只保障一个航班，冲突按申请时间先到先得，同刻按航班号升序。</p>
      <p v-if="!queueRows.length" class="empty-state">暂无排队请求</p>
      <ul v-else class="queue-list">
        <li v-for="(item, index) in queueRows" :key="String(item.id)">
          第{{ index + 1 }}位 · {{ item.设备编号 }} ← 航班 {{ item.航班号 }}
          （{{ item.申请班组 }} {{ item.申请人 }} 登记）
        </li>
      </ul>
    </section>

    <section class="gpu-side">
      <h3>供电记录与归属变更</h3>
      <p class="gpu-side-desc">所有角色可查看；记录只能由系统动作写入，页面没有改动入口。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>设备编号</th>
            <th>航班号</th>
            <th>班组</th>
            <th>值班员</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logRows" :key="String(log.id)">
            <td>{{ log.时间 }}</td>
            <td>{{ log.类型 }}</td>
            <td>{{ log.设备编号 || '—' }}</td>
            <td>{{ log.航班号 || '—' }}</td>
            <td>{{ log.班组 || '—' }}</td>
            <td>{{ log.值班员 || '—' }}</td>
            <td>{{ log.说明 }}</td>
          </tr>
          <tr v-if="!logRows.length">
            <td colspan="7" class="empty-state">暂无供电记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条地面电源记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="supplyTarget" class="dialog-mask">
      <div class="dialog">
        <h3>发起接机供电 · {{ supplyTarget.设备编号 }}</h3>
        <p class="dialog-meta">
          功率等级 {{ supplyTarget.功率等级 || '—' }} · 电缆检查 {{ supplyTarget.电缆检查 || '—' }} ·
          当前状态 {{ supplyTarget.status }}
        </p>
        <label class="dialog-field">
          <span>接机航班号</span>
          <input v-model.trim="supplyFlight" placeholder="如 CA1234" />
        </label>
        <p v-if="preflight" :class="preflight.ok ? 'ok-text' : 'error-text'">{{ preflight.message }}</p>
        <div class="dialog-actions">
          <button class="btn primary" type="button" :disabled="!supplyFlight" @click="confirmSupply">
            {{ supplyTarget.status === '供电中' ? '登记排队' : '确认发起' }}
          </button>
          <button class="btn ghost" type="button" @click="cancelSupply">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { handoverGpuOwnership, listGpuLog, listGpuQueue, preflightGpu } from '@/api/gpu-service'
import { GPU_TEAMS } from '@/data/gpu-rules'
import type { ActionContext, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('gpu')
const columns = ["设备编号", "设备类型", "功率等级", "接机航班", "供电时长", "操作人员", "归属班组", "电缆检查", "设备状态"]
const actions = ["接机供电", "结束供电", "申请检修", "电缆检查"]
const statuses = ["待命", "供电中", "待检修", "已停用"]

const store = useSessionStore()
const teams = GPU_TEAMS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const logRows = ref<EntryRow[]>([])
const queueRows = ref<EntryRow[]>([])
const supplyTarget = ref<EntryRow | null>(null)
const supplyFlight = ref('')

const stats = computed(() => [
  { label: '在册电源车', value: rows.value.length },
  { label: '供电中设备', value: rows.value.filter((row) => String(row.status) === '供电中').length },
  { label: '待检修设备', value: rows.value.filter((row) => String(row.status) === '待检修').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const preflight = computed(() => {
  if (!supplyTarget.value || !supplyFlight.value) {
    return null
  }
  return preflightGpu(Number(supplyTarget.value.id), supplyFlight.value)
})

function context(): ActionContext {
  return {
    operator: store.operator,
    role: store.role,
    team: store.team,
    shiftLabel: store.shiftLabel,
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '电源车登记入口尚未接入审批流'
}

function toggleRole() {
  store.setRole(store.role === '值班员' ? '观察员' : '值班员')
  noticeMessage.value = `已切换为${store.role}`
}

function onTeamChange(event: Event) {
  const team = (event.target as HTMLSelectElement).value
  store.setTeam(team)
  noticeMessage.value = `已切换到${team}身份（未走交接班，供电中设备的归属不变）`
}

function handover() {
  store.handover()
  const result = handoverGpuOwnership(context())
  noticeMessage.value = result.message
  errorMessage.value = ''
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  if (action === '接机供电') {
    supplyTarget.value = row
    supplyFlight.value = String(row['接机航班'] ?? '')
    return
  }
  const result = applyAction(meta.key, Number(row.id), action, {}, context())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function confirmSupply() {
  if (!supplyTarget.value) {
    return
  }
  const result = applyAction(
    meta.key,
    Number(supplyTarget.value.id),
    '接机供电',
    { 航班号: supplyFlight.value },
    context(),
  )
  if (!result.ok) {
    errorMessage.value = result.message
    noticeMessage.value = ''
    return
  }
  noticeMessage.value = result.message
  errorMessage.value = ''
  supplyTarget.value = null
  supplyFlight.value = ''
  reload()
}

function cancelSupply() {
  supplyTarget.value = null
  supplyFlight.value = ''
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    logRows.value = listGpuLog().slice(0, 20)
    queueRows.value = listGpuQueue()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地面电源列表读取失败'
  }
}

onMounted(reload)
</script>
