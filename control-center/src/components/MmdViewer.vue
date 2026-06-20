<template>
  <div class="mmd-viewer">
    <n-scrollbar style="height: 100%">
    <!-- 观赏模式主开关 -->
    <div class="mode-toggle-bar">
      <div class="toggle-info">
        <n-text strong style="font-size: 15px">🎬 MMD 观赏模式</n-text>
        <n-text depth="3" style="font-size: 12px; margin-left: 8px">
          无视 MIDI 控制，播放完整 VMD 动作 + 音频
        </n-text>
      </div>
      <n-switch
        :value="viewingModeEnabled"
        :loading="viewingModeLoading"
        :disabled="summonedCharacters.size === 0"
        @update:value="handleToggleViewingMode"
        size="large"
      >
        <template #checked> 开启 </template>
        <template #unchecked> 关闭 </template>
      </n-switch>
    </div>

    <n-alert v-if="summonedCharacters.size === 0" type="warning" :bordered="false" style="margin-top: 8px">
      请先召唤至少一个角色到场景中
    </n-alert>

    <!-- 播放模式 + 播放控制 -->
    <n-space align="center" style="margin-top: 12px">
      <n-select
        v-model:value="playMode"
        :options="playModeOptions"
        size="small"
        style="width: 140px"
        :disabled="summonedCharacters.size === 0"
        @update:value="handleSavePlayMode"
      />
      <n-button
        size="small"
        type="primary"
        :disabled="summonedCharacters.size === 0 || !viewingModeEnabled || !hasAnyEntry"
        @click="handlePlayAll"
      >
        <template #icon>▶</template>
        播放全部
      </n-button>
      <n-button
        size="small"
        :disabled="summonedCharacters.size === 0 || !viewingModeEnabled || !isPlaying"
        @click="handleStopPlayback"
      >
        <template #icon>⏹</template>
        停止播放
      </n-button>
      <n-button
        size="small"
        :disabled="summonedCharacters.size === 0 || !viewingModeEnabled"
        @click="handleResetCamera"
        style="margin-left: 4px"
      >
        <template #icon>⟲</template>
        重置镜头
      </n-button>
    </n-space>

    <!-- 提示：单曲播放模式下点击条目即可播放 -->
    <n-alert v-if="viewingModeEnabled && playMode === 'single'" type="info" :bordered="false" style="margin-top: 6px; font-size: 12px">
      💡 单曲播放模式：点击下方任意条目即可播放
    </n-alert>

    <!-- 当前播放状态 + 进度条 -->
    <n-card v-if="currentPlayingInfo" size="small" :bordered="true" style="margin-top: 8px">
      <template #header>
        <n-space align="center">
          <n-text strong style="color: #4fc3f7">▶ 正在播放</n-text>
          <n-tag size="tiny" :bordered="false" :type="currentPlayingInfo.characterId === 'global' ? 'success' : 'info'">
            {{ currentPlayingInfo.characterId === 'global' ? '全局' : currentPlayingInfo.characterId }}
          </n-tag>
        </n-space>
      </template>
      <n-descriptions size="small" :column="2">
        <n-descriptions-item label="名称">{{ currentPlayingInfo.name }}</n-descriptions-item>
        <n-descriptions-item label="动作">{{ currentPlayingInfo.vmdName }}</n-descriptions-item>
        <n-descriptions-item label="音频">{{ currentPlayingInfo.audioName }}</n-descriptions-item>
        <n-descriptions-item label="镜头">
          <span v-if="currentPlayingInfo.cameraVmd" style="color: #66bb6a">
            🎥 {{ currentPlayingInfo.cameraVmd.split('/').pop() || currentPlayingInfo.cameraVmd }}
            <span v-if="!cameraSummoned" style="color:#ef5350;margin-left:4px;font-size:11px">(未召唤)</span>
          </span>
          <span v-else depth="3">—</span>
        </n-descriptions-item>
        <n-descriptions-item label="分配到">
          <n-tag size="tiny" :bordered="false" :type="currentPlayingInfo.characterId === 'global' ? 'success' : 'info'">
            {{ currentPlayingInfo.characterId === 'global' ? '全局' : currentPlayingInfo.characterId }}
          </n-tag>
        </n-descriptions-item>
      </n-descriptions>

      <!-- 可拖拽进度条 -->
      <div class="progress-row">
        <span class="progress-time">{{ formatTime(progressCurrent) }}</span>
        <div class="progress-slider-wrap">
          <n-slider
            :value="progressPercent"
            :step="0.1"
            :max="100"
            :format-tooltip="() => ''"
            @update:value="handleSeek"
          />
        </div>
        <span class="progress-time progress-remain">{{ formatTime(progressRemain) }}</span>
      </div>

      <!-- 实时倍率调节 -->
      <div v-if="currentPlayingInfo.cameraVmd && cameraSummoned" class="multiplier-row">
        <div class="multiplier-label">倍率</div>
        <div class="multiplier-sliders">
          <div class="multiplier-axis">
            <span class="axis-label" style="color:#ef5350">X</span>
            <n-slider v-model:value="multiplierX" :min="0.01" :max="3.0" :step="0.01" style="flex:1" @update:value="handleMultiplierChange" />
            <n-input-number v-model:value="multiplierX" :min="0.01" :max="3.0" :step="0.01" size="tiny" style="width: 65px" @update:value="handleMultiplierChange" />
          </div>
          <div class="multiplier-axis">
            <span class="axis-label" style="color:#66bb6a">Y</span>
            <n-slider v-model:value="multiplierY" :min="0.01" :max="3.0" :step="0.01" style="flex:1" @update:value="handleMultiplierChange" />
            <n-input-number v-model:value="multiplierY" :min="0.01" :max="3.0" :step="0.01" size="tiny" style="width: 65px" @update:value="handleMultiplierChange" />
          </div>
          <div class="multiplier-axis">
            <span class="axis-label" style="color:#42a5f5">Z</span>
            <n-slider v-model:value="multiplierZ" :min="0.01" :max="3.0" :step="0.01" style="flex:1" @update:value="handleMultiplierChange" />
            <n-input-number v-model:value="multiplierZ" :min="0.01" :max="3.0" :step="0.01" size="tiny" style="width: 65px" @update:value="handleMultiplierChange" />
          </div>
        </div>
      </div>
    </n-card>

    <!-- 播放列表（扁平化，每个条目独立分配） -->
    <div class="playlist-section" style="margin-top: 14px">
      <div class="playlist-header">
        <n-text strong style="font-size: 14px">📋 播放列表</n-text>
        <n-button size="tiny" @click="handleAddEntry">
          <template #icon>＋</template>
          添加条目
        </n-button>
      </div>

      <div v-if="allEntries.length === 0" class="empty-entries">
        <n-empty description="暂无条目，点击上方按钮添加" size="small" />
      </div>
      <div v-else class="entries-list">
        <div
          v-for="(entry, idx) in allEntries"
          :key="idx"
          class="entry-item"
          :class="{ playing: isCurrentEntry(idx), disabled: summonedCharacters.size === 0 || !viewingModeEnabled }"
          @dblclick="summonedCharacters.size > 0 && viewingModeEnabled && handlePlayEntry(idx)"
        >
          <div class="entry-play-btn" @click.stop="summonedCharacters.size > 0 && viewingModeEnabled && handlePlayEntry(idx)" title="播放此条目">
            <span class="play-icon">{{ isCurrentEntry(idx) ? '▶' : '▶' }}</span>
          </div>
          <div class="entry-info" @click.stop="summonedCharacters.size > 0 && handlePlayEntry(idx)">
            <div class="entry-name">{{ entry.name || `条目 ${idx + 1}` }}</div>
            <div class="entry-paths">
              <n-text depth="3" style="font-size: 11px" class="path-text">
                VMD: {{ entry.vmdPath || '未设置' }}
              </n-text>
              <n-text depth="3" style="font-size: 11px" class="path-text">
                音频: {{ entry.audioPath || '未设置' }}
              </n-text>
              <n-text v-if="entry.cameraVmdPath" depth="3" style="font-size: 11px; color: #66bb6a" class="path-text">
                🎥 镜头: {{ entry.cameraVmdPath }}
                <span v-if="!cameraSummoned" style="color:#ef5350;margin-left:4px">(未召唤)</span>
              </n-text>
              <n-text v-if="entry.cameraVmdPath && cameraSummoned" depth="3" style="font-size: 11px; color: #ffca28" class="path-text">
                偏移 X: {{ getEffectiveOffset(entry.multiplyX, entry.multiplyY, entry.multiplyZ).x.toFixed(2) }}, Y: {{ getEffectiveOffset(entry.multiplyX, entry.multiplyY, entry.multiplyZ).y.toFixed(2) }}, Z: {{ getEffectiveOffset(entry.multiplyX, entry.multiplyY, entry.multiplyZ).z.toFixed(2) }}
              </n-text>
            </div>
          </div>
          <div class="entry-assign">
            <n-tag size="tiny" :bordered="false" :type="entry.assignTo === 'global' ? 'success' : 'info'">
              {{ entry.assignTo === 'global' ? '全局' : entry.assignTo }}
            </n-tag>
          </div>
          <div class="entry-actions">
            <n-button size="tiny" quaternary @click.stop="handleEditEntry(idx)">
              ✏️
            </n-button>
            <n-button size="tiny" quaternary @click.stop="handleDeleteEntry(idx)">
              🗑️
            </n-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增/编辑条目对话框 -->
    <n-modal v-model:show="showEntryModal" preset="card" title="条目设置" style="width: 550px">
      <n-form v-if="editingEntry" label-placement="top">
        <n-form-item label="条目名称">
          <n-input v-model:value="editingEntry.name" placeholder="例如: 舞曲1" />
        </n-form-item>
        <n-form-item label="VMD 动作文件">
          <n-input v-model:value="editingEntry.vmdPath" placeholder="输入 VMD 路径或点击浏览选择">
            <template #suffix>
              <n-button size="tiny" quaternary @click="handleBrowseVmd">
                📂 浏览
              </n-button>
            </template>
          </n-input>
        </n-form-item>
        <n-form-item label="音频文件">
          <n-input v-model:value="editingEntry.audioPath" placeholder="输入音频路径或点击浏览选择">
            <template #suffix>
              <n-button size="tiny" quaternary @click="handleBrowseAudio">
                📂 浏览
              </n-button>
            </template>
          </n-input>
        </n-form-item>
        <n-form-item label="镜头文件">
          <n-input v-model:value="editingEntry.cameraVmdPath" placeholder="输入镜头 VMD 路径或点击浏览选择（可选）">
            <template #suffix>
              <n-button size="tiny" quaternary @click="handleBrowseCameraVmd">
                📂 浏览
              </n-button>
            </template>
          </n-input>
          <n-text depth="3" style="font-size: 11px; margin-top: 4px; display: block">
            可选，不受分配模式影响，仅当摄像机模块已召唤时生效
          </n-text>
          <n-text v-if="!cameraSummoned" depth="3" style="font-size: 11px; margin-top: 2px; display: block; color: #ef5350">
            ⚠ 摄像机模块尚未召唤，镜头文件不会生效
          </n-text>
        </n-form-item>

        <n-form-item label="分配到">
          <n-radio-group v-model:value="editingEntry.assignTo">
            <n-space>
              <n-radio value="global">
                <n-text depth="3">全局（所有角色）</n-text>
              </n-radio>
              <n-radio value="specific">
                <n-text depth="3">特定角色</n-text>
              </n-radio>
            </n-space>
          </n-radio-group>
          <n-select
            v-if="editingEntry.assignTo === 'specific'"
            v-model:value="editingEntry.assignCharId"
            :options="summonedCharOptions"
            size="small"
            style="width: 200px; margin-top: 6px"
            placeholder="选择角色..."
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEntryModal = false">取消</n-button>
          <n-button type="primary" @click="handleSaveEntry">保存</n-button>
        </n-space>
      </template>
    </n-modal>
    </n-scrollbar>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import {
  summonedCharacters,
  availableModels,
  viewingModeEnabled,
  viewingModePlaylists,
  viewingModePlayMode,
  viewingModeCurrentEntry,
  viewingModeProgress,
  cameraSummoned,
  loadViewingModeConfig,
  saveViewingModeConfig,
  toggleViewingMode,
  playViewingEntry,
  stopPlayback,
  seekViewingEntry,
  updateViewingMultiplier,
  addLog,
} from '../composables/useBridge.js'

