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
      <!-- 摄像机（固定实例，不可删除） -->
      <div class="camera-section">
        <div class="camera-section-title">
          <span>🎥 固定实例</span>
        </div>
        <div class="camera-row" :class="{ summoned: cameraSummoned }">
          <div class="camera-info">
            <div class="camera-name">
              <n-icon size="18" style="color: #66bb6a; margin-right: 4px; vertical-align: middle">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>
              </n-icon>
              <strong>摄像机</strong>
              <n-tag size="tiny" :bordered="false" type="success" style="margin-left: 6px">固定</n-tag>
            </div>
            <div class="camera-id">camera</div>
          </div>
          <div class="camera-status">
            <span class="camera-status-badge" :class="cameraSummoned ? 'on' : 'off'">
              <span class="camera-status-dot" :class="cameraSummoned ? 'on' : 'off'"></span>
              {{ cameraSummoned ? '已召唤' : '未召唤' }}
            </span>
          </div>
          <div class="camera-channel">
            <span class="channel-text">{{ cameraConfig?.midi?.channel ? 'CH ' + String(cameraConfig.midi.channel).padStart(2, '0') : 'CH 01' }}</span>
          </div>
          <div class="camera-action-display">
            <template v-if="cameraSummoned">
              <div class="camera-lcd">
                <span class="lcd-label">VMD</span>
                <span class="lcd-value" :class="{ active: cameraStatus.currentAction }">
                  {{ cameraStatus.currentAction ? cameraStatus.currentAction.replace('./','').replace('.vmd','') : 'default' }}
                </span>
              </div>
            </template>
            <span v-else class="action-placeholder">—</span>
          </div>
          <div class="camera-actions">
            <n-button
              v-if="cameraSummoned"
              size="tiny"
              type="warning"
              :disabled="viewingModeEnabled"
              @click="handleRecallCamera"
            >
              🔽 召回
            </n-button>
            <n-button
              v-else
              size="tiny"
              type="success"
              @click="handleSummonCamera"
            >
              🎥 召唤
            </n-button>
          </div>
        </div>
      </div>

      <!-- 角色实例列表 -->
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
import { h, computed, onMounted } from 'vue'
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
  viewingModeEnabled,
  viewingModeCurrentEntry,
  cameraSummoned,
  cameraConfig,
  cameraStatus,
  loadCameraConfig,
  summonCamera,
  recallCamera,
  dialog,
} from '../composables/useBridge.js'

onMounted(() => {
  loadCameraConfig()
})

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
    minWidth: 160,
    render(row) {
      const inst = summonedCharacters.value.get(row.id)
      if (!inst) return h('span', { style: 'color: var(--text-secondary); font-size: 12px' }, '—')

      // 观赏模式：显示曲目
      if (viewingModeEnabled.value && viewingModeCurrentEntry.value) {
        const cur = viewingModeCurrentEntry.value
        if (cur.characterId === 'global' || cur.characterId === row.id) {
          return h('div', { style: 'font-family: var(--font-mono); font-size: 12px; display: flex; align-items: center; gap: 4px' }, [
            h('span', { style: 'font-size: 14px' }, '🎬'),
            h('span', { style: 'color: #66bb6a; font-weight: 600' }, 'Playing:'),
            h('span', { style: 'color: #e8e8e8' }, cur.name || '未知曲目'),
          ])
        }
      }

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
  if (row.id === 'camera') return // 摄像机不可删除
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
  if (cameraSummoned.value) {
    recallCamera()
  }
}

function handleSummonCamera() {
  summonCamera()
}

function handleRecallCamera() {
  recallCamera()
}
</script>

<style scoped>
.empty-state { padding: 40px; text-align: center; }

.camera-section {
  margin-bottom: 16px;
  border: 1px solid rgba(102, 187, 106, 0.25);
  border-radius: 6px;
  background: rgba(102, 187, 106, 0.04);
}

.camera-section-title {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  color: rgba(102, 187, 106, 0.6);
  text-transform: uppercase;
  letter-spacing: 1px;
  border-bottom: 1px solid rgba(102, 187, 106, 0.1);
}

.camera-row {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 12px;
}

.camera-row.summoned {
  background: rgba(102, 187, 106, 0.06);
}

.camera-info {
  min-width: 140px;
}

.camera-name {
  display: flex;
  align-items: center;
  font-size: 14px;
  color: #e8e8e8;
}

.camera-id {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
  margin-left: 24px;
}

.camera-status { width: 90px; }

.camera-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}

.camera-status-badge.on {
  background: rgba(102, 187, 106, 0.15);
  color: #66bb6a;
}

.camera-status-badge.off {
  background: rgba(239, 83, 80, 0.15);
  color: #ef5350;
}

.camera-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.camera-status-dot.on { background: #66bb6a; }
.camera-status-dot.off { background: #ef5350; }

.camera-channel { width: 70px; }

.channel-text {
  font-family: var(--font-mono);
  font-size: 12px;
  color: #4fc3f7;
}

.camera-action-display {
  flex: 1;
  min-width: 120px;
}

.camera-lcd {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 12px;
}

.camera-lcd .lcd-label {
  font-size: 9px;
  font-weight: 700;
  color: rgba(102, 187, 106, 0.5);
  letter-spacing: 1px;
}

.camera-lcd .lcd-value {
  color: rgba(255, 255, 255, 0.15);
  font-weight: 600;
  transition: color 0.1s ease;
}

.camera-lcd .lcd-value.active {
  color: #66bb6a;
}

.action-placeholder {
  color: var(--text-secondary);
  font-size: 12px;
}

.camera-actions {
  width: 100px;
  display: flex;
  gap: 4px;
}
</style>
