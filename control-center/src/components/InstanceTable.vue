<template>
  <div v-if="availableModels.length === 0" class="empty-state">
    <n-empty description="未发现角色，点击「刷新」扫描 models/ 目录" />
  </div>
  <n-data-table
    v-else
    :columns="columns"
    :data="tableData"
    :bordered="false"
    :single-line="false"
    size="small"
  />
</template>

<script setup>
import { h, computed } from 'vue'
import { NButton, NSpace, NTag, NBadge } from 'naive-ui'
import {
  availableModels,
  runningInstances,
  startCharacter,
  stopCharacter,
  selectModel,
} from '../composables/useBridge.js'

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
    title: '通道',
    key: 'midiChannel',
    width: 80,
    render(row) {
      return h(NTag, { size: 'small', type: 'info', bordered: false }, {
        default: () => `CH ${String(row.midiChannel).padStart(2, '0')}`
      })
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
    title: 'PID',
    key: 'pid',
    width: 80,
    render(row) {
      const run = runningInstances.value.get(row.id)
      return h('span', {
        style: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }
      }, run ? run.pid : '—')
    }
  },
  {
    title: 'LCD 状态屏',
    key: 'lcd',
    minWidth: 180,
    render(row) {
      const run = runningInstances.value.get(row.id)
      if (!run) return h('span', { style: 'color: var(--text-secondary); font-size: 12px' }, '—')

      const fb = run.isFallback
      return h('div', {
        style: {
          padding: '4px 8px',
          background: '#0a0a14',
          border: `1px solid ${fb ? 'rgba(255,202,40,0.3)' : '#1a1a3a'}`,
          borderRadius: '4px',
          fontFamily: 'var(--font-mono)',
          boxShadow: 'inset 0 0 6px rgba(0,0,0,0.5)',
          minWidth: '140px',
        }
      }, [
        h('div', { style: 'display: flex; align-items: center; gap: 8px; padding: 1px 0' }, [
          h('span', { style: 'font-size: 8px; font-weight: 700; color: rgba(79,195,247,0.5); letter-spacing: 1px; min-width: 48px; text-transform: uppercase' }, 'NOTE'),
          h('span', {
            style: {
              fontSize: run.currentNote ? '15px' : '13px',
              fontWeight: '700',
              color: run.currentNote ? '#ab47bc' : 'rgba(255,255,255,0.15)',
              textShadow: run.currentNote ? '0 0 6px rgba(171,71,188,0.3)' : 'none',
              transition: 'all 0.1s ease',
            }
          }, run.currentNote || '--'),
        ]),
        h('div', { style: 'display: flex; align-items: center; gap: 8px; padding: 1px 0' }, [
          h('span', {
            style: {
              fontSize: '8px', fontWeight: '700',
              color: fb ? 'rgba(255,202,40,0.5)' : 'rgba(79,195,247,0.5)',
              letterSpacing: '1px', minWidth: '48px', textTransform: 'uppercase'
            }
          }, fb ? 'FALLBACK' : 'ACTION'),
          h('span', {
            style: {
              fontSize: '13px', fontWeight: '700',
              color: run.currentAction ? (fb ? '#ffca28' : '#4fc3f7') : 'rgba(255,255,255,0.15)',
              textShadow: run.currentAction ? `0 0 6px ${fb ? 'rgba(255,202,40,0.3)' : 'rgba(79,195,247,0.3)'}` : 'none',
              transition: 'all 0.1s ease',
            }
          }, run.currentAction ? run.currentAction.replace('./actions/', '').replace('.vmd', '') : 'idle'),
        ]),
        h('div', { style: 'display: flex; align-items: center; gap: 8px; padding: 1px 0; margin-top: 1px; padding-top: 1px; border-top: 1px solid rgba(255,255,255,0.05)' }, [
          h('span', { style: 'font-size: 8px; font-weight: 700; color: rgba(79,195,247,0.5); letter-spacing: 1px; min-width: 48px; text-transform: uppercase' }, 'FPS'),
          h('span', {
            style: {
              fontSize: '10px',
              color: run.fps ? (run.fps >= 30 ? '#66bb6a' : '#ffca28') : 'rgba(255,255,255,0.15)',
            }
          }, `${run.fps || '--'} fps`),
        ]),
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
    width: 180,
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
          buttons.push(h(NButton, {
            size: 'tiny',
            quaternary: true,
            onClick: () => { selectModel(row.id); /* switch to config tab - handled by parent */ }
          }, { default: () => '⚙️' }))
          buttons.push(h(NButton, {
            size: 'tiny',
            quaternary: true,
            onClick: () => { selectModel(row.id); /* switch to mapping tab */ }
          }, { default: () => '🎼' }))
          return buttons
        }
      })
    }
  }
]

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
</style>
