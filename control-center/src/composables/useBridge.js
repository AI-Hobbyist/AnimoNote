/**
 * Electron IPC 通信桥接
 *
 * 封装 window.electronAPI 调用，提供响应式状态管理。
 */
import { ref, reactive, shallowRef } from 'vue'
import { createDiscreteApi } from 'naive-ui'

// ============================================================
// 离散 API
// ============================================================

const { message, dialog, notification } = createDiscreteApi(
  ['message', 'dialog', 'notification'],
  { configProviderProps: { theme: undefined } }
)

export { message, dialog, notification }

// ============================================================
// 全局状态
// ============================================================

export const availableModels = ref([])
export const summonedCharacters = ref(new Map()) // instanceId -> { midiChannel, fps, currentNote, currentAction, isFallback }
export const selectedModelId = ref(null)
export const currentMappings = ref({})
export const currentVmdFiles = ref([])
export const hasUnsavedMapping = ref(false)
export const currentConfig = ref(null)
export const currentPmxFiles = ref([])
export const hasUnsavedConfig = ref(false)
export const logEntries = ref([])
export const midiDeviceList = ref([])
export const screenList = ref([])
export const selectedDisplayId = ref(null)
export const rehearsalMode = ref(false)

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

  try {
    const md = await api().readMapping({ modelDir: model.modelDir })
    currentMappings.value = md.note_mappings || {}
    currentVmdFiles.value = await api().scanVmdFiles({ modelDir: model.modelDir })
  } catch (e) {
    currentMappings.value = {}
    currentVmdFiles.value = []
  }
  hasUnsavedMapping.value = false

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

  const clean = {}
  for (const [n, m] of Object.entries(currentMappings.value)) {
    if (m.vmd_path) clean[n] = m
  }
  currentMappings.value = clean

  const r = await api().saveMapping({ modelDir: model.modelDir, noteMappings: clean })
  if (r.success) {
    hasUnsavedMapping.value = false
    model.noteCount = Object.keys(clean).length
    addLog('info', `✅ 映射已保存 (${Object.keys(clean).length} 个)`)
  } else {
    addLog('error', `保存失败: ${r.error || ''}`)
  }
}

/**
 * 保存配置
 */
export async function saveConfig() {
  if (!selectedModelId.value || !currentConfig.value) return
  const model = availableModels.value.find(m => m.id === selectedModelId.value)
  if (!model) return

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

  const result = await api().saveConfig({ modelDir: model.modelDir, config: configToSave })
  if (result.success) {
    hasUnsavedConfig.value = false
    addLog('info', '✅ 配置已保存到 /config.json')
    await scanModels()
  } else {
    addLog('error', `保存失败: ${result.error || ''}`)
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
    addLog('error', `删除失败: ${result.error || ''}`)
    message.error(`删除失败: ${result.error || ''}`)
  }
}

/**
 * 召唤角色（替代 startCharacter）
 */
export async function summonCharacter(id, dir, ch) {
  let decodedDir = dir
  try {
    const testDecoded = decodeURIComponent(dir)
    if (testDecoded !== dir) decodedDir = testDecoded
  } catch (e) { /* ignore */ }

  addLog('info', `召唤角色: ${id} (CH ${ch})`)
  const r = await api().summonCharacter({
    instanceId: id,
    modelDir: decodedDir,
    midiChannel: ch,
    displayId: selectedDisplayId.value
  })
  if (r.success) {
    const instances = summonedCharacters.value
    instances.set(id, {
      midiChannel: ch,
      currentNote: null,
      currentAction: null,
      isFallback: false,
      fps: '--',
    })
    summonedCharacters.value = new Map(instances)
    addLog('info', `${id} 已召唤至场景`)
  } else {
    addLog('error', `召唤失败: ${r.error || ''}`)
  }
}

/**
 * 召回角色（替代 stopCharacter）
 */
export async function recallCharacter(id) {
  addLog('info', `召回角色: ${id}`)
  await api().recallCharacter({ instanceId: id })
  const instances = summonedCharacters.value
  instances.delete(id)
  summonedCharacters.value = new Map(instances)
}

/**
 * 召唤全部
 */
