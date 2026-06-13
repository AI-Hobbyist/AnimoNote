/**
 * AnimoNote - 中央控制台预加载脚本
 * 
 * 单进程多窗口架构：控制台通过 IPC 直接管理角色窗口
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 扫描模型目录
    scanModels: () => ipcRenderer.invoke('scan-models'),

    // 角色窗口管理（单进程内）
    startCharacter: (params) => ipcRenderer.invoke('start-character', params),
    stopCharacter: (params) => ipcRenderer.invoke('stop-character', params),
    getCharacters: () => ipcRenderer.invoke('get-characters'),

    // 映射编辑
    readMapping: (params) => ipcRenderer.invoke('read-mapping', params),
    saveMapping: (params) => ipcRenderer.invoke('save-mapping', params),
    scanVmdFiles: (params) => ipcRenderer.invoke('scan-vmd-files', params),

    // 角色配置编辑
    readConfig: (params) => ipcRenderer.invoke('read-config', params),
    saveConfig: (params) => ipcRenderer.invoke('save-config', params),
    scanPmxFiles: (params) => ipcRenderer.invoke('scan-pmx-files', params),
    createModel: (params) => ipcRenderer.invoke('create-model', params),

    // 状态监听（角色窗口关闭通知）
    onCharacterClosed: (callback) => {
        ipcRenderer.on('character-closed', (event, data) => callback(data));
    },

    // 状态监听（角色窗口状态更新）
    onCharacterStatus: (callback) => {
        ipcRenderer.on('character-status', (event, data) => callback(data));
    },
});
