<template>
  <div v-if="availableModels.length === 0" class="empty-state">
    <n-empty description="未发现角色">
      <template #extra>
        <n-button size="small" @click="$emit('scan')">扫描 models/</n-button>
      </template>
    </n-empty>
  </div>
  <div v-else class="model-list">
    <div
      v-for="model in availableModels"
      :key="model.id"
      class="model-item"
      :class="{ selected: model.id === selectedModelId }"
      @click="handleSelect(model.id)"
    >
      <n-flex align="center" :wrap="false" style="padding: 8px 10px">
        <n-avatar size="small" round style="background: rgba(255,255,255,0.05)">
          🎤
        </n-avatar>
        <div style="flex: 1; min-width: 0">
          <div class="model-name">{{ model.displayName }}</div>
          <div class="model-id">{{ model.id }} · CH {{ String(model.midiChannel).padStart(2, '0') }}</div>
        </div>
        <n-tag size="tiny" :bordered="false" type="info">{{ model.noteCount }}</n-tag>
        <n-badge v-if="summonedCharacters.has(model.id)" dot type="success" />
      </n-flex>

      <!-- LCD 状态屏 -->
      <div v-if="summonedCharacters.has(model.id)" class="model-lcd" :class="{ 'lcd-viewing': viewingModeEnabled }">
        <!-- 观赏模式开启时：统一显示模式状态，不再显示 MIDI 信息 -->
        <template v-if="viewingModeEnabled">
          <div class="lcd-row">
            <span class="lcd-label" style="color: rgba(102,187,106,0.7)">MODE</span>
            <span class="lcd-value" style="color: #66bb6a; font-size: 12px">
              🎬 观赏模式
            </span>
          </div>
          <div class="lcd-row">
            <span class="lcd-label" style="color: rgba(255,255,255,0.25)">STATUS</span>
            <span class="lcd-value" style="color: rgba(255,255,255,0.5); font-size: 12px">
              {{ isViewingModePlayingFor(model.id) ? (viewingModeCurrentEntry?.name || '播放中') : '待机中' }}
            </span>
          </div>
        </template>
        <!-- 普通模式（MIDI） -->
        <template v-else>
          <div class="lcd-row">
            <span class="lcd-label">CH</span>
            <span class="lcd-value lcd-active">
              {{ String(insts.get(model.id)?.midiChannel || model.midiChannel).padStart(2, '0') }}
            </span>
          </div>
          <div class="lcd-row">
            <span class="lcd-label">NOTE</span>
            <span class="lcd-value lcd-note" :class="{ 'lcd-active': insts.get(model.id)?.currentNote }">
              {{ insts.get(model.id)?.currentNote || '--' }}
            </span>
          </div>
          <div class="lcd-row">
            <span class="lcd-label">{{ insts.get(model.id)?.isFallback ? 'FALLBACK' : 'ACTION' }}</span>
            <span class="lcd-value lcd-action" :class="{ 'lcd-active': insts.get(model.id)?.currentAction }">
              {{ insts.get(model.id)?.currentAction ? insts.get(model.id).currentAction.split('/').pop().replace('.vmd', '') : 'idle' }}
            </span>
          </div>
          <div class="lcd-row lcd-beat">
            <span class="lcd-label">BEAT</span>
            <span
              class="lcd-value"
              :style="{
                color: insts.get(model.id)?.beats
                  ? (insts.get(model.id).beats >= 0.75 ? '#4fc3f7' : '#ffca28')
                  : 'rgba(255,255,255,0.15)'
              }"
            >
              {{ insts.get(model.id)?.noteType || (insts.get(model.id)?.beats != null ? insts.get(model.id).beats.toFixed(2) + '拍' : '--') }}
            </span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import {
  availableModels,
  selectedModelId,
  summonedCharacters,
  viewingModeEnabled,
  viewingModeCurrentEntry,
  selectModel,
} from '../composables/useBridge.js'

const emit = defineEmits(['scan'])

// 为每个模型计算其实例状态
const insts = computed(() => summonedCharacters.value)

/** 判断该角色是否在观赏模式中正被分配播放 */
function isViewingModePlayingFor(charId) {
  if (!viewingModeEnabled.value || !viewingModeCurrentEntry.value) return false
  const cur = viewingModeCurrentEntry.value
  return cur.characterId === 'global' || cur.characterId === charId
}

function handleSelect(id) {
  selectModel(id)
}
</script>

<style scoped>
.empty-state {
  padding: 20px;
}

.model-item {
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.1s ease;
  margin: 2px 0;
}

.model-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.model-item.selected {
  background: rgba(79, 195, 247, 0.12);
  border: 1px solid rgba(79, 195, 247, 0.3);
  border-radius: 4px;
}

.model-name {
  font-size: 13px;
  font-weight: 600;
  color: #e8e8e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-id {
  font-size: 11px;
  color: var(--text-secondary);
}

/* LCD 状态屏 */
.model-lcd {
  margin: 0 8px 8px 8px;
  padding: 6px 10px;
  background: #0a0a14;
  border: 1px solid #1a1a3a;
  border-radius: 4px;
  font-family: var(--font-mono);
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.5);
}

.model-lcd.lcd-fallback {
  border-color: rgba(255, 202, 40, 0.3);
  box-shadow: inset 0 0 8px rgba(255, 202, 40, 0.05);
}

.model-lcd.lcd-viewing {
  border-color: rgba(102, 187, 106, 0.3);
  box-shadow: inset 0 0 8px rgba(102, 187, 106, 0.08);
}

.lcd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}

.lcd-fps {
  margin-top: 2px;
  padding-top: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.lcd-label {
  font-size: 9px;
  font-weight: 700;
  color: rgba(79, 195, 247, 0.5);
  letter-spacing: 1px;
  min-width: 52px;
  text-transform: uppercase;
}

.lcd-value {
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.15);
  transition: all 0.1s ease;
  min-height: 18px;
}

.lcd-value.lcd-active {
  color: #4fc3f7;
  text-shadow: 0 0 6px rgba(79, 195, 247, 0.3);
}

.lcd-note.lcd-active {
  color: #ab47bc;
  text-shadow: 0 0 6px rgba(171, 71, 188, 0.3);
  font-size: 16px;
}

.lcd-fallback .lcd-label {
  color: rgba(255, 202, 40, 0.5);
}

.lcd-fallback .lcd-value.lcd-active {
  color: #ffca28;
  text-shadow: 0 0 6px rgba(255, 202, 40, 0.3);
}
</style>
