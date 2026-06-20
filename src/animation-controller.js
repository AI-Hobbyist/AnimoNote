/**
 * AnimoNote - 动画控制器（无泄漏版）
 * 
 * 核心设计原则：永不反复 remove/add 同一模型，避免 Ammo.js WASM 内存泄漏。
 * 
 * 问题背景：
 * MMDAnimationHelper.remove() + add() 循环会导致内部 physics 对象无法正确释放，
 * Ammo.js WASM heap 逐渐耗尽，最终 "Cannot enlarge memory arrays"。
 * 
 * 解决方案：
 * 1. 触发新动画时绝不 remove 旧的 — 直接 add 新的，Helper 自动 blend 过渡
 * 2. 旧动画在后台自然播放完毕，weight 归零后不再影响骨骼
 * 3. 定期批量清理已完成的动画（调用 helper.remove() 集中处理，减少频率）
 * 4. 防抖 + 最大活跃数限制，防止无限堆积
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
        this.mmdLoader = new window.MMDLoader();

        // 配置
        this.MIN_TRIGGER_INTERVAL = 20;   // 最小触发间隔 (ms)
        this.DEFAULT_FADE_DURATION = 0.1;  // 默认淡入淡出时长 (s)
        this.DEFAULT_FADE_OUT = 0.05;      // 默认淡出时间 (s)
        this.MAX_ACTIVE_ANIMATIONS = 32;   // 最大并行动画数，防止无限堆积
        this.CLEANUP_INTERVAL = 3000;      // 批量清理间隔 (ms)

        // 回调
        this.onAnimationStart = null;  // function(noteName, vmdPath)
        this.onAnimationEnd = null;    // function(noteName)

        // 保存骨骼初始姿态，用于动画切换时复位防止物理鬼畜
        this._initialBoneData = [];
        if (model && model.skeleton) {
            for (const bone of model.skeleton.bones) {
                this._initialBoneData.push({
                    position: bone.position.clone(),
                    quaternion: bone.quaternion.clone(),
                    scale: bone.scale.clone(),
                });
            }
        }

        // 从 mixer 获取待机动画 action，用于触发时压低/恢复
        this._idleAction = this._findIdleAction();

        // 上一个音符的淡出时长，供下一个音符淡入使用
        this._lastFadeOut = 0;

        // 上次清理时间戳
        this._lastCleanupTime = performance.now();

        // 统计
        this.stats = {
            totalTriggers: 0,
            retriggers: 0,
            hardResets: 0,
            smoothRestarts: 0,
            cleanupRuns: 0,
            cleanedUp: 0,
        };
    }

    // ============================================================
    // 公开 API
    // ============================================================

    /**
     * 触发音符对应的 VMD 动作
     */
    triggerNote(noteName, vmdPath, fadeDuration = this.DEFAULT_FADE_DURATION, retriggerMode = 'reset', isFallback = false, playMode = 'once', fadeMode = 'fixed', bpm = 120, fadeOut) {
        const now = performance.now();

        // 防抖保护
        const lastTime = this.lastTriggerTime.get(noteName) || 0;
        if (now - lastTime < this.MIN_TRIGGER_INTERVAL) return false;
        this.lastTriggerTime.set(noteName, now);

        this.stats.totalTriggers++;

        // 根据淡化模式计算实际过渡时长
        // 节拍模式：淡入时长 = 上一个音符的淡出时长（保证前后过渡对称）
        const actualFade = fadeMode === 'bpm'
            ? Math.max(0.02, this._lastFadeOut || Math.min(fadeDuration, 0.08))
            : fadeDuration;

        // 触发前先清理已完成动画（批量，非每次触发都清理）
        this._cleanupCompleted(now);

        const existing = this.activeAnimations.get(noteName);

        if (existing) {
            this.stats.retriggers++;
            if (retriggerMode === 'smooth') {
                this.stats.smoothRestarts++;
                this._doRetriggerSmooth(existing, vmdPath, actualFade, playMode, fadeMode, bpm, fadeOut);
            } else {
                this.stats.hardResets++;
                this._doRetriggerHard(existing, vmdPath, actualFade, playMode, fadeMode, bpm, fadeOut);
            }
        } else {
            this._startNew(noteName, vmdPath, actualFade, playMode, fadeMode, bpm, fadeOut);
        }

        if (this.onAnimationStart) this.onAnimationStart(noteName, vmdPath);

        if (isFallback) this._scheduleFallbackRelease(noteName);

        return true;
    }

    /**
     * 释放音符（Note Off 或超时）— 淡出完成后才释放 action
     */
    releaseNote(noteName, fadeOutTime = this.DEFAULT_FADE_OUT) {
        const existing = this.activeAnimations.get(noteName);
        if (!existing) return;

        // 根据模式计算淡出时长
        let actualFade = fadeOutTime;
        if (existing.fadeMode === 'bpm' && existing.bpm) {
            const beatLen = 60 / existing.bpm;
            const beats = existing.noteBeats || 1.0;
            actualFade = Math.max(0.02, beats * beatLen);
        } else if (existing.fadeMode === 'fixed' && existing.noteFadeOut !== undefined) {
            actualFade = existing.noteFadeOut;
        }

        // 记录淡出日志，并保存供下一个音符淡入使用
        this._lastFadeOut = actualFade;
        const beatInfo = existing.noteBeats ? ` | beats: ${existing.noteBeats.toFixed(2)}` : '';
        console.log(`[Animation] Release: ${noteName} | fadeOut: ${actualFade.toFixed(3)}s${beatInfo}`);

        // 标记为"淡出中"，防止被重触发时的清理误删
        existing.fadingOut = true;

        // 先开始淡出，让 animation mixer 完成淡出过程
        if (existing.action) {
            existing.action.fadeOut(actualFade);
        }

        // 安排淡出完成后的清理
        const fadeMs = Math.max(16, actualFade * 1000);
        this._pendingCleanups = this._pendingCleanups || new Map();
        if (this._pendingCleanups.has(noteName)) {
            clearTimeout(this._pendingCleanups.get(noteName));
        }
        this._pendingCleanups.set(noteName, setTimeout(() => {
            this._pendingCleanups.delete(noteName);
            // 检查是否已被重触发取代（重触发会删除旧的 state）
            const current = this.activeAnimations.get(noteName);
            if (current !== existing) return; // 已被新动画取代，跳过清理

            // 淡出完成，真正释放资源
            try {
                if (existing.action) existing.action.stop();
                if (existing.vmdAsset?.dispose) existing.vmdAsset.dispose();
            } catch (e) { /* ignore */ }
            this.activeAnimations.delete(noteName);

            // 没有活跃的触发动画了 → 恢复待机动画
            if (this.activeAnimations.size === 0) {
                this._restoreIdle();
            }
        }, fadeMs));

        if (this.onAnimationEnd) this.onAnimationEnd(noteName);
    }

    /**
     * 释放所有活跃动画
     */
    releaseAll(fadeOutTime = this.DEFAULT_FADE_OUT) {
        for (const [noteName] of this.activeAnimations) {
            this.releaseNote(noteName, fadeOutTime);
        }
    }

    /**
     * 销毁控制器
     */
    dispose() {
        for (const [, state] of this.activeAnimations) {
            try {
                if (state.action) state.action.stop();
                if (state.vmdAsset?.dispose) state.vmdAsset.dispose();
            } catch (e) { /* ignore */ }
        }
        this.activeAnimations.clear();
        this.lastTriggerTime.clear();
        this.pendingLoads.clear();
        if (this._fallbackTimers) {
            for (const t of this._fallbackTimers.values()) clearTimeout(t);
            this._fallbackTimers.clear();
        }
        if (this._pendingCleanups) {
            for (const t of this._pendingCleanups.values()) clearTimeout(t);
            this._pendingCleanups.clear();
        }
        this.mmdLoader = null;
    }

    // ============================================================
    // 核心逻辑
    // ============================================================

    /**
     * 硬重触发：立即停掉旧动画，从第 0 帧重新播放
     */
    _doRetriggerHard(existing, vmdPath, fadeDuration, playMode, fadeMode = 'fixed', bpm = 120, fadeOut) {
        if (existing.action) existing.action.stop();
        if (existing.vmdAsset?.dispose) existing.vmdAsset.dispose();
        this.activeAnimations.delete(existing.noteName);
        this._resetPhysics();
        this._loadAndPlay(existing.noteName, vmdPath, fadeDuration, 0, playMode, fadeMode, bpm, fadeOut);
    }

    /**
     * 平滑重触发：淡出旧动画，淡入新动画
     */
    _doRetriggerSmooth(existing, vmdPath, fadeDuration, playMode, fadeMode = 'fixed', bpm = 120, fadeOut) {
        if (existing.action) existing.action.fadeOut(fadeDuration);
        this.activeAnimations.delete(existing.noteName);
        this._resetPhysics();
        this._loadAndPlay(existing.noteName, vmdPath, fadeDuration, 0, playMode, fadeMode, bpm, fadeOut);
    }

    /**
     * 首次触发
     */
    _startNew(noteName, vmdPath, fadeDuration, playMode, fadeMode = 'fixed', bpm = 120, fadeOut) {
        this._resetPhysics();
        this._loadAndPlay(noteName, vmdPath, fadeDuration, 0, playMode, fadeMode, bpm, fadeOut);
    }

    /**
     * 批量清理已完成/待释放的动画
     * 
     * 这是关键：把多次 remove 操作集中到一起执行，
     * 避免每次触发都 remove+add 导致 Ammo.js 内部对象泄漏。
     */
    _cleanupCompleted(now) {
        if (now - this._lastCleanupTime < this.CLEANUP_INTERVAL) return;
        this._lastCleanupTime = now;

        let cleaned = 0;
        for (const [noteName, state] of this.activeAnimations) {
            if (!state.action) continue;

            if (state.pendingRelease) {
                try {
                    const fade = state.releaseFadeTime ?? 0;
                    state.action.fadeOut(fade);
                    state.action.stop();
                    if (state.vmdAsset?.dispose) state.vmdAsset.dispose();
                } catch (e) { /* ignore */ }
                this.activeAnimations.delete(noteName);
                cleaned++;
            }
        }

        // 超过最大活跃数时强制淘汰最旧的
        if (this.activeAnimations.size > this.MAX_ACTIVE_ANIMATIONS) {
            const entries = [...this.activeAnimations.entries()];
            const toRemove = entries.slice(0, this.activeAnimations.size - this.MAX_ACTIVE_ANIMATIONS);
            for (const [noteName, state] of toRemove) {
                try {
                    state.action.stop();
                    if (state.vmdAsset?.dispose) state.vmdAsset.dispose();
                } catch (e) { /* ignore */ }
                this.activeAnimations.delete(noteName);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.stats.cleanupRuns++;
            this.stats.cleanedUp += cleaned;
        }
    }

    // ============================================================
    // Fallback 释放
    // ============================================================

    _scheduleFallbackRelease(noteName, duration = 200) {
        if (this._fallbackTimers?.has(noteName)) {
            clearTimeout(this._fallbackTimers.get(noteName));
        }
        if (!this._fallbackTimers) this._fallbackTimers = new Map();

        const timer = setTimeout(() => {
            this.releaseNote(noteName, 0.05);
            this._fallbackTimers.delete(noteName);
        }, duration);
        this._fallbackTimers.set(noteName, timer);
    }

    // ============================================================
    // 物理复位
    // ============================================================

    _resetPhysics() {
        try {
            if (this.model && this.model.skeleton && this._initialBoneData.length > 0) {
                const bones = this.model.skeleton.bones;
                for (let i = 0; i < bones.length && i < this._initialBoneData.length; i++) {
                    const init = this._initialBoneData[i];
                    bones[i].position.copy(init.position);
                    bones[i].quaternion.copy(init.quaternion);
                    bones[i].scale.copy(init.scale);
                }
                this.model.skeleton.update();
            }
            const physics = this.helper.physicsMap?.get(this.model);
            if (physics && typeof physics.reset === 'function') {
                physics.reset();
            }
        } catch (e) { /* 物理重置失败不影响主流程 */ }
    }

    // ============================================================
    // VMD 加载 & 播放
    // ============================================================

    async _loadAndPlay(noteName, vmdPath, fadeDuration, startFrame, playMode = 'once', fadeMode = 'fixed', bpm = 120, fadeOut) {
        if (this.pendingLoads.has(noteName)) return;

        try {
            this.pendingLoads.set(noteName, true);
            const vmdAsset = await this._loadVmdAsync(vmdPath);
            if (!this.pendingLoads.has(noteName)) return; // 被取消

            // 通过 helper 内部的 AnimationMixer 直接播放，绕过 _addMesh 限制
            // MMDAnimationHelper.add() 对 SkinnedMesh 永远调用 _addMesh()，
            // 而已注册的模型再次 _addMesh 会抛错。这里直接操作 mixer。
            let mixer = this._getMixer();
            if (!mixer) {
                // ★ 待机动画尚未 loaded（helper.add 未执行），直接创建 mixer
                try {
                    const THREE = window.THREE;
                    mixer = new THREE.AnimationMixer(this.model);
                    if (!this.helper.objects) this.helper.objects = new Map();
                    this.helper.objects.set(this.model, { mixer });
                    console.log('[Animation] Created mixer on demand for', noteName);
                } catch (e) {
                    console.warn('[Animation] Cannot create mixer for', noteName, ':', e.message);
                    return;
                }
            }

            // 压低待机动画，避免叠加
            this._suppressIdle(fadeDuration);

            // 创建 AnimationAction 并播放
            const action = mixer.clipAction(vmdAsset);
            action.reset();
            action.fadeIn(fadeDuration);
            if (playMode === 'loop') {
                action.loop = window.THREE.LoopRepeat; // 循环播放
            } else {
                action.loop = window.THREE.LoopOnce;   // 只播放一次
                action.clampWhenFinished = true;        // 结束后停在最后一帧
            }
            action.play();

            // 设置起始帧
            if (startFrame > 0) {
                action.time = startFrame / 30; // 假设 30fps
            }

            const state = {
                noteName,
                vmdAsset,
                action,
                startTime: performance.now(),
                isPlaying: true,
                pendingRelease: false,
                releaseFadeTime: 0,
            };

            state.fadeMode = fadeMode;
            state.bpm = bpm;
            state.noteBeats = noteName === '_fallback_' ? 0.25 : 1.0;
            if (fadeOut !== undefined) state.noteFadeOut = fadeOut;
            this.activeAnimations.set(noteName, state);
            console.log(`[Animation] Playing: ${noteName} → ${vmdPath} | fadeIn: ${fadeDuration.toFixed(3)}s | playMode: ${playMode} | fadeMode: ${fadeMode}${fadeMode === 'bpm' ? ` | BPM: ${bpm}` : ''}`);

        } catch (err) {
            console.error(`[Animation] Failed to load VMD for ${noteName}: ${err.message}`);
        } finally {
            this.pendingLoads.delete(noteName);
        }
    }

    /**
     * 获取 helper 内部为当前模型创建的 AnimationMixer
     */
    _getMixer() {
        try {
            const entry = this.helper.objects?.get(this.model);
            return entry ? entry.mixer : null;
        } catch (e) {
            return null;
        }
    }

    // ============================================================
    // 待机动画管理（防止触发动画与 idle 叠加）
    // ============================================================

    /**
     * 查找 mixer 上正在播放的待机动画 action
     */
    _findIdleAction() {
        try {
            const mixer = this._getMixer();
            if (!mixer || !mixer._actions) return null;
            // 取第一个正在运行的 action 作为 idle
            for (const action of mixer._actions) {
                if (action.isRunning()) return action;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 淡化待机动画，防止与触发动画叠加
     */
    _suppressIdle(fadeDuration) {
        // 每次触发前重新查找 idle（可能已被之前的操作停掉）
        const idle = this._findIdleAction();
        if (idle) {
            idle.fadeOut(fadeDuration);
        }
    }

    /**
     * 恢复待机动画（所有触发动画都释放后调用）
     */
    _restoreIdle() {
        try {
            const mixer = this._getMixer();
            if (!mixer) return;

            // 查找已被淡出的 idle action 并恢复
            const idle = this._findIdleAction();
            if (idle) {
                idle.reset();
                idle.fadeIn(0.3);
                idle.play();
            }
        } catch (e) { /* ignore */ }
    }

    /**
     * Promise 化的 VMD 加载
     */
    _loadVmdAsync(vmdPath) {
        return new Promise((resolve, reject) => {
            this.mmdLoader.loadAnimation(
                vmdPath,
                this.model,  // 传入 model，MMDLoader 需要它来判断动画类型
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

}

// 导出
export { AnimationController };
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AnimationController };
}