const playMode = ref(viewingModePlayMode.value)

const playModeOptions = [
  { label: '随机播放', value: 'random' },
  { label: '单曲播放', value: 'single' },
  { label: '单曲循环', value: 'single-loop' },
  { label: '列表循环', value: 'list-loop' },
]

const showEntryModal = ref(false)
const editingEntryIdx = ref(-1)
const editingEntry = ref(null)
const viewingModeLoading = ref(false)

const currentPlayingInfo = computed(() => viewingModeCurrentEntry.value)

/** 实时倍率状态 */
const multiplierX = ref(1)
const multiplierY = ref(1)
const multiplierZ = ref(1)

/** 从当前播放信息同步倍率 */
function syncMultiplierFromPlaying() {
  const info = viewingModeCurrentEntry.value
  if (info) {
    multiplierX.value = info.multiplyX ?? 1
    multiplierY.value = info.multiplyY ?? 1
    multiplierZ.value = info.multiplyZ ?? 1
  }
}

/** 倍率变化时实时发送到场景并保存 */
let _multiplierTimer = null
function handleMultiplierChange() {
  const idx = viewingModeCurrentEntry.value?.entryIndex
  if (idx == null || idx < 0) return

  // 发送到场景窗口
  updateViewingMultiplier({
    multiplyX: multiplierX.value,
    multiplyY: multiplierY.value,
    multiplyZ: multiplierZ.value,
  })

  // 更新内存中的播放列表条目
  const entries = viewingModePlaylists.value.entries
  if (entries && entries[idx]) {
    entries[idx].multiplyX = multiplierX.value
    entries[idx].multiplyY = multiplierY.value
    entries[idx].multiplyZ = multiplierZ.value
  }

  // 防抖保存到 settings.json
  if (_multiplierTimer) clearTimeout(_multiplierTimer)
  _multiplierTimer = setTimeout(() => {
    saveViewingModeConfig()
    _multiplierTimer = null
  }, 500)
}

