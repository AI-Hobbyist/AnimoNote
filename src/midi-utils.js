/**
 * AnimoNote - MIDI 音符转换工具
 * 
 * 提供 MIDI Note 编号 (0-127) 与标准音名 (如 "C4", "F#3") 之间的双向转换。
 * 支持降调别名 (如 "Bb" → "A#") 的自动归一化。
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * 降调 → 升调 映射表
 * 用户配置中可能使用 "Bb" 而非 "A#"，需要归一化
 */
const FLAT_TO_SHARP = {
    'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'
};

/**
 * 将 MIDI Note 编号 (0-127) 转换为标准音名
 * 
 * @param {number} midiNote - MIDI 音符编号 (0-127)
 * @returns {string} 标准音名，如 "C4", "F#3", "A#5"
 * @throws {Error} 如果 midiNote 超出范围
 * 
 * @example
 * midiNoteToName(60)  // → "C4"
 * midiNoteToName(61)  // → "C#4"
 * midiNoteToName(0)   // → "C-1"
 * midiNoteToName(127) // → "G9"
 */
function midiNoteToName(midiNote) {
    if (midiNote < 0 || midiNote > 127) {
        throw new Error(`Invalid MIDI note number: ${midiNote}. Must be 0-127.`);
    }

    const octave = Math.floor(midiNote / 12) - 1;
    const noteIndex = midiNote % 12;

    return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * 将标准音名转换回 MIDI Note 编号
 * 
 * @param {string} noteName - 标准音名，如 "C4", "F#3", "Bb2"
 * @returns {number} MIDI 音符编号 (0-127)
 * @throws {Error} 如果音名格式无效
 * 
 * @example
 * nameToMidiNote("C4")   // → 60
 * nameToMidiNote("C#4")  // → 61
 * nameToMidiNote("Bb2")  // → 34 (自动归一化为 A#2)
 * nameToMidiNote("G9")   // → 127
 */
function nameToMidiNote(noteName) {
    // 先归一化降调别名
    const normalized = normalizeNoteName(noteName);

    const match = normalized.match(/^([A-G]#?)(-?\d+)$/);
    if (!match) {
        throw new Error(`Invalid note name: "${noteName}". Expected format like "C4", "F#3", "Bb2".`);
    }

    const [, name, octaveStr] = match;
    const octave = parseInt(octaveStr, 10);
    const noteIndex = NOTE_NAMES.indexOf(name);

    if (noteIndex === -1) {
        throw new Error(`Unknown note: "${name}" in "${noteName}". Valid notes: C, C#, D, D#, E, F, F#, G, G#, A, A#, B`);
    }

    const midiNote = (octave + 1) * 12 + noteIndex;

    if (midiNote < 0 || midiNote > 127) {
        throw new Error(`Note "${noteName}" maps to MIDI ${midiNote}, which is out of range (0-127).`);
    }

    return midiNote;
}

/**
 * 归一化音名：将降调别名转换为升调
 * 例如 "Bb2" → "A#2", "Eb4" → "D#4"
 * 
 * @param {string} noteName - 原始音名
 * @returns {string} 归一化后的音名
 * 
 * @example
 * normalizeNoteName("Bb2")  // → "A#2"
 * normalizeNoteName("C#4")  // → "C#4" (不变)
 * normalizeNoteName("C4")   // → "C4" (不变)
 */
function normalizeNoteName(noteName) {
    for (const [flat, sharp] of Object.entries(FLAT_TO_SHARP)) {
        if (noteName.includes(flat)) {
            return noteName.replace(flat, sharp);
        }
    }
    return noteName;
}

/**
 * 获取 MIDI Note 的八度
 * 
 * @param {number} midiNote - MIDI 音符编号
 * @returns {number} 八度数
 */
function getOctave(midiNote) {
    return Math.floor(midiNote / 12) - 1;
}

/**
 * 获取 MIDI Note 的音名索引 (0-11)
 * 0=C, 1=C#, 2=D, ..., 11=B
 * 
 * @param {number} midiNote - MIDI 音符编号
 * @returns {number} 音名索引
 */
function getNoteIndex(midiNote) {
    return midiNote % 12;
}

/**
 * 检查音名是否有效
 * 
 * @param {string} noteName - 待检查的音名
 * @returns {boolean} 是否有效
 */
function isValidNoteName(noteName) {
    try {
        nameToMidiNote(noteName);
        return true;
    } catch {
        return false;
    }
}

/**
 * 将音符持续毫秒数 + BPM 转换为标准节拍信息
 * 
 * @param {number} durationMs - 音符持续毫秒数
 * @param {number} bpm - 每分钟拍数
 * @returns {{ beats: number, type: string }}
 */
function calculateBeatsFromTime(durationMs, bpm) {
    const msPerBeat = 60000 / bpm;
    const beats = durationMs / msPerBeat;

    let type = '未知';
    if (Math.abs(beats - 4.0) < 0.2) type = '𝅝 全音符';
    else if (Math.abs(beats - 2.0) < 0.1) type = '𝅗𝅥 二分音符';
    else if (Math.abs(beats - 1.0) < 0.05) type = '♩ 四分音符';
    else if (Math.abs(beats - 0.5) < 0.03) type = '♪ 八分音符';
    else if (Math.abs(beats - 0.25) < 0.02) type = '♬ 十六分音符';
    else if (Math.abs(beats - 0.125) < 0.01) type = '𝅘𝅥𝅯 三十二分音符';
    else if (beats > 0) type = '🎜 切分音';

    return { beats: parseFloat(beats.toFixed(3)), type };
}

// 导出
export {
    midiNoteToName,
    nameToMidiNote,
    normalizeNoteName,
    getOctave,
    getNoteIndex,
    isValidNoteName,
    calculateBeatsFromTime,
    NOTE_NAMES,
};
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        midiNoteToName,
        nameToMidiNote,
        normalizeNoteName,
        getOctave,
        getNoteIndex,
        isValidNoteName,
        NOTE_NAMES,
    };
}