export async function startAll() {
  for (const m of availableModels.value) {
    if (!summonedCharacters.value.has(m.id)) {
      await summonCharacter(m.id, m.modelDir, m.midiChannel)
    }
  }
}

/**
 * 召回全部
 */
export async function stopAll() {
  for (const [id] of summonedCharacters.value) {
    await recallCharacter(id)
  }
}

/**
 * 创建新角色
 */
export async function createModel(modelId, displayName) {
  const result = await api().createModel({ modelId, displayName: displayName || modelId })
  if (result.success) {
    addLog('info', `角色 ${modelId} 已创建`)
    await scanModels()
    await selectModel(modelId)
  } else {
    addLog('error', `创建失败: ${result.error || ''}`)
  }
  return result
}

/**
 * 保存指定角色的配置
 */
export async function saveModelConfig(modelDir, config) {
  const result = await api().saveConfig({ modelDir, config })
  if (result.success) {
    addLog('info', '✅ 配置已自动保存')
  }
  return result
}

/**
 * 实时更新运行中角色的参数
 */
export function updateCharacterConfig(instanceId, config) {
  api().updateCharacterConfig({ instanceId, config })
}

// ============================================================
// 排练模式
// ============================================================

/**
 * 进入排练模式
 */
export async function enterRehearsal() {
  if (summonedCharacters.value.size === 0) {
    message.warning('请先召唤至少一个角色')
    return
  }
  const r = await api().enterRehearsal()
  if (r.success) {
    rehearsalMode.value = true
    addLog('info', '🎭 进入排练模式')
  } else {
    addLog('error', `进入排练模式失败: ${r.error || ''}`)
  }
}

/**
 * 退出排练模式
 */
export async function exitRehearsal() {
  const r = await api().exitRehearsal()
  if (r.success) {
    rehearsalMode.value = false
    addLog('info', '🎭 退出排练模式，位置已保存')
  } else {
    addLog('error', `退出排练模式失败: ${r.error || ''}`)
  }
}

/**
 * 切换排练模式
 */
export async function toggleRehearsal() {
  if (rehearsalMode.value) {
    await exitRehearsal()
  } else {
    await enterRehearsal()
  }
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

    // 恢复保存的 MIDI 设备
    const settings = await api().readSettings()
    if (settings.midi && settings.midi.deviceName) {
      // 这里的逻辑可以由组件自己处理，或者在这里设置全局状态
    }

    return devices
  } catch (e) {
    return []
  }
}

/**
 * 获取屏幕列表
 */
export async function detectScreens() {
  try {
    const screens = await api().getScreens()
    screenList.value = screens
    
    // 加载保存的显示器设置
    const settings = await api().readSettings()
    if (settings.displayId && screens.find(s => s.id === settings.displayId)) {
      selectedDisplayId.value = settings.displayId
    } else if (selectedDisplayId.value === null && screens.length > 0) {
      const primary = screens.find(s => s.isPrimary)
      selectedDisplayId.value = primary ? primary.id : screens[0].id
    }
    return screens
  } catch (e) {
    return []
  }
}

/**
 * 保存全局设置
 */
export async function saveGlobalSettings(settings) {
  try {
    await api().saveSettings(settings)
  } catch (e) {
    console.error('Failed to save settings:', e)
  }
}

/**
 * 初始化 IPC 监听
 */
export function initIpcListeners() {
  // 角色状态更新（来自场景窗口）
  api().onCharacterStatus((data) => {
    // 处理排练状态回传
    if (data.instanceId === '__rehearsal__' && data.rehearsalActive === false) {
      rehearsalMode.value = false
      return
    }

    const instances = summonedCharacters.value
    const inst = instances.get(data.instanceId)
    if (inst) {
      inst.currentNote = data.currentNote || null
      inst.currentAction = data.currentAction || null
      inst.isFallback = data.isFallback || false
      inst.fps = data.fps || '--'
      summonedCharacters.value = new Map(instances)
    }
  })

  // 场景窗口关闭通知
  api().onCharacterClosed((data) => {
    if (data.instanceId === '__scene__') {
      // 整个场景窗口关闭，清除所有角色
      summonedCharacters.value = new Map()
      rehearsalMode.value = false
      addLog('info', '场景窗口已关闭')
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