/**
 * AnimoNote - 动画控制器（含 Retrigger 机制）
 * 
 * 核心职责：
 * 1. 接收 MIDI 音符触发，播放对应的 VMD 动作
 * 2. 实现 Retrigger 双模式：reset（硬重置）和 smooth（平滑重启）
 * 3. 管理动画生命周期：触发 → 播放 → 释放
 * 4. 防抖保护：防止密集触发导致性能问题
 */

class AnimationController {
    /**
     * @param {THREE.MMDAnimationHelper} helper - MMD 动画助手
     * @param {THREE.SkinnedMesh} model - MMD 模型
     */
    constructor(helper, model) {
        this.helper = helper;
        this.model = model;

        /** @type {Map<string, AnimationState>} 当前活跃的动画 */
        this.activeAnimations = new Map();

        /** @type {Map<string, number>} 上次触发时间戳（防抖） */
        this.lastTriggerTime = new Map();

        /** @type {Map<string, number>} 动画加载中的 Promise */
        this.pendingLoads = new Map();

        /** @type {MMDLoader} */
        this.mmdLoader = new THREE.MMDLoader();

        // 配置
        this.MIN_TRIGGER_INTERVAL = 20;  // 最小触发间隔 (ms)
        this.DEFAULT_BLEND_TIME = 0.1;   // 默认混合时间 (s)
        this.DEFAULT_FADE_OUT = 0.05;    // 默认淡出时间 (s)

        // 回调
        this.onAnimationStart = null;  // function(noteName, vmdPath)
        this.onAnimationEnd = null;    // function(noteName)

        // 统计
        this.stats = {
            totalTriggers: 0,
            retriggers: 0,
            hardResets: 0,
            smoothRestarts: 0,
        };
    }

    /**
     * 触发音符对应的 VMD 动作
     *
     * @param {string} noteName - 音名 (如 "C3", "F#4")
     * @param {string} vmdPath - VMD 动作文件路径
     * @param {number} [blendTime=0.1] - 动画混合时间（秒）
     * @param {string} [retriggerMode='reset'] - 重触发模式: "reset" | "smooth"
     * @param {boolean} [isFallback=false] - 是否为 fallback 触发（无映射的音符）
     *
     * @returns {boolean} 是否成功触发
     */
    triggerNote(noteName, vmdPath, blendTime = this.DEFAULT_BLEND_TIME, retriggerMode = 'reset', isFallback = false) {
        // ★ 防抖保护：防止 16 分音符连续触发导致性能问题
        const now = performance.now();
        const lastTime = this.lastTriggerTime.get(noteName) || 0;
        if (now - lastTime < this.MIN_TRIGGER_INTERVAL) {
            return false;  // 过于密集，丢弃本次触发
        }
        this.lastTriggerTime.set(noteName, now);

        this.stats.totalTriggers++;

        const existing = this.activeAnimations.get(noteName);

        if (existing) {
            // ★ 同一音符正在播放 → 执行 Retrigger
            this.stats.retriggers++;

            switch (retriggerMode) {
                case 'reset':
                    this.stats.hardResets++;
                    this._hardReset(existing, vmdPath, blendTime);
                    break;
                case 'smooth':
                    this.stats.smoothRestarts++;
                    this._smoothRestart(existing, vmdPath, blendTime);
                    break;
                default:
                    this._hardReset(existing, vmdPath, blendTime);
            }
        } else {
            // 首次触发 → 正常播放
            this._startNew(noteName, vmdPath, blendTime);
        }

        if (this.onAnimationStart) {
            this.onAnimationStart(noteName, vmdPath);
        }

        // ★ Fallback 自动超时释放：如果是 fallback 动作，200ms 后自动回到 idle
        if (isFallback) {
            this._scheduleFallbackRelease(noteName);
        }

        return true;
    }

    /**
     * 安排 fallback 动作的自动释放
     * fallback 动作短暂闪烁后自动回到 idle，避免一直卡在 idle 动作上
     *
     * @param {string} noteName - 音名
     * @param {number} [duration=200] - fallback 持续时间（毫秒）
     */
    _scheduleFallbackRelease(noteName, duration = 200) {
        // 清除之前的定时器
        if (this._fallbackTimers && this._fallbackTimers.has(noteName)) {
            clearTimeout(this._fallbackTimers.get(noteName));
        }

        if (!this._fallbackTimers) {
            this._fallbackTimers = new Map();
        }

        const timer = setTimeout(() => {
            this.releaseNote(noteName, 0.05);
            this._fallbackTimers.delete(noteName);
        }, duration);

        this._fallbackTimers.set(noteName, timer);
    }

    /**
     * 释放音符（Note Off 或超时）
     * 
     * @param {string} noteName - 音名
     * @param {number} [fadeOutTime=0.1] - 淡出时间（秒）
     */
    releaseNote(noteName, fadeOutTime = this.DEFAULT_FADE_OUT) {
        const existing = this.activeAnimations.get(noteName);
        if (!existing) return;

        // 淡出后移除
        this.helper.remove(this.model, existing.vmdAsset, fadeOutTime);
        this.activeAnimations.delete(noteName);

        if (this.onAnimationEnd) {
            this.onAnimationEnd(noteName);
        }
    }