/** 当前排练模式摄像机位置（从 settings.json 读取） */
const cameraPosition = ref({ x: 0, y: 0, z: 0 })

/** 根据倍率计算有效偏移值 */
function getEffectiveOffset(multiplyX = 1, multiplyY = 1, multiplyZ = 1, customPos) {
  const pos = customPos || cameraPosition.value
  return {
    x: -pos.x * multiplyX,
    y: -pos.y * multiplyY,
    z: -pos.z * multiplyZ,
  }
}

/** 当前播放条目的有效偏移（含倍率） */
const currentOffset = computed(() => {
  if (!currentPlayingInfo.value) return { x: 0, y: 0, z: 0 }
  const info = currentPlayingInfo.value
  return getEffectiveOffset(
    info.multiplyX,
    info.multiplyY,
    info.multiplyZ,
  )
})

/** 扁平条目列表 */
const allEntries = computed(() => viewingModePlaylists.value.entries || [])

/** 已召唤角色的选项列表 */
const summonedCharOptions = computed(() => {
  return availableModels.value
    .filter(m => summonedCharacters.value.has(m.id))
    .map(m => ({ label: `${m.displayName} (${m.id})`, value: m.id }))
})

const hasAnyEntry = computed(() => {
  return (viewingModePlaylists.value.entries || []).length > 0
})

