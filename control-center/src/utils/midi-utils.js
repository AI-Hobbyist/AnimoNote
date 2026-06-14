/**
 * MIDI 音符转换工具
 */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const ALL_NOTES = []
for (let octave = 0; octave <= 8; octave++) {
  for (const name of NOTE_NAMES) {
    ALL_NOTES.push(`${name}${octave}`)
  }
}
