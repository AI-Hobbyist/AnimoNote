<template>
  <n-scrollbar ref="scrollbarRef" style="height: 100%" @scroll="handleScroll">
    <div ref="logContainer" class="log-container">
      <div
        v-for="(entry, index) in logEntries"
        :key="index"
        class="log-entry"
        :class="`log-${entry.type}`"
      >
        <span class="log-time">[{{ entry.time }}]</span>
        {{ entry.message }}
      </div>
    </div>
  </n-scrollbar>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { logEntries } from '../composables/useBridge.js'

const scrollbarRef = ref(null)
const logContainer = ref(null)
const autoScroll = ref(true)

function handleScroll() {
  // 检测是否在底部
  if (scrollbarRef.value) {
    const el = scrollbarRef.value.$el?.querySelector('.n-scrollbar-content')
    if (el) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
      autoScroll.value = atBottom
    }
  }
}

// 新日志自动滚动到底部
watch(logEntries, async () => {
  if (autoScroll.value) {
    await nextTick()
    if (scrollbarRef.value) {
      scrollbarRef.value.scrollTo({ top: 999999 })
    }
  }
}, { deep: true })
</script>

<style scoped>
.log-container {
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.log-entry {
  padding: 1px 0;
  white-space: nowrap;
}

.log-entry.log-info {
  color: var(--text-secondary);
}

.log-entry.log-note-on {
  color: #66bb6a;
}

.log-entry.log-note-off {
  color: #ef5350;
}

.log-entry.log-error {
  color: #ef5350;
  font-weight: 600;
}

.log-entry .log-time {
  color: rgba(255, 255, 255, 0.3);
  margin-right: 8px;
}
</style>