const isPlaying = computed(() => {
  return viewingModeEnabled.value && !!viewingModeCurrentEntry.value
})

// 进度相关
const progressCurrent = computed(() => viewingModeProgress.value.current || 0)
const progressDuration = computed(() => viewingModeProgress.value.duration || 0)
const progressRemain = computed(() => Math.max(0, progressDuration.value - progressCurrent.value))
const progressPercent = computed(() => {
  if (!progressDuration.value) return 0
  return (progressCurrent.value / progressDuration.value) * 100
})

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function handleSeek(percent) {
  if (!progressDuration.value) return
  const targetTime = (percent / 100) * progressDuration.value
  seekViewingEntry(targetTime)
}

// 当前播放条目变化时同步倍率
watch(viewingModeCurrentEntry, () => {
  syncMultiplierFromPlaying()
})

onMounted(async () => {
  await loadViewingModeConfig()
  // 兼容旧格式迁移：从 per-character 格式转为扁平格式
  migrateOldPlaylistFormat()
  playMode.value = viewingModePlayMode.value

  // 从 settings.json 读取排练模式摄像机位置
  try {
    const api = window.electronAPI
    if (api && api.readSettings) {
      const settings = await api.readSettings()
      if (settings && settings.rehearsalCamera && settings.rehearsalCamera.position) {
        cameraPosition.value = { ...settings.rehearsalCamera.position }
      }
    }
  } catch (e) {
    console.warn('[MmdViewer] Failed to load camera position:', e)
  }
})

