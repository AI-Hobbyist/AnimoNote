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

            <n-text depth="3" style="font-size: 12px">显示屏幕:</n-text>
            <n-select
              v-model:value="selectedDisplayId"
              :options="screenOptions"
              size="small"
              placeholder="选择屏幕..."
              style="width: 200px"
            />
          <!-- 段码风格 FPS / BPM 屏幕 -->
          <div class="segment-display-group">
            <div class="segment-box">
              <div class="segment-label">FPS</div>
              <div class="segment-value" :style="{ color: globalFps >= 30 ? '#66bb6a' : '#ffca28' }">
                {{ String(globalFps).padStart(3, ' ') }}
              </div>
            </div>
            <div class="segment-box">
              <div class="segment-label">BPM</div>
              <div class="segment-value" style="color: #4fc3f7">
                {{ String(globalBpm).padStart(3, ' ') }}
              </div>
            </div>
          </div>
          </n-space>
        </template>
      </n-page-header>

      <div class="main-content">
        <!-- 左侧：角色列表 -->
        <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
          <div class="sidebar-toggle" @click="sidebarCollapsed = !sidebarCollapsed" title="切换侧栏">
            <span class="sidebar-toggle-icon">{{ sidebarCollapsed ? '▶' : '◀' }}</span>
          </div>
          <n-card title="🎭 角色" size="small" :bordered="true" class="sidebar-card" v-show="!sidebarCollapsed">
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
                <n-tab name="camera">🎥 摄像机</n-tab>
                <n-tab name="mmd">🎬 MMD观赏</n-tab>
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

            <!-- 摄像机配置 -->
            <div v-show="activeTab === 'camera'" class="tab-pane">
              <CameraConfigEditor />
            </div>

            <!-- MMD 观赏模式 -->
            <div v-show="activeTab === 'mmd'" class="tab-pane">
              <MmdViewer />
            </div>
          </n-card>

          <!-- 日志面板 -->
          <n-card size="small" :bordered="true" class="log-card" :class="{ collapsed: logCollapsed }">
            <template #header>
              <div class="log-header" @click="logCollapsed = !logCollapsed" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; user-select: none">
                <n-text strong style="font-size: 13px">📝 日志</n-text>
                <n-text depth="3" style="font-size: 11px">{{ logCollapsed ? '▶ 展开' : '▼ 收起' }}</n-text>
              </div>
            </template>
            <div v-show="!logCollapsed" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
              <LogPanel />
            </div>
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
import { darkTheme, zhCN, dateZhCN, NDivider } from 'naive-ui'
import { Reload as ReloadIcon, Add as AddIcon } from '@vicons/ionicons5'
import {
  scanModels,
  startAll,
  stopAll,
  createModel,
  detectMidiDevices,
  detectScreens,
  saveGlobalSettings,
  initIpcListeners,
  summonedCharacters,
  availableModels,
  globalBpm,
  globalFps,
  midiDeviceList,
  screenList,
  selectedDisplayId,
  message,
  dialog,
} from './composables/useBridge.js'
import { watch } from 'vue'
import ModelList from './components/ModelList.vue'
import InstanceTable from './components/InstanceTable.vue'
import ConfigEditor from './components/ConfigEditor.vue'
import MappingEditor from './components/MappingEditor.vue'
import CameraConfigEditor from './components/CameraConfigEditor.vue'
import MmdViewer from './components/MmdViewer.vue'
import LogPanel from './components/LogPanel.vue'

const theme = ref(darkTheme)
const activeTab = ref('instances')
const showNewModelModal = ref(false)
const logCollapsed = ref(false)
const sidebarCollapsed = ref(false)
const newModelId = ref('')
const newModelName = ref('')
const selectedMidiDevice = ref(null)

// 监听并保存设置
watch(selectedMidiDevice, (val) => {
  saveGlobalSettings({ midi: { deviceName: val || '' } })
})

watch(selectedDisplayId, (val) => {
  saveGlobalSettings({ displayId: val })
})

const midiDeviceOptions = computed(() => {
  return [
    { label: '— 所有设备 —', value: null },
    ...midiDeviceList.value.map(d => ({ label: d.name, value: d.name }))
  ]
})

const screenOptions = computed(() => {
  return screenList.value.map(s => ({
    label: s.label + (s.isPrimary ? ' (主屏)' : ''),
    value: s.id
  }))
})

async function handleDetectMidi() {
  await detectMidiDevices()
  message.success('MIDI 设备列表已更新')
}

async function handleScan() {
  await scanModels()
  message.success('扫描完成')
}

async function handleSummonAll() {
  await startAll()
  message.success('已启动全部角色')
}

async function handleRecallAll() {
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
  await detectScreens()

  // 加载初始设置
  const settings = await window.electronAPI.readSettings()
  if (settings.midi && settings.midi.deviceName) {
    selectedMidiDevice.value = settings.midi.deviceName
  }

  syncInterval = setInterval(async () => {
    try {
      const api = window.electronAPI
      if (api?.getSummonedCharacters) {
        const list = await api.getSummonedCharacters()
        const activeIds = new Set(list.map(i => i.instanceId))
        const instances = summonedCharacters.value
        let changed = false
        for (const [id] of instances) {
          if (!activeIds.has(id)) {
            instances.delete(id)
            changed = true
          }
        }
        if (changed) summonedCharacters.value = new Map(instances)
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
  padding: 12px 12px 12px 4px;
  background: #16213e;
  border-right: 1px solid var(--border-color);
  overflow: hidden;
  min-height: 0;
  transition: min-width 0.2s ease, padding 0.2s ease;
  position: relative;
}

.sidebar.collapsed {
  min-width: 24px;
  width: 24px;
  padding: 12px 2px;
}

.sidebar-toggle {
  position: absolute;
  top: 12px;
  right: 4px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 3px;
  background: rgba(255,255,255,0.05);
  transition: background 0.15s;
  z-index: 10;
}

.sidebar.collapsed .sidebar-toggle {
  right: 2px;
}

.sidebar-toggle:hover {
  background: rgba(255,255,255,0.12);
}

.sidebar-toggle-icon {
  font-size: 10px;
  color: rgba(255,255,255,0.4);
  transition: color 0.15s;
}

.sidebar-toggle:hover .sidebar-toggle-icon {
  color: #4fc3f7;
}

@media (max-width: 768px) {
  .sidebar {
    width: 200px;
    min-width: 200px;
  }
  .sidebar.collapsed {
    min-width: 24px;
    width: 24px;
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
  max-height: 100%;
}

.content-card .n-card__content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  min-height: 0;
  max-height: 100%;
}

.tab-pane {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  min-height: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
}

.log-card {
  flex: 0 0 160px;
  min-height: 160px;
  display: flex;
  flex-direction: column;
  transition: flex 0.2s ease, min-height 0.2s ease;
  overflow: hidden;
}

.log-card.collapsed {
  flex: 0 0 auto;
  min-height: 0;
}

.log-card .n-card__content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  min-height: 0;
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

/* ============================================================
   段码风格 FPS / BPM 屏幕
   ============================================================ */
.segment-display-group {
  display: flex;
  gap: 8px;
  margin-right: 16px;
}

.segment-box {
  background: #0d0d1a;
  border: 1px solid #2a2a4a;
  border-radius: 4px;
  padding: 4px 10px;
  text-align: center;
  min-width: 72px;
}

.segment-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 2px;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  margin-bottom: 2px;
}

.segment-value {
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
  text-shadow: 0 0 8px currentColor;
  letter-spacing: 2px;
}
</style>
