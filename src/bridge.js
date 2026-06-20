import * as THREE from 'three';
import { AnimationController } from './animation-controller.js';
import { MidiHandler } from './midi-handler.js';
import { midiNoteToName, nameToMidiNote, calculateBeatsFromTime } from './midi-utils.js';

window.THREE = THREE;
window.midiNoteToName = midiNoteToName;
window.nameToMidiNote = nameToMidiNote;
window.calculateBeatsFromTime = calculateBeatsFromTime;
window.AnimationController = AnimationController;
window.MidiHandler = MidiHandler;
