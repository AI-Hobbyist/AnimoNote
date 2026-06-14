<template>
  <div v-if="!selectedModelId" class="empty-state">
    <n-empty description="👈 在左侧角色列表中点击一个角色" />
  </div>
  <div v-else>
    <!-- 工具栏 -->
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
      <n-button size="small" @click="handleAddRow">➕ 添加</n-button>
      <n-button size="small" type="primary" @click="handleSave">💾 保存</n-button>
    </n-space>

    <!-- 映射表格 -->
    <div v-if="mappingEntries.length === 0" class="empty-state">
      <n-empty description="🎼 暂无映射">
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
    />
  </div>
</template>

<script setup>
import { computed, ref, h } from 'vue'
import { NButton, NSelect, NInput, NSpace } from 'naive-ui'
import {
  selectedModelId,
  currentMappings,
  currentVmdFiles,
  hasUnsavedMapping,
  saveMapping,
  message,
  dialog,
} from '../composables/useBridge.js'
import { ALL_NOTES } from '../utils/midi-utils.js'
const quickNote = ref('')
const quickVmd = ref('')

const mappingEntries = computed(() => Object.entries(currentMappings.value))

const availableNotes = computed(() => {
  const used = new Set(Object.keys(currentMappings.value))
  return ALL_NOTES
    .filter(n => !used.has(n))
    .map(n => ({ label: n, value: n }))
})

const vmdOptions = computed(() => {
  return currentVmdFiles.value.map(v => ({
    label: v.relativePath,
    value: v.relativePath,
  }))
})

const mappingColumns = [
  {
    title: '音符',
    key: '0',
    width: 80,
    render(row) {
      return row[0]
    },
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
        'onUpdate:value': (val) => {
          updateField(note, 'vmd_path', val)
        }
      })
    }
  },
  {
    title: '混合',
    key: 'blend_time',
    width: 80,
    render(row) {
      const [note, mapping] = row
      return h(NInput, {
        value: mapping.blend_time ?? 0.1,
        size: 'small',
        style: 'width: 60px',
        onChange: (val) => {
          updateField(note, 'blend_time', parseFloat(val) || 0.1)
        }
      })
    }
  },
  {
    title: '重触发',
    key: 'retrigger_mode',
    width: 100,
    render(row) {
      const [note, mapping] = row
      return h(NSelect, {
        value: mapping.retrigger_mode || 'reset',
        options: [
          { label: 'reset', value: 'reset' },
          { label: 'smooth', value: 'smooth' },
        ],
        size: 'small',
        'onUpdate:value': (val) => {
          updateField(note, 'retrigger_mode', val)
        }
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
        onChange: (val) => {
          updateField(note, 'description', val)
        }
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
  if (!currentMappings.value[note]) {
    currentMappings.value[note] = {}
  }
  currentMappings.value[note][field] = value
  hasUnsavedMapping.value = true
}

function handleAddRow() {
  const used = new Set(Object.keys(currentMappings.value))
  let nn = 'C4'
  for (const n of ALL_NOTES) {
    if (!used.has(n)) { nn = n; break }
  }
  currentMappings.value[nn] = { vmd_path: '', blend_time: 0.1, retrigger_mode: 'reset', description: '' }
  hasUnsavedMapping.value = true
  message.info(`添加映射: ${nn}`)
}

function handleDelete(note) {
  dialog.warning({
    title: '确认删除',
    content: `删除 ${note}？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: () => {
      delete currentMappings.value[note]
      hasUnsavedMapping.value = true
      message.success(`已删除 ${note}`)
    }
  })
}

function handleQuickAdd() {
  if (!quickNote.value || !quickVmd.value) {
    message.error('请选择音符和 VMD')
    return
  }
  currentMappings.value[quickNote.value] = {
    vmd_path: quickVmd.value,
    blend_time: 0.1,
    retrigger_mode: 'reset',
    description: '',
  }
  hasUnsavedMapping.value = true
  message.info(`快速添加: ${quickNote.value} → ${quickVmd.value}`)
  quickNote.value = ''
  quickVmd.value = ''
}

async function handleSave() {
  await saveMapping()
  if (!hasUnsavedMapping.value) {
    message.success('映射已保存')
  }
}
</script>

<style scoped>
.empty-state {
  padding: 60px 20px;
  text-align: center;
}
</style>
