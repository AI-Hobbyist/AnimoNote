/**
 * AnimoNote Control Center - Vue 3 应用入口
 * 
 * 使用 Naive UI 组件库重构的控制台界面
 */
import { createApp } from 'vue'
import naive from 'naive-ui'
import App from './App.vue'

const app = createApp(App)
app.use(naive)
app.mount('#app')
