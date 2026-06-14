<template>
  <div v-if="!currentConfig" class="empty-state">
    <n-empty description="👈 在左侧角色列表中点击一个角色开始编辑" />
  </div>
  <n-form v-else :model="formModel" label-placement="top" size="small" class="config-form">
    <!-- 基本信息 -->
    <n-card size="small" title="📋 基本信息" :bordered="false" class="config-section">
      <n-grid :cols="2" :x-gap="12">
        <n-form-item-gi label="角色 ID">
          <n-input :value="formModel.instance_id" disabled />
        </n-form-item-gi>
        <n-form-item-gi label="显示名称">
          <n-input v-model:value="formModel.display_name" @update:value="markDirty" />
        </n-form-item-gi>
      </n-grid>
    </n-card>

    <!-- MIDI 配置 -->
    <n-card size="small" title="🎹 MIDI 配置" :bordered="false" class="config-section">
      <n-grid :cols="2" :x-gap="12">
        <n-form-item-gi label="MIDI 输入设备">
          <n-select
            v-model:value="formModel.midi.device_name"
            :options="midiDeviceOptions"
            clearable
            placeholder="— 所有设备 —"
            @update:value="markDirty"
          />
        </n-form-item-gi>
        <n-form-item-gi label="MIDI 通道 (1-16)">
          <n-select
            v-model:value="formModel.midi.channel"
            :options="channelOptions"
            @update:value="markDirty"
          />
        </n-form-item-gi>
      </n-grid>
      <n-grid :cols="2" :x-gap="12">
        <n-form-item-gi label="设备过滤模式">
          <n-select
            v-model:value="formModel.midi.mode"
            :options="modeOptions"
            @update:value="markDirty"
          />
        </n-form-item-gi>
        <n-gi />
      </n-grid>
    </n-card>

    <!-- 模型 -->
    <n-card size="small" title="🧊 模型" :bordered="false" class="config-section">
      <n-grid :cols="2" :x-gap="12">
        <n-form-item-gi label="PMX 模型文件">
          <n-select
            v-model:value="formModel.model.pmx_path"
            :options="pmxOptions"
            placeholder="— 选择模型 —"
            filterable
            @update:value="markDirty"
          />
        </n-form-item-gi>
        <n-form-item-gi label="待机 VMD">
          <n-input v-model:value="formModel.model.vmd_path" placeholder="./idle.vmd" @update:value="markDirty" />
        </n-form-item-gi>
      </n-grid>
      <n-grid :cols="2" :x-gap="12">
        <n-form-item-gi label="缩放">
          <n-input-number v-model:value="formModel.model.scale" :step="0.1" :min="0.1" @update:value="markDirty" />
        </n-form-item-gi>
        <n-form-item-gi label="位置 Y">
          <n-input-number v-model:value="formModel.model.position.y" :step="0.5" @update:value="markDirty" />
        </n-form-item-gi>
      </n-grid>
    </n-card>

    <!-- 窗口 -->
    <n-card size="small" title="🪟 窗口" :bordered="false" class="config-section">
      <n-grid :cols="2" :x-gap="12">
        <n-form-item-gi label="宽度">
          <n-input-number v-model:value="formModel.window.width" :min="200" @update:value="markDirty" />
        </n-form-item-gi>
        <n-form-item-gi label="高度">
          <n-input-number v-model:value="formModel.window.height" :min="200" @update:value="markDirty" />
        </n-form-item-gi>
      </n-grid>
      <n-space>
        <n-checkbox v-model:checked="formModel.window.always_on_top" @update:checked="markDirty">
          置顶显示
        </n-checkbox>
        <n-checkbox v-model:checked="formModel.window.mouse_through_default" @update:checked="markDirty">
          默认鼠标穿透
        </n-checkbox>
      </n-space>
    </n-card>

    <!-- 待机动作 -->
    <n-card size="small" title="🔄 待机动作" :bordered="false" class="config-section">
      <n-grid :cols="2" :x-gap="12">
        <n-form-item-gi label="Idle VMD 路径">
          <n-input v-model:value="formModel.idle.vmd_path" placeholder="./idle.vmd" @update:value="markDirty" />
        </n-form-item-gi>
        <n-form-item-gi label="混合时间 (秒)">
          <n-input-number v-model:value="formModel.idle.blend_time" :step="0.05" :min="0" @update:value="markDirty" />
        </n-form-item-gi>
      </n-grid>
      <n-checkbox v-model:checked="formModel.idle.loop" @update:checked="markDirty">
        循环播放
      </n-checkbox>
    </n-card>

    <!-- 眨眼 -->
    <n-card size="small" title="👁️ 随机眨眼" :bordered="false" class="config-section">
      <n-checkbox v-model:checked="formModel.blink.enabled" @update:checked="markDirty">
        启用随机眨眼
      </n-checkbox>
      <n-grid :cols="3" :x-gap="12" style="margin-top: 8px">
        <n-form-item-gi label="最小间隔 (ms)">
          <n-input-number v-model:value="formModel.blink.min_interval" :step="500" :min="500" @update:value="markDirty" />
        </n-form-item-gi>
        <n-form-item-gi label="最大间隔 (ms)">
          <n-input-number v-model:value="formModel.blink.max_interval" :step="500" :min="1000" @update:value="markDirty" />
        </n-form-item-gi>
        <n-form-item-gi label="眨眼持续时间 (ms)">
          <n-input-number v-model:value="formModel.blink.duration" :step="10" :min="30" :max="500" @update:value="markDirty" />
        </n-form-item-gi>
      </n-grid>
    </n-card>

    <!-- 物理 -->
    <n-card size="small" title="⚡ 物理" :bordered="false" class="config-section">
      <n-checkbox v-model:checked="formModel.physics.enabled" @update:checked="markDirty">
        启用刚体物理 (ammo.js)
      </n-checkbox>
    </n-card>

    <n-space justify="end" style="margin-top: 16px">
      <n-button type="primary" @click="handleSave">💾 保存配置</n-button>
    </n-space>
  </n-form>
