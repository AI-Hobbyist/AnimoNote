/**
 * Electron IPC 通信桥接
 *
 * 封装 window.electronAPI 调用，提供响应式状态管理
 */
import { ref, reactive, shallowRef } from 'vue'
import { createDiscreteApi } from 'naive-ui'

// ============================================================
// 离散 API（替代 useMessage/useDialog，无需 Provider 包裹）
// ============================================================

/**
 * 使用 createDiscreteApi 创建 message、dialog、notification 实例。
 * 这样在组件中无需 n-message-provider / n-dialog-provider 包裹即可使用。
 * 参考: https://www.naiveui.com/zh-CN/os-theme/components/discrete
 */
const { message, dialog, notification } = createDiscreteApi(
  ['message', 'dialog', 'notification'],
  {
    configProviderProps: {
      theme: undefined, // 由 App.vue 的 n-config-provider 控制
    }
  }
)

export { message, dialog, notification }

// ============================================================
// 类型定义（JSDoc）
// ============================================================

/**
 * @typedef {Object} ModelInfo
 * @property {string} id
 * @property {string} displayName
 * @property {string} configPath
 * @property {string} mappingPath
 * @property {string} modelDir
 * @property {number} midiChannel
 * @property {string} midiDevice
 * @property {boolean} hasModel
 * @property {number} noteCount
 */

/**
 * @typedef {Object} RunningInstance
 * @property {string|number} pid
 * @property {number} midiChannel
 * @property {string|null} currentNote
 * @property {string|null} currentAction
 * @property {boolean} isFallback
 * @property {string} [fps]
 */

// ============================================================
// 全局状态
// ============================================================

/** @type {import('vue').Ref<ModelInfo[]>} */
export const availableModels = ref([])

/** @type {import('vue').Ref<Map<string, RunningInstance>>} */
export const runningInstances = ref(new Map())

/** @type {import('vue').Ref<string|null>} */
export const selectedModelId = ref(null)

/** @type {import('vue').Ref<Object>} */
export const currentMappings = ref({})

/** @type {import('vue').Ref<Array>} */
export const currentVmdFiles = ref([])

/** @type {import('vue').Ref<boolean>} */
export const hasUnsavedMapping = ref(false)

/** @type {import('vue').Ref<Object|null>} */
export const currentConfig = ref(null)

/** @type {import('vue').Ref<Array>} */
export const currentPmxFiles = ref([])

/** @type {import('vue').Ref<boolean>} */
export const hasUnsavedConfig = ref(false)

/** @type {import('vue').Ref<Array>} */
export const logEntries = ref([])

/** @type {import('vue').Ref<Array>} */
export const midiDeviceList = ref([])

// ============================================================
// API 代理
// ============================================================

const api = () => window.electronAPI

/**
 * 添加日志
 */
export function addLog(type, message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logEntries.value.push({ type, message, time })
  if (logEntries.value.length > 200) logEntries.value.shift()
}

/**
 * 扫描模型目录
 */
export async function scanModels() {
  addLog('info', '扫描 models/ 目录...')
  try {
    availableModels.value = await api().scanModels()
    addLog('info', `发现 ${availableModels.value.length} 个角色`)
    return availableModels.value
  } catch (err) {
    addLog('error', `扫描失败: ${err.message}`)
    return []
  }
}

/**
 * 选择模型
 */
export async function selectModel(modelId) {
  selectedModelId.value = modelId
  const model = availableModels.value.find(m => m.id === modelId)
  if (!model) return

  // 加载映射
  try {
    const md = await api().readMapping({ modelDir: model.modelDir })
    currentMappings.value = md.note_mappings || {}
    currentVmdFiles.value = await api().scanVmdFiles({ modelDir: model.modelDir })
  } catch (e) {
    currentMappings.value = {}
    currentVmdFiles.value = []
  }
  hasUnsavedMapping.value = false

  // 加载配置
  try {
    currentConfig.value = await api().readConfig({ modelDir: model.modelDir })
    currentPmxFiles.value = await api().scanPmxFiles({ modelDir: model.modelDir })
  } catch (e) {
    currentConfig.value = null
    currentPmxFiles.value = []
  }
  hasUnsavedConfig.value = false
}

/**
 * 保存映射
 */
export async function saveMapping() {
  if (!selectedModelId.value) { addLog('error', '请先选择角色'); return }
  const model = availableModels.value.find(m => m.id === selectedModelId.value)
  if (!model) return

  // 清理空映射
  const clean = {}
  for (const [n, m] of Object.entries(currentMappings.value)) {
    if (m.vmd_path) clean[n] = m
  }
  currentMappings.value = clean

  const r = await api().saveMapping({ modelDir: model.modelDir, noteMappings: clean })
  if (r.success) {
    hasUnsavedMapping.value = false
    model.noteCount = Object.keys(clean).length
    addLog('info', `✅ 映射已保存 (${model.noteCount} 个)`)
  } else {
    addLog('error', `保存失败: ${r.error}`)
  }
}

/**
 * 保存配置
 */
