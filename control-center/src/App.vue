<template>
  <n-config-provider :theme="theme" :locale="zhCN" :date-locale="dateZhCN">
    <div class="app-container">
      <!-- 顶部标题栏 -->
      <n-page-header class="app-header">
        <template #title>
          <n-text strong style="font-size: 20px; color: var(--accent-blue)">
            🎵 AnimoNote
          </n-text>
          <n-text depth="3" style="font-size: 14px; margin-left: 8px">
            Control Center
          </n-text>
        </template>
        <template #extra>
          <n-space align="center">
            <!-- MIDI 设备选择 -->
            <n-text depth="3" style="font-size: 12px">MIDI 设备:</n-text>
            <n-select
              v-model:value="selectedMidiDevice"
              :options="midiDeviceOptions"
              size="small"
              placeholder="选择设备..."
              style="width: 180px"
              clearable
            />
            <n-button size="small" @click="handleDetectMidi">
              <template #icon><n-icon><ReloadIcon /></n-icon></template>
              刷新设备
            </n-button>

            <n-divider vertical />

            <n-button type="primary" size="small" @click="handleStartAll">
              ▶ 全部启动
            </n-button>
            <n-button type="error" size="small" @click="handleStopAll">
              ■ 全部停止
            </n-button>
          </n-space>
        </template>
      </n-page-header>

      <div class="main-content">
        <!-- 左侧：角色列表 -->
        <aside class="sidebar">
          <n-card title="🎭 角色" size="small" :bordered="true" class="sidebar-card">
            <template #header-extra>
              <n-button size="tiny" circle @click="showNewModelModal = true">
                <template #icon><n-icon><AddIcon /></n-icon></template>
              </n-button>
            </template>
            <ModelList />
          </n-card>
        </aside>

        <!-- 右侧：主内容区 -->
        <main class="content">
          <n-card size="small" :bordered="true" class="content-card">
            <template #header>
              <n-tabs v-model:value="activeTab" type="line" size="small">
                <n-tab name="instances">📋 实例</n-tab>
                <n-tab name="config">⚙️ 角色配置</n-tab>
                <n-tab name="mapping">🎼 映射</n-tab>
              </n-tabs>
            </template>

            <!-- 实例管理 -->
            <div v-show="activeTab === 'instances'" class="tab-pane">
              <InstanceTable />
            </div>

            <!-- 角色配置 -->
            <div v-show="activeTab === 'config'" class="tab-pane">
              <ConfigEditor />
            </div>

            <!-- 映射编辑器 -->
            <div v-show="activeTab === 'mapping'" class="tab-pane">
              <MappingEditor />
            </div>
          </n-card>

          <!-- 日志面板 -->
          <n-card title="📝 日志" size="small" :bordered="true" class="log-card">
            <LogPanel />
          </n-card>
        </main>
      </div>

      <!-- 新建角色对话框 -->
      <n-modal v-model:show="showNewModelModal" preset="card" title="➕ 新建角色" style="width: 450px">
        <n-form>
          <n-form-item label="角色 ID（目录名，英文）" required>
            <n-input v-model:value="newModelId" placeholder="例如: miku" />
          </n-form-item>
          <n-form-item label="显示名称">
            <n-input v-model:value="newModelName" placeholder="例如: 初音未来" />
          </n-form-item>
        </n-form>
        <template #footer>
          <n-space justify="end">
            <n-button @click="showNewModelModal = false">取消</n-button>
            <n-button type="primary" @click="handleCreateModel">创建</n-button>
          </n-space>
        </template>
      </n-modal>
    </div>
  </n-config-provider>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { darkTheme, zhCN, dateZhCN } from 'naive-ui'
import { Reload as ReloadIcon, Add as AddIcon } from '@vicons/ionicons5'
import {
  scanModels,
  startAll,
  stopAll,
  createModel,
  detectMidiDevices,
  initIpcListeners,
  runningInstances,
  availableModels,
  midiDeviceList,
  message,
  dialog,
} from './composables/useBridge.js'
import ModelList from './components/ModelList.vue'
import InstanceTable from './components/InstanceTable.vue'
import ConfigEditor from './components/ConfigEditor.vue'
import MappingEditor from './components/MappingEditor.vue'
import LogPanel from './components/LogPanel.vue'

const theme = ref(darkTheme)
const activeTab = ref('instances')
const showNewModelModal = ref(false)
const newModelId = ref('')
const newModelName = ref('')
const selectedMidiDevice = ref(null)

const midiDeviceOptions = computed(() => {
  return [
    { label: '— 所有设备 —', value: null },
    ...midiDeviceList.value.map(d => ({ label: d.name, value: d.name }))
  ]
})

async function handleDetectMidi() {
  await detectMidiDevices()
  message.success('MIDI 设备列表已更新')
}

async function handleScan() {
  await scanModels()
  message.success('扫描完成')
}

async function handleStartAll() {
  await startAll()
  message.success('已启动全部角色')
}

async function handleStopAll() {
  dialog.warning({
    title: '确认',
    content: '确定要停止所有角色窗口吗？',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      await stopAll()
      message.success('已停止全部角色')
    }
  })
}

async function handleCreateModel() {
  if (!newModelId.value.trim()) {
    message.error('请输入角色 ID')
    return
  }
  const result = await createModel(newModelId.value.trim(), newModelName.value.trim())
  if (result.success) {
    message.success(`角色 ${newModelId.value} 已创建`)
    showNewModelModal.value = false
    newModelId.value = ''
    newModelName.value = ''
  } else {
    message.error(`创建失败: ${result.error}`)
  }
}

// 定期同步角色窗口状态
let syncInterval = null

onMounted(async () => {
  initIpcListeners()
  await scanModels()
  await detectMidiDevices()

  syncInterval = setInterval(async () => {
    try {
      const api = window.electronAPI
      if (api?.getCharacters) {
        const list = await api.getCharacters()
        const activeIds = new Set(list.map(i => i.instanceId))
        const instances = runningInstances.value
        let changed = false
        for (const [id] of instances) {
          if (!activeIds.has(id)) {
            instances.delete(id)
            changed = true
          }
        }
        if (changed) runningInstances.value = new Map(instances)
      }
    } catch (e) { /* ignore */ }
  }, 2000)
})

onBeforeUnmount(() => {
  if (syncInterval) clearInterval(syncInterval)
})
</script>

<style>
/* 全局样式覆盖 */
:root {
  --accent-blue: #4fc3f7;
  --accent-green: #66bb6a;
  --accent-red: #ef5350;
  --accent-yellow: #ffca28;
  --accent-purple: #ab47bc;
  --border-color: #2a2a4a;
  --text-secondary: #a0a0b0;
  --font-mono: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1a1a2e;
}

.app-header {
  padding: 12px 20px;
  background: #16213e;
  border-bottom: 1px solid var(--border-color);
  -webkit-app-region: drag;
}

.app-header .n-page-header__extra {
  -webkit-app-region: no-drag;
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 25%;
  max-width: 320px;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: #16213e;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  min-height: 0;
}

@media (max-width: 768px) {
  .sidebar {
    width: 200px;
    min-width: 200px;
  }
}

.sidebar-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.sidebar-card .n-card__content {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
  min-height: 0;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
}

.content-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.content-card .n-card__content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  min-height: 0;
}

.tab-pane {
  flex: 1;
  overflow: hidden;
  padding: 12px;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.log-card {
  height: 160px;
  min-height: 160px;
  display: flex;
  flex-direction: column;
}

.log-card .n-card__content {
  flex: 1;
  overflow: hidden;
  padding: 0;
}

/* 滚动条 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