</template>

<script setup>
import { reactive, computed, watch } from 'vue'
import {
  currentConfig,
  currentPmxFiles,
  midiDeviceList,
  saveConfig,
  hasUnsavedConfig,
  message,
} from '../composables/useBridge.js'

const formModel = reactive({
  instance_id: '',
  display_name: '',
  midi: { device_name: '', channel: 1, mode: 'single' },
  model: { pmx_path: '', vmd_path: '', scale: 1.0, position: { x: 0, y: 0, z: 0 } },
  window: { width: 600, height: 800, always_on_top: true, mouse_through_default: true },
  idle: { vmd_path: '', loop: true, blend_time: 0.3 },
  blink: { enabled: true, min_interval: 2000, max_interval: 6000, duration: 120 },
  physics: { enabled: true },
})

// 同步配置到表单
watch(currentConfig, (cfg) => {
  if (!cfg) return
  formModel.instance_id = cfg.instance_id || ''
  formModel.display_name = cfg.display_name || ''
  formModel.midi = {
    device_name: cfg.midi?.device_name || '',
    channel: cfg.midi?.channel || cfg.midi_channel || 1,
    mode: cfg.midi?.mode || 'single',
  }
  formModel.model = {
    pmx_path: cfg.model?.pmx_path || '',
    vmd_path: cfg.model?.vmd_path || '',
    scale: cfg.model?.scale || 1.0,
    position: { ...cfg.model?.position },
  }
  formModel.window = {
    width: cfg.window?.width || 600,
    height: cfg.window?.height || 800,
    always_on_top: cfg.window?.always_on_top !== false,
    mouse_through_default: cfg.window?.mouse_through_default !== false,
  }
  formModel.idle = {
    vmd_path: cfg.idle?.vmd_path || '',
    loop: cfg.idle?.loop !== false,
    blend_time: cfg.idle?.blend_time || 0.3,
  }
  formModel.blink = {
    enabled: cfg.blink?.enabled !== false,
    min_interval: cfg.blink?.min_interval || 2000,
    max_interval: cfg.blink?.max_interval || 6000,
    duration: cfg.blink?.duration || 120,
  }
  formModel.physics = {
    enabled: cfg.physics?.enabled !== false,
  }
}, { immediate: true, deep: true })

const channelOptions = Array.from({ length: 16 }, (_, i) => ({
  label: `CH ${String(i + 1).padStart(2, '0')}`,
  value: i + 1,
}))

const modeOptions = [
  { label: '单设备 + 指定通道', value: 'single' },
  { label: '所有设备 + 指定通道', value: 'all' },
  { label: '所有设备 + 所有通道 (Omni)', value: 'omni' },
]

const midiDeviceOptions = computed(() => {
  const opts = [{ label: '— 所有设备 —', value: '' }]
  for (const d of midiDeviceList.value) {
    opts.push({ label: d.name, value: d.name })
  }
  opts.push({ label: '任意设备', value: '*' })
  return opts
})

const pmxOptions = computed(() => {
  return currentPmxFiles.value.map(f => ({
    label: f.name,
    value: `./${f.name}`,
  }))
})

function markDirty() {
  // 将表单数据同步回 currentConfig
  if (!currentConfig.value) return
  currentConfig.value.display_name = formModel.display_name
  currentConfig.value.midi = { ...formModel.midi }
  currentConfig.value.model = { ...formModel.model }
  currentConfig.value.window = { ...formModel.window }
  currentConfig.value.idle = { ...formModel.idle }
  currentConfig.value.blink = { ...formModel.blink }
  currentConfig.value.physics = { ...formModel.physics }
  hasUnsavedConfig.value = true
}

async function handleSave() {
  await saveConfig()
  if (!hasUnsavedConfig.value) {
    message.success('配置已保存')
  }
}
</script>

<style scoped>
.empty-state {
  padding: 60px 20px;
  text-align: center;
}

.config-form {
  max-width: 700px;
  padding: 8px 0;
}

.config-section {
  margin-bottom: 16px;
}
</style>
