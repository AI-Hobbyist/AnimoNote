<template>
  <n-scrollbar style="height: 100%">
    <div style="padding-bottom: 12px">
      <n-button size="small" @click="scanModels">
        <template #icon><n-icon><ReloadIcon /></n-icon></template>
        角色刷新
      </n-button>
    </div>
    <div v-if="availableModels.length === 0" class="empty-state">
      <n-empty description="未发现角色，点击「角色刷新」扫描 models/ 目录" />
    </div>
    <n-data-table
      v-else
      :columns="columns"
      :data="tableData"
      :bordered="false"
      :single-line="false"
      size="small"
      scroll-x="900"
    />
  </n-scrollbar>
</template>

<script setup>
import { h, computed, reactive, onMounted, watch } from 'vue'
import { NButton, NSpace, NTag, NIcon, NSlider, NFlex, NText, NTooltip } from 'naive-ui'
import { Reload as ReloadIcon, Trash as TrashIcon, Move as MoveIcon } from '@vicons/ionicons5'
import {
  availableModels,
  runningInstances,
  startCharacter,
  stopCharacter,
  scanModels,
  deleteModel,
  dialog,
  updateCharacterConfig,
  saveModelConfig,
} from '../composables/useBridge.js'

// 存储每个模型的实时调整参数
const modelParams = reactive({})

// 初始化或更新参数
function initParams() {
  availableModels.value.forEach(async (m) => {
    if (!modelParams[m.id]) {
      // 默认值
      modelParams[m.id] = {
        brightness: 1.0,
        scale: 1.0,
        opacity: 1.0
      }
      
      // 尝试从文件加载实际配置
      try {
        const config = await window.electronAPI.readConfig({ modelDir: m.modelDir })
        if (config) {
          modelParams[m.id].brightness = config.model?.light_intensity ?? 1.0
          modelParams[m.id].scale = config.model?.scale ?? 1.0
          modelParams[m.id].opacity = config.model?.opacity ?? 1.0
        }
      } catch (e) {
        console.error('加载模型配置失败:', m.id, e)
      }
    }
  })
}

onMounted(initParams)
watch(availableModels, initParams, { deep: true })

// 处理参数变化
async function handleParamChange(modelId, type, value) {
  const model = availableModels.value.find(m => m.id === modelId)
  if (!model) return

  // 1. 实时下发指令给运行中的窗口
  updateCharacterConfig(modelId, { [type]: value })

  // 2. 自动保存到 config.json
  try {
    const config = await window.electronAPI.readConfig({ modelDir: model.modelDir })
    if (config) {
      if (!config.model) config.model = {}
      if (type === 'brightness') config.model.light_intensity = value
      if (type === 'scale') config.model.scale = value
      if (type === 'opacity') config.model.opacity = value
      
      await saveModelConfig(model.modelDir, config)
    }
  } catch (e) {
    console.error('自动保存失败:', e)
  }
}

