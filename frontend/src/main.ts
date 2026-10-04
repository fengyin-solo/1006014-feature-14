import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { getAvailability } from './domain/gpu/service'
import './styles/global.css'

// 先把电源领域的设备台账同步进通用条目表，概览页读到的数字才与电源页同源。
getAvailability()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
