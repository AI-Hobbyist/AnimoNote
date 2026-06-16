<template>
  <div style="height: 100%; display: flex; flex-direction: column">
    <n-space style="margin-bottom: 12px; flex-shrink: 0" align="center">
      <n-button size="small" @click="scanModels">
        <template #icon><n-icon><ReloadIcon /></n-icon></template>
        刷新角色
      </n-button>
      <n-button size="small" type="success" @click="handleSummonAll" :disabled="summonedCharacters.size >= availableModels.length">
        召唤全部
      </n-button>
      <n-button size="small" type="error" @click="handleRecallAll" :disabled="summonedCharacters.size === 0">
        召回全部
      </n-button>
      <n-divider vertical />
      <n-button
        size="small"
        :type="rehearsalMode ? 'error' : 'warning'"
        @click="toggleRehearsal"
        :disabled="summonedCharacters.size === 0"
      >
        {{ rehearsalMode ? '退出排练' : '排练模式' }}
      </n-button>
      <n-tag v-if="rehearsalMode" type="warning" size="small" :bordered="false">排练中 - 可自由移动角色与视角</n-tag>
    </n-space>

    <n-scrollbar style="flex: 1">
      <div v-if="availableModels.length === 0" class="empty-state">
        <n-empty description="未发现角色，点击「刷新角色」扫描 models/ 目录" />
      </div>
      <n-data-table
        v-else
        :columns="columns"
        :data="tableData"
        :bordered="false"
        :single-line="false"
        size="small"
      />
    </n-scrollbar>
  </div>
</template>

<script setup>
import { h, computed } from 'vue'
import { NButton, NSpace, NTag, NIcon, NText, NFlex, NDivider } from 'naive-ui'
import { Reload as ReloadIcon } from '@vicons/ionicons5'
import {
  availableModels,
  summonedCharacters,
  summonCharacter,
  recallCharacter,
  scanModels,
  deleteModel,
  toggleRehearsal,
  rehearsalMode,
  dialog,
} from '../composables/useBridge.js'

const columns = [
  {
    title: '角色',
    key: 'displayName',
    width: 160,
    render(row) {
      const summoned = summonedCharacters.value.has(row.id)
      return h('div', [
        h('strong', { style: summoned ? 'color:#4fc3f7' : '' }, row.displayName),
        h('div', { style: 'font-size: 11px; color: var(--text-secondary); margin-top: 2px' }, row.id),
      ])
    }
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render(row) {
      const summoned = summonedCharacters.value.has(row.id)
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '600',
          background: summoned ? 'rgba(79, 195, 247, 0.15)' : 'rgba(239, 83, 80, 0.15)',
          color: summoned ? '#4fc3f7' : '#ef5350',
        }
      }, [
        h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: summoned ? '#4fc3f7' : '#ef5350', display: 'inline-block' } }),
        summoned ? '已召唤' : '未召唤'
      ])
    }
  },
  {
    title: '通道',
    key: 'midiChannel',
    width: 70,
    render(row) {
      return h('span', {
        style: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#4fc3f7' }
      }, 'CH ' + String(row.midiChannel).padStart(2, '0'))
    }
  },
  {
    title: '动作',
    key: 'currentAction',
    minWidth: 140,
    render(row) {
      const inst = summonedCharacters.value.get(row.id)
      if (!inst) return h('span', { style: 'color: var(--text-secondary); font-size: 12px' }, '—')
      const action = inst.currentAction
        ? inst.currentAction.replace('./actions/', '').replace('.vmd', '')
        : 'idle'
      const note = inst.currentNote || '--'
      return h('div', { style: 'font-family: var(--font-mono); font-size: 12px' }, [
        h('span', { style: 'color: #ab47bc; font-weight: 700' }, note),
        h('span', { style: 'color: var(--text-secondary); margin: 0 4px' }, '→'),
        h('span', { style: inst.isFallback ? 'color: #ffca28' : 'color: #4fc3f7' }, action),
      ])
    }
  },
  {
    title: 'FPS',
    key: 'fps',
    width: 60,
    render(row) {
      const inst = summonedCharacters.value.get(row.id)
      if (!inst) return h('span', { style: 'color: var(--text-secondary); font-size: 12px' }, '—')
      const fps = parseInt(inst.fps) || 0
      return h('span', {
        style: {
          fontFamily: 'var(--font-mono)', fontSize: '12px',
          color: fps >= 30 ? '#66bb6a' : fps > 0 ? '#ffca28' : 'rgba(255,255,255,0.15)'
        }
      }, (inst.fps || '--') + ' fps')
    }
  },
  {
    title: '操作',
    key: 'actions',
    width: 170,
    render(row) {
      const summoned = summonedCharacters.value.has(row.id)
      return h('div', { style: 'display: flex; gap: 4px' }, [
        summoned
          ? h(NButton, { size: 'tiny', type: 'warning', onClick: () => recallCharacter(row.id) }, { default: () => '🔽 召回' })
          : h(NButton, { size: 'tiny', type: 'success', onClick: () => summonCharacter(row.id, row.modelDir, row.midiChannel) }, { default: () => '🔼 召唤' }),
        h(NButton, {
          size: 'tiny', type: 'error', quaternary: true,
          disabled: summoned,
          onClick: () => handleDelete(row)
        }, { default: () => '🗑️' }),
      ])
    }
  }
]

function handleDelete(row) {
  dialog.warning({
    title: '确认删除',
    content: '确定要将角色 "' + row.displayName + '" (' + row.id + ') 移至系统回收站吗？',
    positiveText: '移至回收站',
    negativeText: '取消',
    onPositiveClick: async () => { await deleteModel(row.id) }
  })
}

const tableData = computed(() => {
  return availableModels.value.map(m => {
    const inst = summonedCharacters.value.get(m.id)
    return { ...m, currentAction: inst?.currentAction || null, currentNote: inst?.currentNote || null, isFallback: inst?.isFallback || false, fps: inst?.fps || '--' }
  })
})

function handleSummonAll() {
  for (const m of availableModels.value) {
    if (!summonedCharacters.value.has(m.id)) {
      summonCharacter(m.id, m.modelDir, m.midiChannel)
    }
  }
}

function handleRecallAll() {
  for (const [id] of summonedCharacters.value) {
    recallCharacter(id)
  }
}
</script>

<style scoped>
.empty-state { padding: 40px; text-align: center; }
</style>
