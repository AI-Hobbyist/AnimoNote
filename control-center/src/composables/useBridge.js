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
export const globalBpm = ref(120)
export const globalFps = ref(0)
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
// MMD 观赏模式状态
// ============================================================

export const viewingModeEnabled = ref(false)
export const viewingModePlaylists = ref({ entries: [] })   // { entries: [{ name, vmdPath, audioPath, assignTo: 'global'|'characterId' }] }
export const viewingModePlayMode = ref('list-loop') // 'random' | 'single-loop' | 'list-loop'
export const viewingModeCurrentEntry = ref(null)   // { entryIndex, name, characterId, vmdName, audioName, progress }
export const viewingModeProgress = ref({ current: 0, duration: 0 }) // 进度信息

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
  if (!model) {
    addLog('error', `角色 ${selectedModelId.value} 未找到`)
    return
  }

  // 构建保存数据：保留所有条目，补充默认值
  const clean = {}
  for (const [n, m] of Object.entries(currentMappings.value)) {
    clean[n] = { ...m }
    if (!clean[n].play_mode) clean[n].play_mode = 'once'
    if (!clean[n].fade_mode) clean[n].fade_mode = 'fixed'
    if (clean[n].fade_mode === 'fixed') {
      if (clean[n].fade_in === undefined) clean[n].fade_in = clean[n].fade_duration ?? 0.1
      if (clean[n].fade_out === undefined) clean[n].fade_out = clean[n].fade_duration ?? 0.1
    }
  }

  addLog('info', `保存中... (${Object.keys(clean).length} 个映射)`)

  const r = await api().saveMapping({ modelDir: model.modelDir, noteMappings: clean })
  if (r.success) {
    currentMappings.value = clean
    hasUnsavedMapping.value = false
    model.noteCount = Object.keys(clean).length
    addLog('info', `✅ 映射已保存 (${Object.keys(clean).length} 个)`)

    // 通知场景窗口更新映射
    const inst = summonedCharacters.value.get(model.id)
    if (inst) {
      api().updateMappings({ instanceId: model.id, midiChannel: inst.midiChannel, noteMappings: clean })
    }
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
      beats: 0,
      noteType: null,
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
  // 角色全部召回后自动停止观赏模式
  if (viewingModeEnabled.value) {
    viewingModeEnabled.value = false
    viewingModeCurrentEntry.value = null
    viewingModeProgress.value = { current: 0, duration: 0 }
    addLog('info', '🎬 所有角色已召回，观赏模式已停止')
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
 * 刷新当前选中角色的 VMD 文件列表（扫描 models/xxx/actions 等目录）
 */
export async function refreshVmdFiles() {
  if (!selectedModelId.value) return
  const model = availableModels.value.find(m => m.id === selectedModelId.value)
  if (!model) return
  try {
    currentVmdFiles.value = await api().scanVmdFiles({ modelDir: model.modelDir })
    addLog('info', `🔄 VMD 文件列表已刷新 (${currentVmdFiles.value.length} 个)`)
  } catch (e) {
    addLog('error', `扫描 VMD 文件失败: ${e.message}`)
  }
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
    // BPM 更新（来自 MIDI Clock）
    if (data.instanceId === '__bpm__' && data.bpm) {
      globalBpm.value = data.bpm
      return
    }
    // FPS 更新（来自动画循环）
    if (data.instanceId === '__fps__' && data.fps) {
      globalFps.value = data.fps
      return
    }
    // 处理排练状态回传
    if (data.instanceId === '__rehearsal__' && data.rehearsalActive === false) {
      rehearsalMode.value = false
      return
    }

    // 观赏模式状态更新
    if (data.instanceId === '__viewing__') {
      viewingModeEnabled.value = data.viewingActive || false
      if (data.viewingStopped) {
        viewingModeCurrentEntry.value = null
        viewingModeProgress.value = { current: 0, duration: 0 }
      } else if (data.viewingActive && data.viewingCharId) {
        viewingModeCurrentEntry.value = {
          characterId: data.viewingCharId,
          entryIndex: data.viewingEntryIndex,
          name: data.viewingName,
          vmdName: data.viewingVmd ? data.viewingVmd.split('/').pop().replace('.vmd', '') : '',
          audioName: data.viewingAudio ? data.viewingAudio.split('/').pop() : '',
          cameraVmd: data.viewingCameraVmd || '',
          presetName: data.viewingPresetName || '',
          multiplyX: data.viewingMultiplyX ?? 1,
          multiplyY: data.viewingMultiplyY ?? 1,
          multiplyZ: data.viewingMultiplyZ ?? 1,
          progress: data.viewingProgress,
        }
      } else if (!data.viewingActive) {
        viewingModeEnabled.value = false
        viewingModeCurrentEntry.value = null
        viewingModeProgress.value = { current: 0, duration: 0 }
      }
      // 进度信息（每 250ms 上报）
      if (data.viewingProgressCurrent !== undefined && data.viewingProgressDuration !== undefined) {
        viewingModeProgress.value = {
          current: data.viewingProgressCurrent,
          duration: data.viewingProgressDuration,
        }
      }
      return
    }

    const instances = summonedCharacters.value
    const inst = instances.get(data.instanceId)
    if (inst) {
      inst.currentNote = data.currentNote || null
      inst.currentAction = data.currentAction || null
      inst.isFallback = data.isFallback || false
      inst.fps = data.fps || '--'
      if (data.beats !== undefined) inst.beats = data.beats
      if (data.noteType !== undefined) inst.noteType = data.noteType
      summonedCharacters.value = new Map(instances)
    }
  })

  // 场景窗口关闭通知
  api().onCharacterClosed((data) => {
    if (data.instanceId === '__scene__') {
      // 整个场景窗口关闭，清除所有角色
      summonedCharacters.value = new Map()
      rehearsalMode.value = false
      viewingModeEnabled.value = false
      viewingModeCurrentEntry.value = null
      cameraSummoned.value = false
      cameraStatus.value = { currentNote: null, currentAction: null, fps: '--' }
      addLog('info', '场景窗口已关闭')
    }
  })

  // 摄像机状态更新
  api().onCameraStatus?.((data) => {
    const prevAction = cameraStatus.value.currentAction
    if (data.currentNote !== undefined) cameraStatus.value.currentNote = data.currentNote
    if (data.currentAction !== undefined) cameraStatus.value.currentAction = data.currentAction
    if (data.fps !== undefined) cameraStatus.value.fps = data.fps
    cameraStatus.value = { ...cameraStatus.value }

    // 检测默认 VMD 加载状态变化
    const action = cameraStatus.value.currentAction
    if (action && action !== prevAction) {
      if (action.startsWith('(加载失败')) {
        addLog('error', `🎥 摄像机默认 VMD 加载失败: ${action.replace('(加载失败: ', '').replace(')', '')}`)
      } else if (action !== '(加载失败)') {
        addLog('info', `🎥 摄像机默认 VMD 已加载: ${action}`)
      }
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

// ============================================================
// MMD 观赏模式
// ============================================================

/**
 * 加载观赏模式配置
 */
export async function loadViewingModeConfig() {
  try {
    const settings = await api().readSettings()
    const vm = settings.viewingMode
    if (vm) {
      viewingModeEnabled.value = vm.enabled || false
      viewingModePlaylists.value = migratePlaylistFormat(vm.playlists || {})
      viewingModePlayMode.value = vm.playMode || 'list-loop'
    }
  } catch (e) {
    console.error('Failed to load viewing mode config:', e)
  }
}

/**
 * 兼容旧版 per-character 格式 → 新版扁平 entries 格式
 */
function migratePlaylistFormat(playlists) {
  // 已经是扁平格式 { entries: [...] }
  if (playlists.entries) return playlists
  // 旧格式: { characterId: { entries: [{ name, vmdPath, audioPath }] } }
  const entries = []
  for (const [charId, charList] of Object.entries(playlists)) {
    if (charList?.entries) {
      for (const e of charList.entries) {
        entries.push({ ...e, assignTo: e.assignTo || charId })
      }
    }
  }
  return { entries }
}

/**
 * 保存观赏模式配置
 */
export async function saveViewingModeConfig() {
  try {
    // 深拷贝，去除 UI 专用字段
    const cleanEntries = (viewingModePlaylists.value.entries || []).map(e => ({
      name: e.name || '',
      vmdPath: e.vmdPath || '',
      audioPath: e.audioPath || '',
      cameraVmdPath: e.cameraVmdPath || '',
      multiplyX: e.multiplyX ?? 1,
      multiplyY: e.multiplyY ?? 1,
      multiplyZ: e.multiplyZ ?? 1,
      assignTo: e.assignTo || 'global',
    }))
    const payload = {
      viewingMode: {
        enabled: viewingModeEnabled.value,
        playlists: { entries: cleanEntries },
        playMode: viewingModePlayMode.value,
      }
    }
    await api().saveSettings(payload)
  } catch (e) {
    console.error('Failed to save viewing mode config:', e)
  }
}

/**
 * 切换观赏模式
 */
export async function toggleViewingMode(enabled) {
  if (enabled && summonedCharacters.value.size === 0) {
    message.warning('请先召唤至少一个角色')
    return
  }

  viewingModeEnabled.value = enabled
  addLog('info', `${enabled ? '🎬 进入' : '⏹ 退出'} MMD 观赏模式`)

  // 先保存配置自动清理 UI 字段
  await saveViewingModeConfig()

  // 通知场景窗口
  if (enabled) {
    api().startViewingMode({
      playlists: { entries: (viewingModePlaylists.value.entries || []).map(e => ({
        name: e.name,
        vmdPath: e.vmdPath,
        audioPath: e.audioPath,
        cameraVmdPath: e.cameraVmdPath || '',
        multiplyX: e.multiplyX ?? 1,
        multiplyY: e.multiplyY ?? 1,
        multiplyZ: e.multiplyZ ?? 1,
        assignTo: e.assignTo || 'global',
      }))},
      playMode: viewingModePlayMode.value,
    })
  } else {
    api().stopViewingMode({})
  }
}

/** 停止播放但保持观赏模式 ON */
export function stopPlayback() {
  addLog('info', '⏸ 停止播放')
  api().stopViewingPlayback()
}

/** 跳转进度 */
export function seekViewingEntry(currentTime) {
  api().seekViewingEntry({ currentTime })
}

/** 实时更新观赏模式倍率 */
export function updateViewingMultiplier({ multiplyX, multiplyY, multiplyZ }) {
  try {
    api().updateViewingMultiplier({ multiplyX, multiplyY, multiplyZ })
  } catch (e) {
    console.warn('[ViewingMode] Failed to update multiplier:', e)
  }
}

/** 播放指定条目 */
export function playViewingEntry(entryIndex) {
  const cleanEntries = (viewingModePlaylists.value.entries || []).map(e => ({
    name: e.name || '',
    vmdPath: e.vmdPath || '',
    audioPath: e.audioPath || '',
    cameraVmdPath: e.cameraVmdPath || '',
    multiplyX: e.multiplyX ?? 1,
    multiplyY: e.multiplyY ?? 1,
    multiplyZ: e.multiplyZ ?? 1,
    assignTo: e.assignTo || 'global',
  }))
  api().playViewingEntry({
    entryIndex,
    playlists: { entries: cleanEntries },
    playMode: viewingModePlayMode.value,
  })
}

// ============================================================
// 摄像机模块
// ============================================================

export const cameraSummoned = ref(false)
export const cameraConfig = ref(null)
export const cameraMappings = ref({})
export const cameraVmdFiles = ref([])
export const cameraStatus = ref({ currentNote: null, currentAction: null, fps: '--' })
export const hasUnsavedCameraMapping = ref(false)

/** 获取摄像机配置 */
export async function loadCameraConfig() {
  try {
    const cfg = await api().getCameraConfig()
    cameraConfig.value = cfg
    const md = await api().readCameraMapping()
    cameraMappings.value = md.note_mappings || {}
    cameraVmdFiles.value = await api().scanCameraVmdFiles()
    const status = await api().getCameraStatus()
    cameraSummoned.value = status.summoned || false
    cameraStatus.value = { currentNote: status.currentNote, currentAction: status.currentAction, fps: status.fps }
    // 首次加载时记录配置状态
    if (cfg) {
      const ch = cfg.midi?.channel || 1
      const root = cfg.midi?.root_note || 'C4'
      const vmdCount = cameraVmdFiles.value.length
      const mapCount = Object.keys(cameraMappings.value).length
      addLog('info', `🎥 摄像机配置已加载: CH ${ch} | 根音符 ${root} | ${vmdCount} 个 VMD 文件 | ${mapCount} 个映射`)
    }
    return cfg
  } catch (e) {
    cameraConfig.value = null
    cameraMappings.value = {}
    cameraVmdFiles.value = []
    addLog('error', `🎥 摄像机配置加载失败: ${e.message}`)
    return null
  }
}

/** 保存摄像机配置 */
export async function saveCameraConfig(config) {
  try {
    const r = await api().saveCameraConfig(config)
    if (r.success) {
      addLog('info', '✅ 摄像机配置已保存')
    } else {
      addLog('error', `保存失败: ${r.error || ''}`)
    }
    return r
  } catch (e) {
    addLog('error', `保存失败: ${e.message}`)
    return { success: false }
  }
}

/** 保存摄像机映射 */
export async function saveCameraMapping() {
  try {
    const clean = {}
    for (const [n, m] of Object.entries(cameraMappings.value)) {
      clean[n] = { ...m }
      if (!clean[n].play_mode) clean[n].play_mode = 'once'
      if (!clean[n].fade_mode) clean[n].fade_mode = 'fixed'
      if (clean[n].fade_mode === 'fixed') {
        if (clean[n].fade_in === undefined) clean[n].fade_in = clean[n].fade_duration ?? 0.1
        if (clean[n].fade_out === undefined) clean[n].fade_out = clean[n].fade_duration ?? 0.1
      }
    }
    const r = await api().saveCameraMapping({ noteMappings: clean })
    if (r.success) {
      cameraMappings.value = clean
      hasUnsavedCameraMapping.value = false
      addLog('info', `✅ 摄像机映射已保存 (${Object.keys(clean).length} 个)`)

      // 通知场景窗口更新映射
      if (cameraSummoned.value) {
        api().updateCameraMappings({ noteMappings: clean })
      }
    } else {
      addLog('error', `保存失败: ${r.error || ''}`)
    }
    return r
  } catch (e) {
    addLog('error', `保存失败: ${e.message}`)
    return { success: false }
  }
}

/** 刷新摄像机 VMD 文件列表 */
export async function refreshCameraVmdFiles() {
  try {
    cameraVmdFiles.value = await api().scanCameraVmdFiles()
    addLog('info', `🔄 摄像机 VMD 文件列表已刷新 (${cameraVmdFiles.value.length} 个)`)
  } catch (e) {
    addLog('error', `扫描失败: ${e.message}`)
  }
}

/** 召唤摄像机（启用） */
export async function summonCamera() {
  if (summonedCharacters.value.size === 0) {
    addLog('error', '❌ 请先召唤至少一个角色到场景中')
    message.error('请先召唤至少一个角色')
    return { success: false, error: '请先召唤至少一个角色' }
  }
  addLog('info', '🎥 召唤摄像机')
  // 记录配置信息
  const cfg = cameraConfig.value
  if (cfg) {
    const ch = cfg.midi?.channel || 1
    const root = cfg.midi?.root_note || 'C4'
    const defVmd = cfg.camera_vmd?.default_vmd || './actions/default.vmd'
    addLog('info', `   MIDI 通道: CH ${ch} | 根音符: ${root}`)
    addLog('info', `   默认 VMD: ${defVmd} | 映射: ${Object.keys(cameraMappings.value).length} 个`)
  }
  const r = await api().summonCamera({})
  if (r.success) {
    cameraSummoned.value = true
    cameraStatus.value = { currentNote: null, currentAction: null, fps: '--' }
    addLog('info', '🎥 摄像机已召唤至场景，正在加载默认 VMD...')
  } else {
    addLog('error', `召唤失败: ${r.error || ''}`)
  }
  return r
}

/** 召回摄像机（禁用） */
export async function recallCamera() {
  if (viewingModeEnabled.value) {
    addLog('error', '❌ 观赏模式开启中，无法召回摄像机')
    message.error('请先关闭观赏模式')
    return { success: false, error: '观赏模式开启中' }
  }
  addLog('info', '🎥 召回摄像机')
  await api().recallCamera()
  cameraSummoned.value = false
  cameraStatus.value = { currentNote: null, currentAction: null, fps: '--' }
  addLog('info', '🎥 摄像机已从场景移除，机位重置为排练模式')
  cameraStatus.value = { currentNote: null, currentAction: null, fps: '--' }
}

