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
  updateCharacterConfig: (params) => ipcRenderer.send('update-character-config', params),
  onCharacterClosed: (callback) => { ipcRenderer.on('character-closed', (event, data) => callback(data)); },
  onCharacterStatus: (callback) => { ipcRenderer.on('character-status', (event, data) => callback(data)); },
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
};

contextBridge.exposeInMainWorld('electronAPI', Object.assign({}, controlCenterAPI, sceneAPI));