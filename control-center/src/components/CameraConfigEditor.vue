<template>
  <div class="camera-editor">
    <n-scrollbar style="height: 100%">
      <div style="padding-right: 12px">
        <!-- 摄像机配置 -->
        <n-card title="🎥 摄像机配置" size="small" :bordered="true" style="margin-bottom: 12px">
          <n-form label-placement="left" label-width="120">
            <n-form-item label="MIDI 通道">
              <n-select
                v-model:value="midiChannel"
                :options="channelOptions"
                size="small"
                style="width: 120px"
                @update:value="handleConfigChange"
              />
            </n-form-item>
            <n-form-item label="根音符">
              <n-select
                v-model:value="rootNote"
                :options="noteOptions"
                size="small"
                style="width: 120px"
                filterable
                @update:value="handleConfigChange"
              />
              <n-text depth="3" style="font-size: 11px; margin-left: 8px">
                默认摄像机 VMD 映射的根音符
              </n-text>
            </n-form-item>
            <n-form-item label="默认 VMD">
              <n-input
                v-model:value="defaultVmd"
                placeholder="./default.vmd"
                size="small"
                style="width: 300px"
                @update:value="handleConfigChange"
              />
              <n-button size="tiny" style="margin-left: 4px" @click="handleBrowseDefaultVmd">
                📂
              </n-button>
            </n-form-item>
            <n-form-item label="循环播放">
              <n-switch v-model:value="defaultLoop" @update:value="handleConfigChange" />
            </n-form-item>
          </n-form>
          <n-button size="small" type="primary" @click="handleSaveConfig" :disabled="!hasConfigChanges">
            💾 保存配置
          </n-button>
        </n-card>

        <!-- VMD 映射编辑器 -->
        <n-card title="🎼 摄像机 VMD 映射" size="small" :bordered="true">
          <template #header-extra>
            <n-button size="tiny" @click="refreshCameraVmdFiles">
              🔄 刷新动作
            </n-button>
          </template>

          <n-space style="margin-bottom: 12px" align="center" :wrap="true">
            <n-text depth="3" style="font-size: 12px">快速添加：</n-text>
            <n-select
              v-model:value="quickNote"
              :options="availableNotes"
              placeholder="选择音符..."
              size="small"
              style="width: 120px"
              filterable
            />
            <n-select
              v-model:value="quickVmd"
              :options="vmdOptions"
              placeholder="选择 VMD..."
              size="small"
              style="width: 200px"
              filterable
            />
            <n-button size="small" type="primary" @click="handleQuickAdd">➕ 快速添加</n-button>
            <n-button size="small" type="primary" @click="handleSaveMapping">💾 保存映射</n-button>
          </n-space>

          <div v-if="mappingEntries.length === 0" class="empty-state">
            <n-empty description="🎬 暂无摄像机 VMD 映射">
              <template #extra>
                <n-button size="small" @click="handleAddRow">添加映射</n-button>
              </template>
            </n-empty>
          </div>
          <n-data-table
            v-else
            :columns="mappingColumns"
            :data="mappingEntries"
            :bordered="false"
            :single-line="false"
            size="small"
            :row-key="row => row[0]"
            scroll-x="700"
          />
        </n-card>
      </div>
    </n-scrollbar>


  </div>
</template>

<script setup>
import { ref, computed, onMounted, h, watch } from 'vue'
import { NButton, NSelect, NInput, NSpace, NForm, NFormItem, NCard, NSwitch, NScrollbar, NDataTable, NEmpty, NText } from 'naive-ui'
import {
  cameraConfig,
  cameraMappings,
  cameraVmdFiles,
  hasUnsavedCameraMapping,
  loadCameraConfig,
  saveCameraConfig,
  saveCameraMapping,
  refreshCameraVmdFiles,
  addLog,
  message,
} from '../composables/useBridge.js'
import { ALL_NOTES } from '../utils/midi-utils.js'

onMounted(() => {
  loadCameraConfig()
})

// MIDI 通道选项
const channelOptions = Array.from({ length: 16 }, (_, i) => ({
  label: `CH ${String(i + 1).padStart(2, '0')}`,
  value: i + 1
}))

// 音符选项（全音域）
const noteOptions = ALL_NOTES.map(n => ({ label: n, value: n }))

// 表单字段状态（本地可写 ref，从 cameraConfig 同步）
const midiChannel = ref(1)
const rootNote = ref('C4')
const defaultVmd = ref('./actions/default.vmd')
const defaultLoop = ref(true)

/** 从 cameraConfig 同步表单字段 */
function syncFormFromConfig() {
  const cfg = cameraConfig.value
  if (!cfg) return
  midiChannel.value = cfg.midi?.channel ?? 1
  rootNote.value = cfg.midi?.root_note ?? 'C4'
  defaultVmd.value = cfg.camera_vmd?.default_vmd ?? './actions/default.vmd'
  defaultLoop.value = cfg.camera_vmd?.loop !== false
}

// 监听 cameraConfig 变化（如加载后自动同步到表单字段）
watch(cameraConfig, syncFormFromConfig, { immediate: true })

const hasConfigChanges = ref(false)

const quickNote = ref('')
const quickVmd = ref('')

const mappingEntries = computed(() => Object.entries(cameraMappings.value))

const availableNotes = computed(() => {
  const used = new Set(Object.keys(cameraMappings.value))
  return ALL_NOTES
    .filter(n => !used.has(n))
    .map(n => ({ label: n, value: n }))
})

const vmdOptions = computed(() => {
  return cameraVmdFiles.value.map(v => ({
    label: v.relativePath,
    value: v.relativePath,
  }))
})