const columns = [
  {
    title: '角色',
    key: 'displayName',
    width: 140,
    render(row) {
      return h('div', [
        h('strong', null, row.displayName),
        h('div', { style: 'font-size: 11px; color: var(--text-secondary); margin-top: 2px' }, row.id),
      ])
    }
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render(row) {
      const run = runningInstances.value.get(row.id)
      return h('span', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '10px',
          fontSize: '11px',
          fontWeight: '600',
          background: run ? 'rgba(102, 187, 106, 0.15)' : 'rgba(239, 83, 80, 0.15)',
          color: run ? '#66bb6a' : '#ef5350',
        }
      }, [
        h('span', {
          style: {
            width: '6px', height: '6px', borderRadius: '50%',
            background: run ? '#66bb6a' : '#ef5350',
            display: 'inline-block'
          }
        }),
        run ? '运行中' : '已停止'
      ])
    }
  },
  {
    title: '实时参数调整',
    key: 'params',
    minWidth: 350,
    render(row) {
      const params = modelParams[row.id] || { brightness: 1, scale: 1, opacity: 1 }
      
      return h('div', { style: 'padding: 8px 0' }, [
        // 亮度调节
        h(NFlex, { align: 'center', style: 'margin-bottom: 4px' }, {
          default: () => [
            h(NText, { depth: 3, style: 'width: 45px; font-size: 12px' }, '亮度'),
            h(NSlider, {
              value: params.brightness,
              min: 0, max: 3, step: 0.1,
              style: 'flex: 1',
              'onUpdate:value': (v) => {
                params.brightness = v
                handleParamChange(row.id, 'brightness', v)
              }
            }),
            h(NText, { style: 'width: 30px; font-size: 12px; text-align: right' }, params.brightness.toFixed(1))
          ]
        }),
        // 缩放调节
        h(NFlex, { align: 'center', style: 'margin-bottom: 4px' }, {
          default: () => [
            h(NText, { depth: 3, style: 'width: 45px; font-size: 12px' }, '缩放'),
            h(NSlider, {
              value: params.scale,
              min: 0.1, max: 5, step: 0.1,
              style: 'flex: 1',
              'onUpdate:value': (v) => {
                params.scale = v
                handleParamChange(row.id, 'scale', v)
              }
            }),
            h(NText, { style: 'width: 30px; font-size: 12px; text-align: right' }, params.scale.toFixed(1))
          ]
        }),
        // 透明度调节
        h(NFlex, { align: 'center' }, {
          default: () => [
            h(NText, { depth: 3, style: 'width: 45px; font-size: 12px' }, '透明度'),
            h(NSlider, {
              value: params.opacity,
              min: 0, max: 1, step: 0.05,
              style: 'flex: 1',
              'onUpdate:value': (v) => {
                params.opacity = v
                handleParamChange(row.id, 'opacity', v)
              }
            }),
            h(NText, { style: 'width: 30px; font-size: 12px; text-align: right' }, params.opacity.toFixed(2))
          ]
        })
      ])
    }
  },
  {
    title: '映射',
    key: 'noteCount',
    width: 60,
    render(row) {
      return h('span', { style: 'color: var(--text-secondary); font-size: 12px' }, row.noteCount)
    }
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    render(row) {
      const run = runningInstances.value.get(row.id)
      return h(NSpace, { size: 'small' }, {
        default: () => {
          const buttons = []
          if (run) {
            buttons.push(h(NButton, {
              size: 'tiny',
              type: 'error',
              onClick: () => stopCharacter(row.id)
            }, { default: () => '■ 关闭' }))
          } else {
            buttons.push(h(NButton, {
              size: 'tiny',
              type: 'success',
              onClick: () => startCharacter(row.id, row.modelDir, row.midiChannel)
            }, { default: () => '▶ 打开' }))
          }

          // 添加移动按钮
          if (run) {
            buttons.push(h(NTooltip, {}, {
              trigger: () => h(NButton, {
                size: 'tiny',
                secondary: true,
                type: 'info',
                onClick: () => updateCharacterConfig(row.id, { type: 'show-move-dialog' })
              }, {
                icon: () => h(NIcon, null, { default: () => h(MoveIcon) }),
                default: () => '移动'
              }),
              default: () => '弹出移动控制面板'
            }))
          }

          // 添加删除按钮
          buttons.push(h(NButton, {
            size: 'tiny',
            type: 'error',
            quaternary: true,
            disabled: !!run,
            onClick: () => handleDelete(row)
          }, {
            icon: () => h(NIcon, null, { default: () => h(TrashIcon) }),
            default: () => '删除'
          }))

          return buttons
        }
      })
    }
  }
]

function handleDelete(row) {
  dialog.warning({
    title: '确认删除',
    content: `确定要将角色 "${row.displayName}" (${row.id}) 移至系统回收站吗？您可以稍后从回收站中恢复它。`,
    positiveText: '移至回收站',
    negativeText: '取消',
    onPositiveClick: async () => {
      await deleteModel(row.id)
    }
  })
}

const tableData = computed(() => {
  return availableModels.value.map(m => ({
    ...m,
    status: runningInstances.value.has(m.id) ? 'running' : 'stopped',
  }))
})
</script>

<style scoped>
.empty-state {
  padding: 40px;
  text-align: center;
}

/* 实时参数调整样式微调 */
.n-slider {
  --n-rail-height: 3px !important;
  --n-handle-size: 12px !important;
}
</style>
