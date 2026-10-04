<template>
  <section class="page gpu-page" data-module="gpu">
    <header class="page-head">
      <div>
        <h2>地面电源管理</h2>
        <p class="page-desc">
          接机供电仅当班值班员可发起；发起前核对功率等级与机型需求，电缆检查未通过不得供电。
          设备按「待命 → 供电中 → 待命 → 待检修」流转，跨班组不得结束他人供电。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出地面电源清单</button>
      </div>
    </header>

    <!-- 当前席位与班次：写权限只发给当班值班员，交接班把在供电归属整体移交 -->
    <div class="duty-bar">
      <label class="duty-field">
        <span>身份</span>
        <select v-model="store.role">
          <option value="值班员">当班值班员（可发起/结束）</option>
          <option value="查看人员">查看人员（只读）</option>
        </select>
      </label>
      <label class="duty-field">
        <span>班次</span>
        <select v-model="store.shift">
          <option value="day">白班 08:00-20:00</option>
          <option value="night">夜班 20:00-次日08:00</option>
        </select>
      </label>
      <label class="duty-field">
        <span>姓名</span>
        <input v-model="store.operator" placeholder="值班员姓名" />
      </label>
      <button class="btn primary" type="button" :disabled="!store.isDutyOfficer" @click="doHandover">
        交接班（归属移交{{ store.shiftName === '白班' ? '夜班' : '白班' }}）
      </button>
      <span v-if="!store.isDutyOfficer" class="duty-hint">查看人员仅能浏览供电记录与缺口清单，不能改动任何状态</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card" :class="{ highlight: item.highlight }">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">排队裁决：申请时刻 → 计划起飞 → 航班号，不接受插队</span>
    </p>

    <p v-if="message" class="action-message" :class="messageOk ? 'ok' : 'error-text'">{{ message }}</p>

    <!-- 排队待供：同一设备同一时段只服务一个航班，冲突的按裁决次序在这里排队 -->
    <section v-if="queueRows.length" class="queue-panel">
      <h3>供电排队（{{ queueRows.length }}）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>队位</th><th>电源车</th><th>航班</th><th>机型</th><th>需求功率</th><th>计划起飞</th>
            <th>申请时刻</th><th>归属班次</th><th>申请人</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in queueRows" :key="item.id">
            <td>
              {{ index + 1 }}
              <span v-if="index === 0" class="queue-head-badge">队首</span>
            </td>
            <td>{{ deviceCodeOf(item.deviceId) }}</td>
            <td>{{ item.flightNo }}</td>
            <td>{{ item.aircraft }}</td>
            <td>{{ item.demandKva }}kVA</td>
            <td>{{ item.etd }}</td>
            <td>{{ formatTime(item.appliedAt) }}</td>
            <td>{{ shiftName(item.ownerShift) }}</td>
            <td>{{ item.applicant }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openStartFor(item.deviceId, item.flightNo)">
                开始供电（核销申请）
              </button>
              <button class="link danger" type="button" @click="doCancel(item.id)">撤销</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th>设备编号</th><th>设备类型</th><th>功率等级</th><th>电缆检查</th>
          <th>当前航班</th><th>归属班次/发起人</th><th>供电时长</th><th>当前状态</th><th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in devices" :key="row.id" :class="{ 'row-serving': row.status === '供电中' }">
          <td>{{ row.code }}</td>
          <td>{{ row.kind }}</td>
          <td>{{ row.kva }}kVA</td>
          <td>
            <span :class="row.cablePassed ? 'pass' : 'fail'">{{ row.cablePassed ? '通过' : '未通过' }}</span>
          </td>
          <td>{{ activeOf(row.id)?.flightNo ?? '—' }}</td>
          <td>
            <template v-if="activeOf(row.id)">
              {{ shiftName(activeOf(row.id)!.ownerShift) }} / {{ activeOf(row.id)!.initiator }}
              <span v-if="activeOf(row.id)!.ownerShift !== store.shift" class="foreign-tag">非本班</span>
            </template>
            <span v-else>—</span>
          </td>
          <td>{{ activeOf(row.id) ? formatDuration(clock - activeOf(row.id)!.startedAt) : '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="store.isDutyOfficer">
              <button class="link" type="button" @click="openStart(row.id)">接机供电</button>
              <button
                class="link"
                type="button"
                :disabled="!canEnd(row)"
                :title="endTitle(row)"
                @click="doEnd(row.id)"
              >
                结束供电
              </button>
              <button
                class="link"
                type="button"
                :disabled="row.status !== '待命'"
                :title="row.status === '供电中' ? '供电中必须先结束，禁止跳级到待检修' : ''"
                @click="doMaintenance(row.id)"
              >
                申请检修
              </button>
              <button v-if="row.status === '待检修'" class="link" type="button" @click="doRepair(row.id)">
                修复完成
              </button>
            </template>
            <span v-else class="readonly-hint">只读</span>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 发起供电对话框：在这里选航班并当场核对功率差值 -->
    <div v-if="startDialog.open" class="modal-mask" @click.self="closeStart">
      <div class="modal">
        <h3>{{ startDialog.device?.code }} 接机供电</h3>
        <p class="modal-sub">
          额定功率 {{ startDialog.device?.kva }}kVA · 电缆检查
          <span :class="startDialog.device?.cablePassed ? 'pass' : 'fail'">
            {{ startDialog.device?.cablePassed ? '通过' : '未通过' }}
          </span>
        </p>
        <label class="duty-field column">
          <span>选择接机航班（含机型与功率需求）</span>
          <select v-model="startDialog.flightNo">
            <option value="" disabled>请选择航班</option>
            <option v-for="flight in flightOptions" :key="flight.no" :value="flight.no">
              {{ flight.no }} · {{ flight.aircraft }} · 需求 {{ flight.demandKva }}kVA · 起飞 {{ flight.etd }}
            </option>
          </select>
        </label>
        <p v-if="selectedFlight" class="power-check" :class="powerShort ? 'error-text' : 'ok'">
          核对：设备 {{ startDialog.device?.kva }}kVA，{{ selectedFlight.aircraft }} 需求 {{ selectedFlight.demandKva }}kVA
          <template v-if="powerShort">
            ，差值 {{ (selectedFlight.demandKva - (startDialog.device?.kva ?? 0)) }}kVA，提交将被拒绝
          </template>
          <template v-else>，功率满足，可发起</template>
        </p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeStart">取消</button>
          <button class="btn primary" type="button" @click="confirmStart">发起供电</button>
        </div>
      </div>
    </div>

    <div class="record-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}（{{ tab.count }}）
      </button>
    </div>

    <!-- 供电记录：查看人员可读，改动入口对其关闭 -->
    <table v-if="activeTab === 'records'" class="data-table sub-table">
      <thead>
        <tr>
          <th>设备</th><th>航班</th><th>机型</th><th>需求功率</th><th>开始</th><th>结束</th>
          <th>发起班次/人</th><th>结束班次/人</th><th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="record in records" :key="record.id">
          <td>{{ record.deviceCode }}</td>
          <td>{{ record.flightNo }}</td>
          <td>{{ record.aircraft }}</td>
          <td>{{ record.demandKva }}kVA</td>
          <td>{{ formatTime(record.startedAt) }}</td>
          <td>{{ formatTime(record.endedAt) }}</td>
          <td>{{ shiftName(record.ownerShift) }} / {{ record.initiator }}</td>
          <td>{{ record.endShift ? `${shiftName(record.endShift)} / ${record.endOperator}` : '—' }}</td>
          <td>{{ record.status }}</td>
        </tr>
        <tr v-if="!records.length"><td colspan="9" class="empty-state">暂无供电记录</td></tr>
      </tbody>
    </table>

    <!-- 资源缺口清单：结束供电必落一条；电源页与资源调度页同读这一份 -->
    <table v-else-if="activeTab === 'gaps'" class="data-table sub-table">
      <thead>
        <tr>
          <th>产生时刻</th><th>原因</th><th>设备</th><th>航班/机型</th>
          <th>需求</th><th>当时可提供</th><th>差值</th><th>状态</th><th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="gap in gaps" :key="gap.id" :class="{ 'gap-open': gap.status === '开放' }">
          <td>{{ formatTime(gap.createdAt) }}</td>
          <td>{{ gap.reason }}</td>
          <td>{{ gap.deviceCode }}</td>
          <td>{{ gap.flightNo }} / {{ gap.aircraft }}</td>
          <td>{{ gap.demandKva }}kVA</td>
          <td>{{ gap.availableKva }}kVA</td>
          <td :class="gap.shortfallKva > 0 ? 'fail' : ''">{{ gap.shortfallKva }}kVA</td>
          <td>{{ gap.status }}{{ gap.status === '已关闭' && gap.closedAt ? `（${formatTime(gap.closedAt)}）` : '' }}</td>
          <td>{{ gap.detail }}</td>
        </tr>
        <tr v-if="!gaps.length"><td colspan="9" class="empty-state">暂无缺口记录</td></tr>
      </tbody>
    </table>

    <!-- 变更记录：谁在什么时候改了什么、被拒原因，全部可追溯 -->
    <table v-else class="data-table sub-table">
      <thead>
        <tr>
          <th>时刻</th><th>操作人</th><th>角色</th><th>班次</th><th>动作</th><th>对象</th><th>结果</th><th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in audits" :key="entry.id" :class="{ denied: !entry.ok }">
          <td>{{ formatTime(entry.at) }}</td>
          <td>{{ entry.operator }}</td>
          <td>{{ entry.role }}</td>
          <td>{{ shiftName(entry.shift) }}</td>
          <td>{{ entry.action }}</td>
          <td>{{ entry.target }}</td>
          <td :class="entry.ok ? 'pass' : 'fail'">{{ entry.ok ? '通过' : '拒绝' }}</td>
          <td>{{ entry.detail }}</td>
        </tr>
        <tr v-if="!audits.length"><td colspan="8" class="empty-state">暂无变更记录</td></tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import { FLIGHTS, SHIFTS } from '@/domain/gpu/catalog'
import {
  activeForDevice,
  cancelRequest,
  endSupply,
  formatDuration,
  formatTime,
  getAudits,
  getAvailability,
  getDevices,
  getGaps,
  getRecords,
  getRequests,
  gpuStateVersion,
  handover,
  repairComplete,
  requestMaintenance,
  startSupply,
} from '@/domain/gpu/service'
import type { GpuDevice, SessionContext, SupplyRecord, SupplyRequest } from '@/domain/gpu/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const devices = ref<GpuDevice[]>([])
const queueRows = ref<SupplyRequest[]>([])
const records = ref<SupplyRecord[]>([])
const gaps = ref(getGaps())
const audits = ref(getAudits())
const clock = ref(Date.now())
const message = ref('')
const messageOk = ref(true)
const activeTab = ref<'records' | 'gaps' | 'audits'>('records')

const startDialog = reactive<{ open: boolean; device: GpuDevice | null; flightNo: string }>({
  open: false,
  device: null,
  flightNo: '',
})

const flightOptions = [...FLIGHTS].sort((a, b) => a.etd.localeCompare(b.etd))

function ctx(): SessionContext {
  return { role: store.role, shift: store.shift, operator: store.operator.trim() || '未署名' }
}

function shiftName(shift: 'day' | 'night'): string {
  return SHIFTS[shift].label
}

function deviceCodeOf(deviceId: number): string {
  return devices.value.find((item) => item.id === deviceId)?.code ?? `#${deviceId}`
}

const availability = computed<ReturnType<typeof getAvailability>>(() => {
  // 依赖版本号：领域落库后自动重算，保证与调度侧同源。
  void gpuStateVersion.value
  return getAvailability()
})

const stats = computed(() => [
  { label: '在册电源车', value: availability.value.total, highlight: false },
  { label: '待命', value: availability.value.standby, highlight: false },
  { label: '供电中', value: availability.value.supplying, highlight: false },
  { label: '调度可用（待命且电缆通过）', value: availability.value.available, highlight: true },
  { label: '待检修', value: availability.value.maintenance, highlight: false },
  { label: '排队待供', value: availability.value.queueLength, highlight: false },
  { label: '开放缺口', value: availability.value.openGaps, highlight: availability.value.openGaps > 0 },
])

const statusSummary = computed(() =>
  (['待命', '供电中', '待检修'] as const).map((status) => ({
    status,
    count: devices.value.filter((row) => row.status === status).length,
  })),
)

const tabs = computed(() => [
  { key: 'records' as const, label: '供电记录', count: records.value.length },
  { key: 'gaps' as const, label: '资源缺口清单', count: gaps.value.length },
  { key: 'audits' as const, label: '变更记录', count: audits.value.length },
])

const selectedFlight = computed(() => FLIGHTS.find((flight) => flight.no === startDialog.flightNo))
const powerShort = computed(() =>
  Boolean(startDialog.device && selectedFlight.value && selectedFlight.value.demandKva > startDialog.device.kva),
)

function activeOf(deviceId: number): SupplyRecord | undefined {
  void gpuStateVersion.value
  return activeForDevice(deviceId)
}

function canEnd(device: GpuDevice): boolean {
  const record = activeForDevice(device.id)
  return device.status === '供电中' && Boolean(record) && record?.ownerShift === store.shift
}

function endTitle(device: GpuDevice): string {
  const record = activeForDevice(device.id)
  if (device.status !== '供电中' || !record) return '该设备当前不在供电中'
  if (record.ownerShift !== store.shift) {
    return `归属${shiftName(record.ownerShift)}，${shiftName(store.shift)}跨班结束会被拒绝，请先交接班`
  }
  return ''
}

function reload(): void {
  devices.value = getDevices()
  queueRows.value = getRequests().filter((item) => item.status === '排队中')
  records.value = getRecords()
  gaps.value = getGaps()
  audits.value = getAudits()
}

function flash(ok: boolean, text: string): void {
  messageOk.value = ok
  message.value = text
}

function openStart(deviceId: number): void {
  if (!store.isDutyOfficer) {
    flash(false, '只有当班值班员能发起接机供电')
    return
  }
  const device = devices.value.find((item) => item.id === deviceId) ?? null
  startDialog.open = true
  startDialog.device = device
  startDialog.flightNo = ''
}

function openStartFor(deviceId: number, flightNo: string): void {
  if (!store.isDutyOfficer) {
    flash(false, '只有当班值班员能发起接机供电')
    return
  }
  const device = devices.value.find((item) => item.id === deviceId) ?? null
  startDialog.open = true
  startDialog.device = device
  startDialog.flightNo = flightNo
}

function closeStart(): void {
  startDialog.open = false
  startDialog.device = null
  startDialog.flightNo = ''
}

function confirmStart(): void {
  if (!startDialog.device || !startDialog.flightNo) {
    flash(false, '请先选择接机航班')
    return
  }
  const result = startSupply(startDialog.device.id, startDialog.flightNo, ctx())
  flash(result.ok, result.message)
  closeStart()
  reload()
}

function doEnd(deviceId: number): void {
  const result = endSupply(deviceId, ctx())
  flash(result.ok, result.message)
  reload()
}

function doMaintenance(deviceId: number): void {
  const result = requestMaintenance(deviceId, ctx())
  flash(result.ok, result.message)
  reload()
}

function doRepair(deviceId: number): void {
  const result = repairComplete(deviceId, ctx())
  flash(result.ok, result.message)
  reload()
}

function doCancel(requestId: number): void {
  const result = cancelRequest(requestId, ctx())
  flash(result.ok, result.message)
  reload()
}

function doHandover(): void {
  const result = handover(ctx())
  if (result.ok) {
    const toShift = store.shift === 'day' ? 'night' : 'day'
    store.setShift(toShift)
    store.setOperator(SHIFTS[toShift].defaultOperator)
  }
  flash(result.ok, result.message)
  reload()
}

function exportRows(): void {
  downloadEntries('gpu')
}

let timer: number | undefined
onMounted(() => {
  reload()
  timer = window.setInterval(() => {
    clock.value = Date.now()
  }, 30000)
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<style scoped>
.gpu-page .duty-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.duty-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.duty-field.column { width: 100%; margin: 8px 0; }
.duty-field select,
.duty-field input {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  min-width: 180px;
}
.duty-hint { color: #b54708; font-size: 12px; }
.stat-card.highlight { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand) inset; }
.action-message { font-size: 13px; margin: 0 0 10px; }
.action-message.ok { color: #067647; }
.queue-panel { margin-bottom: 14px; }
.queue-panel h3 { font-size: 14px; margin: 0 0 6px; }
.queue-head-badge {
  display: inline-block;
  margin-left: 6px;
  background: #ecfdf3;
  color: #067647;
  border-radius: 999px;
  padding: 0 8px;
  font-size: 11px;
}
.row-serving { background: #f5f9ff; }
.pass { color: #067647; }
.fail { color: #b42318; font-weight: 600; }
.foreign-tag {
  margin-left: 6px;
  background: #fffaeb;
  color: #b54708;
  border-radius: 999px;
  padding: 0 8px;
  font-size: 11px;
}
.readonly-hint { color: var(--muted); font-size: 12px; }
.link:disabled { color: #9aa4b2; cursor: not-allowed; }
.link.danger { color: #b42318; }
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  width: 520px;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.modal h3 { margin: 0 0 4px; font-size: 16px; }
.modal-sub { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
.power-check { font-size: 13px; margin: 10px 0; }
.power-check.ok { color: #067647; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.record-tabs { display: flex; gap: 8px; margin: 16px 0 8px; }
.tab-btn {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px 6px 0 0;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.tab-btn.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.sub-table { border-radius: 0 0 8px 8px; }
.gap-open { background: #fffaeb; }
.audits tr.denied td { color: #b42318; }
</style>