/** 兼容旧版 per-character 格式 → 新版扁平 entries 格式 */
function migrateOldPlaylistFormat() {
  const pl = viewingModePlaylists.value
  // 如果已经有 entries 数组则跳过
  if (pl.entries) return
  // 旧格式: { characterId: { entries: [...] } }
  const oldEntries = []
  for (const [charId, charList] of Object.entries(pl)) {
    if (charList?.entries) {
      for (const e of charList.entries) {
        oldEntries.push({ ...e, assignTo: charId })
      }
    }
  }
  if (oldEntries.length > 0) {
    viewingModePlaylists.value = { entries: oldEntries }
    saveViewingModeConfig()
  }
}

function isCurrentEntry(idx) {
  const cur = viewingModeCurrentEntry.value
  return cur && cur.entryIndex === idx
}

async function handleToggleViewingMode(val) {
  viewingModeLoading.value = true
  try {
    await toggleViewingMode(val)
  } finally {
    viewingModeLoading.value = false
  }
}

function handleSavePlayMode(val) {
  viewingModePlayMode.value = val
  saveViewingModeConfig()
}

function handleAddEntry() {
  editingEntryIdx.value = -1
  editingEntry.value = { name: '', vmdPath: '', audioPath: '', cameraVmdPath: '', multiplyX: 1, multiplyY: 1, multiplyZ: 1, assignTo: 'global', assignCharId: null }
  showEntryModal.value = true
}

function handleEditEntry(idx) {
  const entry = allEntries.value[idx]
  editingEntryIdx.value = idx
  editingEntry.value = {
    ...entry,
    assignTo: entry.assignTo === 'global' || !entry.assignTo ? 'global' : 'specific',
    assignCharId: entry.assignTo === 'global' || !entry.assignTo ? null : entry.assignTo,
  }
  showEntryModal.value = true
}

function handleDeleteEntry(idx) {
  if (!viewingModePlaylists.value.entries) return
  viewingModePlaylists.value.entries.splice(idx, 1)
  saveViewingModeConfig()
}

function handleSaveEntry() {
  if (!editingEntry.value) return
  if (!viewingModePlaylists.value.entries) {
    viewingModePlaylists.value.entries = []
  }
  // 解析 assignTo 最终值
  const finalAssignTo = editingEntry.value.assignTo === 'specific'
    ? editingEntry.value.assignCharId
    : 'global'
  const entryData = {
    name: editingEntry.value.name,
    vmdPath: editingEntry.value.vmdPath,
    audioPath: editingEntry.value.audioPath,
    cameraVmdPath: editingEntry.value.cameraVmdPath || '',
    multiplyX: editingEntry.value.multiplyX ?? 1,
    multiplyY: editingEntry.value.multiplyY ?? 1,
    multiplyZ: editingEntry.value.multiplyZ ?? 1,
    assignTo: finalAssignTo,
  }
  if (editingEntryIdx.value >= 0) {
    viewingModePlaylists.value.entries[editingEntryIdx.value] = entryData
  } else {
    viewingModePlaylists.value.entries.push(entryData)
  }
  showEntryModal.value = false
  saveViewingModeConfig()
  addLog('info', `观赏模式条目已更新`)
}