const mappingColumns = [
  {
    title: '音符',
    key: '0',
    width: 80,
    render(row) { return row[0] }
  },
  {
    title: 'VMD',
    key: 'vmd_path',
    minWidth: 200,
    render(row) {
      const [note, mapping] = row
      return h(NSelect, {
        value: mapping.vmd_path || '',
        options: [{ label: '—', value: '' }, ...vmdOptions.value],
        size: 'small',
        placeholder: '选择 VMD',
        filterable: true,
        'onUpdate:value': (val) => updateField(note, 'vmd_path', val)
      })
    }
  },
  {
    title: '淡化模式',
    key: 'fade_mode',
    width: 90,
    render(row) {
      const [note, mapping] = row
      return h(NSelect, {
        value: mapping.fade_mode || 'fixed',
        options: [
          { label: '固定值', value: 'fixed' },
          { label: '节拍', value: 'bpm' },
        ],
        size: 'small',
        'onUpdate:value': (val) => {
          updateField(note, 'fade_mode', val)
          if (val === 'fixed') {
            if (mapping.fade_in === undefined) updateField(note, 'fade_in', mapping.fade_duration ?? 0.3)
            if (mapping.fade_out === undefined) updateField(note, 'fade_out', mapping.fade_duration ?? 0.3)
          }
        }
      })
    }
  },
  {
    title: '淡入(秒)',
    key: 'fade_in',
    width: 95,
    render(row) {
      const [note, mapping] = row
      if (mapping.fade_mode === 'bpm') return null
      return h(NInput, {
        value: mapping.fade_in ?? mapping.fade_duration ?? 0.3,
        size: 'small',
        style: 'width: 75px',
        placeholder: '淡入',
        onChange: (v) => updateField(note, 'fade_in', parseFloat(v) || 0.3)
      })
    }
  },
  {
    title: '淡出(秒)',
    key: 'fade_out',
    width: 95,
    render(row) {
      const [note, mapping] = row
      if (mapping.fade_mode === 'bpm') return null
      return h(NInput, {
        value: mapping.fade_out ?? mapping.fade_duration ?? 0.3,
        size: 'small',
        style: 'width: 75px',
        placeholder: '淡出',
        onChange: (v) => updateField(note, 'fade_out', parseFloat(v) || 0.3)
      })
    }
  },
  {
    title: '播放模式',
    key: 'play_mode',
    width: 90,
    render(row) {
      const [note, mapping] = row
      return h(NSelect, {
        value: mapping.play_mode || 'once',
        options: [
          { label: '单次', value: 'once' },
          { label: '循环', value: 'loop' },
        ],
        size: 'small',
        'onUpdate:value': (val) => updateField(note, 'play_mode', val)
      })
    }
  },
  {
    title: '描述',
    key: 'description',
    minWidth: 120,
    render(row) {
      const [note, mapping] = row
      return h(NInput, {
        value: mapping.description || '',
        size: 'small',
        placeholder: '描述',
        onChange: (val) => updateField(note, 'description', val)
      })
    }
  },
  {
    title: '',
    key: 'actions',
    width: 50,
    render(row) {
      const [note] = row
      return h(NButton, {
        size: 'tiny',
        circle: true,
        type: 'error',
        quaternary: true,
        onClick: () => handleDelete(note)
      }, { default: () => '✕' })
    }
  }
]

function updateField(note, field, value) {
  if (!cameraMappings.value[note]) {
    cameraMappings.value[note] = {}
  }
  cameraMappings.value[note][field] = value
  hasUnsavedCameraMapping.value = true
}

function handleConfigChange() {
  hasConfigChanges.value = true
}

async function handleSaveConfig() {
  const cfg = {
    midi: {
      channel: midiChannel.value,
      root_note: rootNote.value,
    },
    camera_source: 'vmd',
    camera_vmd: {
      default_vmd: defaultVmd.value,
      loop: defaultLoop.value,
    }
  }
  const r = await saveCameraConfig(cfg)
  if (r.success) {
    hasConfigChanges.value = false
    addLog('info', `摄像机配置已保存`)
  }
}

function handleBrowseDefaultVmd() {
  // 暂不使用文件对话框，让用户手动输入路径
  message.info('请在输入框中输入 VMD 文件路径（相对于 camera/ 目录）')
}

function handleAddRow() {
  const used = new Set(Object.keys(cameraMappings.value))
  let nn = rootNote.value || 'C4'
  for (const n of ALL_NOTES) {
    if (!used.has(n)) { nn = n; break }
  }
  cameraMappings.value[nn] = { vmd_path: '', fade_duration: 0.3, fade_in: 0.3, fade_out: 0.3, fade_mode: 'fixed', play_mode: 'once', description: '' }
  hasUnsavedCameraMapping.value = true
  message.info(`添加映射: ${nn}`)
}

function handleDelete(note) {
  delete cameraMappings.value[note]
  hasUnsavedCameraMapping.value = true
}

function handleQuickAdd() {
  if (!quickNote.value || !quickVmd.value) {
    message.error('请选择音符和 VMD')
    return
  }
  cameraMappings.value[quickNote.value] = {
    vmd_path: quickVmd.value,
    fade_duration: 0.3,
    fade_in: 0.3,
    fade_out: 0.3,
    fade_mode: 'fixed',
    play_mode: 'once',
    description: '',
  }
  hasUnsavedCameraMapping.value = true
  message.info(`快速添加: ${quickNote.value} → ${quickVmd.value}`)
  quickNote.value = ''
  quickVmd.value = ''
}

async function handleSaveMapping() {
  await saveCameraMapping()
  if (!hasUnsavedCameraMapping.value) {
    message.success('摄像机映射已保存')
  }
}



</script>

<style scoped>
.camera-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
}
</style>