    /**
     * 释放所有活跃的动画
     * @param {number} [fadeOutTime=0.1]
     */
    releaseAll(fadeOutTime = this.DEFAULT_FADE_OUT) {
        for (const [noteName] of this.activeAnimations) {
            this.releaseNote(noteName, fadeOutTime);
        }
    }

    // ============================================================
    // Retrigger 模式实现
    // ============================================================

    /**
     * 模式 A: 硬重置 (Hard Reset)
     * 
     * 立即停止当前动画，将骨骼重置到第 0 帧，然后重新播放。
     * 适合：打击乐、鼓组、吉他扫弦等需要精确节拍的动作。
     * 
     * 视觉表现：瞬间跳回第 0 帧重新播放，无过渡。
     * 延迟：极低（< 1 帧）
     */
    _hardReset(existing, vmdPath, blendTime) {
        // 1. 立即停止当前动画
        this.helper.remove(this.model, existing.vmdAsset, 0);  // 0 = 立即停止

        // 2. 卸载旧的 VMD 资源
        if (existing.vmdAsset && existing.vmdAsset.dispose) {
            existing.vmdAsset.dispose();
        }

        // 3. 从活跃列表中移除旧状态
        this.activeAnimations.delete(existing.noteName);

        // 4. 加载并播放新动画（从第 0 帧开始）
        this._loadAndPlay(existing.noteName, vmdPath, blendTime, 0);
    }

    /**
     * 模式 B: 平滑重启 (Smooth Restart)
     * 
     * 不打断当前动画，而是快速淡出当前动作 + 淡入新动作。
     * 适合：舞蹈动作、旋律连奏、长音等需要视觉连续性的场景。
     * 
     * 视觉表现：当前动作快速淡出，新动作淡入，无缝过渡。
     * 延迟：较低（约 blendTime）
     */
    _smoothRestart(existing, vmdPath, blendTime) {
        // 1. 对当前动画设置快速淡出
        const fadeOutDuration = Math.min(blendTime, 0.05);  // 快速淡出
        this.helper.remove(this.model, existing.vmdAsset, fadeOutDuration);

        // 2. 从活跃列表中移除旧状态（但动画仍在淡出中）
        this.activeAnimations.delete(existing.noteName);

        // 3. 同时开始加载新动画，加载完成后淡入
        this._loadAndPlay(existing.noteName, vmdPath, blendTime, 0);
    }

    /**
     * 开始播放新动画（首次触发）
     */
    _startNew(noteName, vmdPath, blendTime) {
        this._loadAndPlay(noteName, vmdPath, blendTime, 0);
    }

    /**
     * 加载 VMD 并播放
     * 
     * @param {string} noteName - 音名
     * @param {string} vmdPath - VMD 文件路径
     * @param {number} blendTime - 混合时间
     * @param {number} startFrame - 起始帧（通常为 0）
     */
    async _loadAndPlay(noteName, vmdPath, blendTime, startFrame) {
        // 防止同一音符的重复加载
        if (this.pendingLoads.has(noteName)) {
            return;
        }

        try {
            this.pendingLoads.set(noteName, true);

            // 加载 VMD 动作
            const vmdAsset = await this._loadVmdAsync(vmdPath);

            // 检查是否已被新的触发取代
            if (!this.pendingLoads.has(noteName)) {
                // 已被取消（新的 hardReset 清除了 pendingLoads）
                return;
            }

            const state = {
                noteName,
                vmdAsset,
                startTime: performance.now(),
                isPlaying: true,
            };

            this.activeAnimations.set(noteName, state);

            // 使用 MMDAnimationHelper 播放
            this.helper.add(this.model, vmdAsset, {
                loop: false,           // 不循环（由 Note Off 或超时控制停止）
                animationBlend: true,  // 启用动画混合
                blendTime: blendTime,  // 混合时间
            });

            // 设置起始帧
            if (startFrame > 0) {
                this.helper.setAnimationTime(this.model, vmdAsset, startFrame);
            }

            console.log(`[Animation] Playing: ${noteName} → ${vmdPath} (blend: ${blendTime}s)`);

        } catch (err) {
            console.error(`[Animation] Failed to load VMD for ${noteName}: ${err.message}`);
        } finally {
            this.pendingLoads.delete(noteName);
        }
    }

    /**
     * Promise 化的 VMD 加载
     */
    _loadVmdAsync(vmdPath) {
        return new Promise((resolve, reject) => {
            this.mmdLoader.loadAnimation(
                vmdPath,
                null,  // 不需要 model，只加载动画数据
                (vmd) => resolve(vmd),
                null,
                (error) => reject(error)
            );
        });
    }

    // ============================================================
    // 工具方法
    // ============================================================

    /**
     * 获取当前活跃的音符列表
     * @returns {string[]}
     */
    getActiveNotes() {
        return Array.from(this.activeAnimations.keys());
    }

    /**
     * 检查指定音符是否正在播放
     * @param {string} noteName
     * @returns {boolean}
     */
    isNoteActive(noteName) {
        return this.activeAnimations.has(noteName);
    }

    /**
     * 获取统计信息
     * @returns {Object}
     */
    getStats() {
        return { ...this.stats, activeAnimations: this.activeAnimations.size };
    }

    /**
     * 销毁控制器，释放所有资源
     */
    dispose() {
        this.releaseAll(0);
        this.activeAnimations.clear();
        this.lastTriggerTime.clear();
        this.pendingLoads.clear();
        this.mmdLoader = null;
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AnimationController };
}
