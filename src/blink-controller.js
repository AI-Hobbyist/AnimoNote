/**
 * AnimoNote - 随机眨眼控制器
 * 
 * 通过控制 MMD 模型的「まばたき」(眨眼) 形态键 (morph) 实现随机眨眼。
 * 眨眼间隔随机（2-6 秒），眨眼持续时间约 100-150ms。
 * 可在 config.json 中启用/禁用。
 */

class BlinkController {
    /**
     * @param {THREE.SkinnedMesh} model - MMD 模型
     * @param {Object} [options] - 配置选项
     * @param {boolean} [options.enabled=true] - 是否启用眨眼
     * @param {number} [options.minInterval=2000] - 最小眨眼间隔 (ms)
     * @param {number} [options.maxInterval=6000] - 最大眨眼间隔 (ms)
     * @param {number} [options.blinkDuration=120] - 眨眼持续时间 (ms)
     */
    constructor(model, options = {}) {
        this.model = model;
        this.enabled = options.enabled !== undefined ? options.enabled : true;
        this.minInterval = options.minInterval || 2000;
        this.maxInterval = options.maxInterval || 6000;
        this.blinkDuration = options.blinkDuration || 120;

        this._morphIndex = -1;
        this._timer = null;
        this._isBlinking = false;
        this._morphWeight = 0;

        // 查找眨眼 morph
        this._findBlinkMorph();
    }

    /**
     * 查找模型的「まばたき」morph
     * MMD 标准命名: "まばたき" (日文) 或 "blink" / "eyeBlink"
     */
    _findBlinkMorph() {
        if (!this.model || !this.model.morphTargetInfluences) {
            console.warn('[Blink] Model has no morph targets');
            return;
        }

        const morphNames = [
            'まばたき', ' blink', 'blink', 'eyeBlink', 'eye_blink',
            'EyeBlink', 'Blink', 'まばたき_L', 'まばたき_R',
        ];

        // 遍历模型的 morph targets
        if (this.model.morphTargetDictionary) {
            for (const name of morphNames) {
                if (name in this.model.morphTargetDictionary) {
                    this._morphIndex = this.model.morphTargetDictionary[name];
                    console.log(`[Blink] Found blink morph: "${name}" (index: ${this._morphIndex})`);
                    return;
                }
            }
        }

        // 如果没找到标准命名，尝试搜索包含"目"或"eye"的 morph
        if (this.model.morphTargetDictionary) {
            for (const [name, index] of Object.entries(this.model.morphTargetDictionary)) {
                if (name.includes('目') || name.includes('eye') || name.includes('Eye')) {
                    this._morphIndex = index;
                    console.log(`[Blink] Found eye morph: "${name}" (index: ${this._morphIndex})`);
                    return;
                }
            }
        }

        console.warn('[Blink] No blink morph found on model');
    }

    /**
     * 开始随机眨眼
     */
    start() {
        if (!this.enabled || this._morphIndex === -1) {
            return;
        }
        this._scheduleNextBlink();
    }

    /**
     * 停止眨眼
     */
    stop() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        // 确保眼睛睁开
        this._setBlinkWeight(0);
        this._isBlinking = false;
    }

    /**
     * 安排下一次眨眼
     */
    _scheduleNextBlink() {
        if (!this.enabled || this._morphIndex === -1) return;

        const interval = this.minInterval + Math.random() * (this.maxInterval - this.minInterval);
        this._timer = setTimeout(() => {
            this._doBlink();
        }, interval);
    }

    /**
     * 执行一次眨眼动画
     * 
     * 时间线:
     *   t=0ms      → morph weight = 0 (睁眼)
     *   t=0-30ms   → morph weight 0→1 (闭眼)
     *   t=30-90ms  → morph weight = 1 (闭眼保持)
     *   t=90-120ms → morph weight 1→0 (睁眼)
     */
    _doBlink() {
        if (this._isBlinking || this._morphIndex === -1) return;
        this._isBlinking = true;

        const halfClose = this.blinkDuration * 0.25;   // 30ms 闭眼
        const hold = this.blinkDuration * 0.5;          // 60ms 保持
        const halfOpen = this.blinkDuration * 0.25;     // 30ms 睁眼

        // 阶段 1: 闭眼 (0 → 1)
        this._animateMorph(0, 1, halfClose, () => {
            // 阶段 2: 保持闭眼
            setTimeout(() => {
                // 阶段 3: 睁眼 (1 → 0)
                this._animateMorph(1, 0, halfOpen, () => {
                    this._isBlinking = false;
                    this._scheduleNextBlink();
                });
            }, hold);
        });
    }

    /**
     * 动画化 morph weight
     * @param {number} from - 起始值
     * @param {number} to - 目标值
     * @param {number} duration - 持续时间 (ms)
     * @param {Function} onComplete - 完成回调
     */
    _animateMorph(from, to, duration, onComplete) {
        const startTime = performance.now();

        const animate = () => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);

            // ease-in-out 缓动
            const eased = t < 0.5
                ? 2 * t * t
                : 1 - Math.pow(-2 * t + 2, 2) / 2;

            this._setBlinkWeight(from + (to - from) * eased);

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                this._setBlinkWeight(to);
                if (onComplete) onComplete();
            }
        };

        animate();
    }

    /**
     * 设置 morph weight
     * @param {number} weight - 0 (睁眼) ~ 1 (闭眼)
     */
    _setBlinkWeight(weight) {
        if (this._morphIndex === -1 || !this.model.morphTargetInfluences) return;
        this.model.morphTargetInfluences[this._morphIndex] = weight;
        this._morphWeight = weight;
    }

    /**
     * 更新配置（运行时）
     * @param {Object} options
     * @param {boolean} options.enabled
     */
    updateOptions(options) {
        if (options.enabled !== undefined) {
            this.enabled = options.enabled;
            if (this.enabled) {
                this.start();
            } else {
                this.stop();
            }
        }
    }

    /**
     * 销毁控制器
     */
    dispose() {
        this.stop();
        this._setBlinkWeight(0);
        this.model = null;
    }
}

// ES module 导出（供 import() 使用）
export { BlinkController };

// CommonJS 导出（兼容 require）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BlinkController };
}
