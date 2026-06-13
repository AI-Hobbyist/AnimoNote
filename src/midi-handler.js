/**
 * AnimoNote - MIDI 处理器
 * 
 * 职责：
 * 1. 通过 Web MIDI API 连接 MIDI 输入设备
 * 2. 按配置的 MIDI 通道过滤消息
 * 3. 将 MIDI Note 编号转换为标准音名
 * 4. 触发对应的 Note On/Off 回调
 */

class MidiHandler {
    /**
     * @param {Object} config - 实例配置
     * @param {number} config.midi_channel - MIDI 通道 (1-16)
     * @param {Object} config.note_mappings - 音符映射表 { "C3": { vmd_path, ... } }
     * @param {Object} [options] - 可选配置
     * @param {boolean} [options.fallbackToIdle=true] - 未映射的音符是否 fallback 到 idle
     * @param {string} [options.idleVmdPath] - idle VMD 路径（fallback 时使用）
     */
    constructor(config, options = {}) {
        this.channel = config.midi_channel || 1;
        this.noteMappings = config.note_mappings || {};
        this.midiAccess = null;
        this.activeInputs = new Set();

        // ★ Fallback 配置
        this.fallbackToIdle = options.fallbackToIdle !== undefined ? options.fallbackToIdle : true;
        this.idleVmdPath = options.idleVmdPath || null;

        // 回调函数
        this.onNoteOn = null;   // function({ note, velocity, vmdPath, blendTime, retriggerMode, isFallback })
        this.onNoteOff = null;  // function({ note })

        // 统计
        this.stats = {
            totalMessages: 0,
            filteredOut: 0,
            notesTriggered: 0,
            fallbacks: 0,
        };
    }

    /**
     * 初始化 MIDI 连接
     * @returns {Promise<boolean>} 是否成功连接
     */
    async init() {
        try {
            this.midiAccess = await navigator.requestMIDIAccess();

            // 枚举所有 MIDI 输入
            for (const input of this.midiAccess.inputs.values()) {
                this._connectInput(input);
            }

            // 监听新设备连接/断开
            this.midiAccess.onstatechange = (event) => {
                if (event.port.type === 'input') {
                    if (event.port.state === 'connected') {
                        console.log(`[MIDI] Device connected: ${event.port.name}`);
                        this._connectInput(event.port);
                    } else if (event.port.state === 'disconnected') {
                        console.log(`[MIDI] Device disconnected: ${event.port.name}`);
                        this.activeInputs.delete(event.port.id);
                    }
                }
            };

            const inputCount = this.midiAccess.inputs.size;
            console.log(`[MIDI] Initialized. ${inputCount} input(s) available. Listening on channel ${this.channel}.`);
            return inputCount > 0;
        } catch (err) {
            console.error(`[MIDI] Failed to initialize: ${err.message}`);
            return false;
        }
    }

    /**
     * 连接一个 MIDI 输入设备
     * @param {MIDIInput} input - Web MIDI API 输入对象
     */
    _connectInput(input) {
        if (this.activeInputs.has(input.id)) return;

        input.onmidimessage = (event) => this._onMessage(event);
        this.activeInputs.add(input.id);

        console.log(`[MIDI] Listening on: ${input.name || input.id}`);
    }

    /**
     * 处理 MIDI 消息
     * @param {MIDIMessageEvent} event - MIDI 消息事件
     */
    _onMessage(event) {
        const data = event.data;
        if (!data || data.length < 3) return;

        const [status, note, velocity] = data;
        const messageChannel = (status & 0x0F) + 1;  // 提取 MIDI 通道 (1-16)
        const messageType = status & 0xF0;

        this.stats.totalMessages++;

        // ★ 核心：通道过滤 — 非本通道消息直接丢弃
        if (messageChannel !== this.channel) {
            this.stats.filteredOut++;
            return;
        }

        // Note On (0x90) 且 velocity > 0
        if (messageType === 0x90 && velocity > 0) {
            this._handleNoteOn(note, velocity);
        }
        // Note Off (0x80) 或 Note On with velocity = 0
        else if (messageType === 0x80 || (messageType === 0x90 && velocity === 0)) {
            this._handleNoteOff(note);
        }
    }

    /**
     * 处理 Note On 事件
     *
     * 行为：
     * - 如果音符有映射 → 播放对应的 VMD 动作
     * - 如果音符无映射 → fallback 到 idle 动作（短暂闪烁/呼吸，表示收到但无映射）
     *
     * @param {number} midiNote - MIDI 音符编号 (0-127)
     * @param {number} velocity - 力度 (0-127)
     */
    _handleNoteOn(midiNote, velocity) {
        // 转换为标准音名
        const noteName = midiNoteToName(midiNote);

        // 查找映射
        const mapping = this.noteMappings[noteName];

        if (!mapping) {
            // ★ 未映射的音符 → Fallback 到 idle
            this.stats.fallbacks++;

            if (this.fallbackToIdle && this.onNoteOn) {
                console.log(`[MIDI] Note On  ${noteName} (MIDI ${midiNote})  ⚠️ 无映射, fallback to idle`);

                this.onNoteOn({
                    note: noteName,
                    midiNote,
                    velocity,
                    vmdPath: this.idleVmdPath,     // 使用 idle 动作
                    blendTime: 0.05,                // 快速混合
                    retriggerMode: 'reset',
                    isFallback: true,                // ★ 标记为 fallback
                });
            }
            return;
        }

        this.stats.notesTriggered++;

        console.log(`[MIDI] Note On  ${noteName} (MIDI ${midiNote})  velocity=${velocity}  → ${mapping.description || mapping.vmd_path}`);

        if (this.onNoteOn) {
            this.onNoteOn({
                note: noteName,
                midiNote,
                velocity,
                vmdPath: mapping.vmd_path,
                blendTime: mapping.blend_time || 0.1,
                retriggerMode: mapping.retrigger_mode || 'reset',
                isFallback: false,
            });
        }
    }

    /**
     * 处理 Note Off 事件
     * @param {number} midiNote - MIDI 音符编号 (0-127)
     */
    _handleNoteOff(midiNote) {
        const noteName = midiNoteToName(midiNote);

        console.log(`[MIDI] Note Off ${noteName} (MIDI ${midiNote})`);

        if (this.onNoteOff) {
            this.onNoteOff({
                note: noteName,
                midiNote,
            });
        }
    }

    /**
     * 获取 MIDI 输入设备列表
     * @returns {Array<{id: string, name: string, manufacturer: string}>}
     */
    getInputDevices() {
        if (!this.midiAccess) return [];

        const devices = [];
        for (const input of this.midiAccess.inputs.values()) {
            devices.push({
                id: input.id,
                name: input.name || 'Unknown',
                manufacturer: input.manufacturer || 'Unknown',
            });
        }
        return devices;
    }

    /**
     * 获取统计信息
     * @returns {Object}
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * 销毁 MIDI 连接
     */
    dispose() {
        if (this.midiAccess) {
            for (const input of this.midiAccess.inputs.values()) {
                input.onmidimessage = null;
            }
            this.activeInputs.clear();
        }
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MidiHandler };
}
