const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = __dirname;

const controlCenterAPI = {
  scanModels: () => ipcRenderer.invoke('scan-models'),
  summonCharacter: (params) => ipcRenderer.invoke('summon-character', params),
  recallCharacter: (params) => ipcRenderer.invoke('recall-character', params),
  getSummonedCharacters: () => ipcRenderer.invoke('get-summoned-characters'),
  enterRehearsal: () => ipcRenderer.invoke('enter-rehearsal'),
  exitRehearsal: () => ipcRenderer.invoke('exit-rehearsal'),
  readMapping: (params) => ipcRenderer.invoke('read-mapping', params),
  saveMapping: (params) => ipcRenderer.invoke('save-mapping', params),
  scanVmdFiles: (params) => ipcRenderer.invoke('scan-vmd-files', params),
  readConfig: (params) => ipcRenderer.invoke('read-config', params),
  saveConfig: (params) => ipcRenderer.invoke('save-config', params),
  deleteModel: (params) => ipcRenderer.invoke('delete-model', params),
  scanPmxFiles: (params) => ipcRenderer.invoke('scan-pmx-files', params),
  createModel: (params) => ipcRenderer.invoke('create-model', params),
  getScreens: () => ipcRenderer.invoke('get-screens'),
  readSettings: () => ipcRenderer.invoke('read-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  readViewingConfig: () => ipcRenderer.invoke('read-viewing-config'),
  saveViewingConfig: (config) => ipcRenderer.invoke('save-viewing-config', config),
  updateCharacterConfig: (params) => ipcRenderer.send('update-character-config', params),
  updateMappings: (params) => ipcRenderer.send('update-mappings', params),
  onCharacterClosed: (callback) => { ipcRenderer.on('character-closed', (event, data) => callback(data)); },
  onCharacterStatus: (callback) => { ipcRenderer.on('character-status', (event, data) => callback(data)); },
  // MMD 观赏模式
  startViewingMode: (params) => ipcRenderer.send('start-viewing-mode', params),
  stopViewingMode: (params) => ipcRenderer.send('stop-viewing-mode', params),
  playViewingEntry: (params) => ipcRenderer.send('play-viewing-entry', params),
  stopViewingPlayback: () => ipcRenderer.send('stop-viewing-playback'),
  scanAudioFiles: (params) => ipcRenderer.invoke('scan-audio-files', params),
  // 文件浏览
  browseVmdFile: () => ipcRenderer.invoke('browse-vmd-file'),
  browseAudioFile: () => ipcRenderer.invoke('browse-audio-file'),
  // 进度控制
  seekViewingEntry: (params) => ipcRenderer.send('seek-viewing-entry', params),
  // 重置观看模式镜头
  resetViewingCamera: () => ipcRenderer.send('reset-viewing-camera'),
  // 实时更新观赏模式倍率
  updateViewingMultiplier: (params) => ipcRenderer.send('update-viewing-multiplier', params),
  // 摄像机状态
  onCameraStatus: (callback) => { ipcRenderer.on('camera-status', (event, data) => callback(data)); },
  // ============================================================
  // 摄像机模块
  // ============================================================
  getCameraConfig: () => ipcRenderer.invoke('get-camera-config'),
  saveCameraConfig: (params) => ipcRenderer.invoke('save-camera-config', params),
  readCameraMapping: () => ipcRenderer.invoke('read-camera-mapping'),
  saveCameraMapping: (params) => ipcRenderer.invoke('save-camera-mapping', params),
  scanCameraVmdFiles: () => ipcRenderer.invoke('scan-camera-vmd-files'),
  summonCamera: (params) => ipcRenderer.invoke('summon-camera', params),
  recallCamera: () => ipcRenderer.invoke('recall-camera'),
  getCameraStatus: () => ipcRenderer.invoke('get-camera-status'),
  updateCameraMappings: (params) => ipcRenderer.send('update-camera-mappings', params),
};

const sceneAPI = {
  sceneReady: () => ipcRenderer.send('scene-ready'),
  readFile: (filePath) => { try { return fs.readFileSync(filePath, 'utf-8'); } catch (err) { return null; } },
  existsSync: (filePath) => { try { return fs.existsSync(filePath); } catch { return false; } },
  resolvePath: (...segments) => path.resolve(...segments),
  saveCharacterPosition: (params) => ipcRenderer.invoke('save-character-position', params),
  setWindowIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  setWindowOpacity: (opacity) => ipcRenderer.send('set-window-opacity', opacity),
  getProjectRoot: () => PROJECT_ROOT,
  reportStatus: (status) => { ipcRenderer.send('character-status', status); },
  onSummonCharacter: (callback) => { ipcRenderer.on('scene-summon', (event, data) => callback(data)); },
  onRecallCharacter: (callback) => { ipcRenderer.on('scene-recall', (event, data) => callback(data)); },
  onRehearsalChange: (callback) => { ipcRenderer.on('scene-rehearsal', (event, data) => callback(data)); },
  onUpdateConfig: (callback) => { ipcRenderer.on('update-config', (event, data) => callback(data)); },
  onUpdateMappings: (callback) => { ipcRenderer.on('update-mappings', (event, data) => callback(data)); },
  // MMD 观赏模式
  onViewingModeChange: (callback) => { ipcRenderer.on('scene-viewing-mode', (event, data) => callback(data)); },
  onPlayViewingEntry: (callback) => { ipcRenderer.on('scene-play-viewing-entry', (event, data) => callback(data)); },
  onStopViewingPlayback: (callback) => { ipcRenderer.on('scene-stop-viewing-playback', (event) => callback()); },
  onSeekViewingEntry: (callback) => { ipcRenderer.on('scene-seek-viewing-entry', (event, data) => callback(data)); },
  // 重置观看模式镜头
  onResetViewingCamera: (callback) => { ipcRenderer.on('reset-viewing-camera', (event) => callback()); },
  // 实时更新观赏模式倍率
  onUpdateViewingMultiplier: (callback) => { ipcRenderer.on('scene-update-viewing-multiplier', (event, data) => callback(data)); },
  // 摄像机
  onCameraSummon: (callback) => { ipcRenderer.on('scene-camera-summon', (event, data) => callback(data)); },
  onCameraRecall: (callback) => { ipcRenderer.on('scene-camera-recall', (event) => callback()); },
  onUpdateCameraMappings: (callback) => { ipcRenderer.on('update-camera-mappings', (event, data) => callback(data)); },
};

contextBridge.exposeInMainWorld('electronAPI', Object.assign({}, controlCenterAPI, sceneAPI));