function handlePlayAll() {
  if (!viewingModeEnabled.value) {
    toggleViewingMode(true)
  }
  // 重新发送播放指令（深拷贝剥离 Vue 响应式代理）
  const api = window.electronAPI
  if (api && api.startViewingMode) {
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
    api.startViewingMode({
      playlists: { entries: cleanEntries },
      playMode: viewingModePlayMode.value,
    })
  }
}

function handleStopPlayback() {
  stopPlayback()
}

async function handleResetCamera() {
  const api = window.electronAPI
  if (api && api.resetViewingCamera) {
    addLog('info', '⟲ 重置摄像机位置')
    await api.resetViewingCamera()
  } else {
    addLog('error', '重置镜头失败: IPC 不可用')
  }
}

function handlePlayEntry(idx) {
  if (!viewingModeEnabled.value) {
    // 观赏模式未开启，先开启
    toggleViewingMode(true)
  }
  playViewingEntry(idx)
}

async function handleBrowseVmd() {
  const api = window.electronAPI
  if (!api || !api.browseVmdFile) return
  const filePath = await api.browseVmdFile()
  if (filePath && editingEntry.value) {
    editingEntry.value.vmdPath = filePath
  }
}

async function handleBrowseAudio() {
  const api = window.electronAPI
  if (!api || !api.browseAudioFile) return
  const filePath = await api.browseAudioFile()
  if (filePath && editingEntry.value) {
    editingEntry.value.audioPath = filePath
  }
}

async function handleBrowseCameraVmd() {
  const api = window.electronAPI
  if (!api || !api.browseVmdFile) return
  const filePath = await api.browseVmdFile()
  if (filePath && editingEntry.value) {
    editingEntry.value.cameraVmdPath = filePath
  }
}
</script>

<style scoped>
.mmd-viewer {
  height: 100%;
  overflow: hidden;
  padding: 4px 0;
}

.mode-toggle-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: rgba(79, 195, 247, 0.06);
  border: 1px solid rgba(79, 195, 247, 0.15);
  border-radius: 6px;
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.character-playlist {
  margin-top: 16px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
}

.char-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.empty-entries {
  padding: 12px 0;
}

.entries-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.playlist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.playlist-section {
  padding: 10px 0;
}

.entry-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  transition: background 0.15s;
  cursor: default;
}

.entry-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.entry-item.playing {
  background: rgba(79, 195, 247, 0.12);
  border: 1px solid rgba(79, 195, 247, 0.25);
}

.entry-item.disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}

.entry-play-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: all 0.15s;
  background: rgba(255, 255, 255, 0.04);
}

.entry-play-btn:hover {
  background: rgba(79, 195, 247, 0.2);
}

.play-icon {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  transition: color 0.15s;
}

.entry-play-btn:hover .play-icon {
  color: #4fc3f7;
}

.entry-item.playing .entry-play-btn {
  background: rgba(79, 195, 247, 0.15);
}

.entry-item.playing .play-icon {
  color: #4fc3f7;
}

.entry-item:hover:not(.playing) .play-icon {
  color: rgba(255, 255, 255, 0.7);
}

.entry-index {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.entry-info {
  flex: 1;
  min-width: 0;
}

.entry-name {
  font-size: 13px;
  font-weight: 600;
  color: #e8e8e8;
}

.entry-paths {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 2px;
}

.path-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

/* 进度条 */
.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0 2px;
}

.progress-time {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  min-width: 48px;
  white-space: nowrap;
}

.progress-remain {
  text-align: right;
  color: rgba(255, 255, 255, 0.35);
}

.progress-slider-wrap {
  flex: 1;
  min-width: 0;
}

/* 实时倍率调节 */
.multiplier-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin-top: 6px;
}

.multiplier-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  min-width: 32px;
  line-height: 28px;
}

.multiplier-sliders {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.multiplier-axis {
  display: flex;
  align-items: center;
  gap: 8px;
}

.axis-label {
  font-size: 12px;
  font-weight: 700;
  min-width: 14px;
  text-align: center;
}
</style>