export async function saveConfig() {
  if (!selectedModelId.value || !currentConfig.value) return
  const model = availableModels.value.find(m => m.id === selectedModelId.value)
  if (!model) return

  // 深度克隆并移除已废弃字段
  const configToSave = JSON.parse(JSON.stringify(currentConfig.value))
  delete configToSave.idle
  if (configToSave.model) {
    delete configToSave.model.scale
    delete configToSave.model.position
  }
  if (configToSave.midi) {
    delete configToSave.midi.device_name
    delete configToSave.midi.mode
  }

  const result = await api().saveConfig({
    modelDir: model.modelDir,
    config: configToSave,
  })

  if (result.success) {
    hasUnsavedConfig.value = false
    addLog('info', `✅ 配置已保存到 ${model.id}/config.json`)
    await scanModels()
  } else {
    addLog('error', `保存失败: ${result.error}`)
  }
}

/**
 * 删除角色
 */
export async function deleteModel(modelId) {
  const model = availableModels.value.find(m => m.id === modelId)
  if (!model) return

  const result = await api().deleteModel({ modelId, modelDir: model.modelDir })
  if (result.success) {
    addLog('info', `🗑️ 角色 ${modelId} 已物理删除`)
    if (selectedModelId.value === modelId) {
      selectedModelId.value = null
      currentConfig.value = null
      currentMappings.value = {}
    }
    await scanModels()
  } else {
    addLog('error', `删除失败: ${result.error}`)
    message.error(`删除失败: ${result.error}`)
  }
}

/**
 * 启动角色窗口
 */
export async function startCharacter(id, dir, ch) {
  let decodedDir = dir
  try {
    const testDecoded = decodeURIComponent(dir)
    if (testDecoded !== dir) decodedDir = testDecoded
  } catch (e) { /* ignore */ }

  addLog('info', `打开角色窗口: ${id} (CH ${String(ch).padStart(2, '0')})`)
  const r = await api().startCharacter({ instanceId: id, modelDir: decodedDir, midiChannel: ch })
  if (r.success) {
    const instances = runningInstances.value
    instances.set(id, {
      midiChannel: ch,
      currentNote: null,
      currentAction: null,
      isFallback: false,
    })
    runningInstances.value = new Map(instances)
    addLog('info', `${id} 窗口已打开`)
  } else {
    addLog('error', `打开失败: ${r.error}`)
  }
}

/**
 * 停止角色窗口
 */
export async function stopCharacter(id) {
  addLog('info', `关闭角色窗口: ${id}`)
  await api().stopCharacter({ instanceId: id })
  const instances = runningInstances.value
  instances.delete(id)
  runningInstances.value = new Map(instances)
}

/**
 * 启动全部
 */
export async function startAll() {
  for (const m of availableModels.value) {
    if (!runningInstances.value.has(m.id)) {
      await startCharacter(m.id, m.modelDir, m.midiChannel)
    }
  }
}

/**
 * 停止全部
 */
export async function stopAll() {
  for (const [id] of runningInstances.value) {
    await stopCharacter(id)
  }
}

/**
 * 创建新模型
 */
export async function createModel(modelId, displayName) {
  const result = await api().createModel({ modelId, displayName: displayName || modelId })
  if (result.success) {
    addLog('info', `角色 ${modelId} 已创建`)
    await scanModels()
    await selectModel(modelId)
  } else {
    addLog('error', `创建失败: ${result.error}`)
  }
  return result
}

/**
 * 保存指定角色的配置
 */
export async function saveModelConfig(modelDir, config) {
  const result = await api().saveConfig({ modelDir, config })
  if (result.success) {
    addLog('info', `✅ 配置已自动保存`)
  }
  return result
}

/**
 * 实时更新运行中角色的参数
 */
export function updateCharacterConfig(instanceId, config) {
  api().updateCharacterConfig({ instanceId, config })
}

/**
 * 检测 MIDI 设备
 */
export async function detectMidiDevices() {
  try {
    const access = await navigator.requestMIDIAccess()
    const devices = []
    for (const input of access.inputs.values()) {
      devices.push({
        id: input.id,
        name: input.name || `MIDI ${input.id}`,
        manufacturer: input.manufacturer || 'Unknown',
      })
    }
    midiDeviceList.value = devices
    return devices
  } catch (e) {
    return []
  }
}

/**
 * 初始化 IPC 监听
 */
export function initIpcListeners() {
  // 角色窗口关闭通知
  api().onCharacterClosed((data) => {
    const instances = runningInstances.value
    instances.delete(data.instanceId)
    runningInstances.value = new Map(instances)
    addLog('info', `角色窗口已关闭: ${data.instanceId}`)
  })

  // 角色窗口状态更新
  api().onCharacterStatus((data) => {
    const instances = runningInstances.value
    const inst = instances.get(data.instanceId)
    if (inst) {
      inst.currentNote = data.currentNote || null
      inst.currentAction = data.currentAction || null
      inst.isFallback = data.isFallback || false
      inst.fps = data.fps || '--'
      
      // 更新 FPS 历史记录
      if (!inst.fpsHistory) inst.fpsHistory = []
      const fpsVal = parseInt(data.fps) || 0
      inst.fpsHistory.push(fpsVal)
      if (inst.fpsHistory.length > 30) inst.fpsHistory.shift()

      runningInstances.value = new Map(instances)
    }
  })
}

/**
 * 获取选中模型的详情
 */
export function getSelectedModel() {
  if (!selectedModelId.value) return null
  return availableModels.value.find(m => m.id === selectedModelId.value) || null
}
