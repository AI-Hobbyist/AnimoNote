/**
 * AnimoNote - 子实例预加载脚本
 * 
 * 在 contextIsolation 模式下安全地暴露 API 给渲染进程。
 * 
 * 注意：Electron 28 中 preload 脚本可以 require Node.js 内置模块，
 * 但 sandbox 模式下受限。这里使用 nodeIntegration 方式。
 */

const { contextBridge, ipcRenderer } = require('electron');

// 使用 __dirname 和 path 拼接（preload 中 path 是 Node 内置模块，一定可用）
const path = require('path');

// 项目根目录（preload.js 位于项目根目录）
const PROJECT_ROOT = __dirname;

contextBridge.exposeInMainWorld('electronAPI', {
    // 获取实例信息
    getInstanceInfo: () => ipcRenderer.invoke('get-instance-info'),

    // 鼠标穿透控制
    setDraggable: (draggable) => ipcRenderer.send('set-draggable', draggable),

    // 状态上报（通过 IPC 发送到主进程，主进程转发给控制台）
    reportStatus: (status) => {
        // 同时通过 IPC 和 stdout 发送，兼容单进程和多进程两种架构
        ipcRenderer.send('character-status', status);
        try {
            process.stdout.write(JSON.stringify({ type: 'status', ...status }) + '\n');
        } catch (e) { /* ignore stdout errors in some environments */ }
    },

    // 文件读取（用于加载配置）
    readFile: (filePath) => {
        try {
            const fs = require('fs');
            return fs.readFileSync(filePath, 'utf-8');
        } catch (err) {
            console.error('[Preload] readFile error:', err.message);
            return null;
        }
    },

    // 文件存在检查
    existsSync: (filePath) => {
        try {
            const fs = require('fs');
            return fs.existsSync(filePath);
        } catch { return false; }
    },

    // 路径解析
    resolvePath: (...segments) => {
        return path.resolve(...segments);
    },

    // 获取项目根目录
    getProjectRoot: () => PROJECT_ROOT,

    // 获取模型目录
    getModelDir: () => {
        return ipcRenderer.invoke('get-instance-info').then(info => info.modelDir);
    },
});
