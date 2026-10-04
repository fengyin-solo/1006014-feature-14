<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">机场地面保障作业管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向航班保障、机位分配、廊桥靠接、摆渡车调度、行李装卸、航油加注、除冰作业与延误处置的一体化机场地面保障作业工作台。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.role }} · {{ store.team }} · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const navItems = [{ label: "运营概览", path: "/" }, { label: "航班保障", path: "/flight" }, { label: "机位分配", path: "/stand" }, { label: "廊桥靠接", path: "/bridge" }, { label: "摆渡车调度", path: "/shuttle" }, { label: "行李装卸", path: "/baggage" }, { label: "机务勤务", path: "/line" }, { label: "航油加注", path: "/fueling" }, { label: "除冰作业", path: "/deice" }, { label: "地面电源", path: "/gpu" }, { label: "航空器牵引", path: "/tow" }, { label: "航空配餐", path: "/catering" }, { label: "客舱清洁", path: "/cabin" }, { label: "保障班组", path: "/team" }, { label: "特种车辆维保", path: "/vehmaint" }, { label: "要客保障", path: "/vip" }, { label: "延误处置", path: "/delay" }, { label: "机坪安全巡查", path: "/apron" }, { label: "保障资源调度", path: "/resplan" }]
</script>
