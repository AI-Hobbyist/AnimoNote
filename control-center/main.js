/**
 * AnimoNote - 中央控制台主进程（单进程多窗口架构）
 * 
 * 架构说明：
 * - 这是一个单 Electron 进程应用
 * - 控制台窗口 + N 个角色窗口，都在同一个进程中
 * - 角色窗口通过 IPC 直接与控制台通信（无需子进程 stdin/stdout）
 * - 每个角色窗口是一个独立的 BrowserWindow，透明、无边框、鼠标穿透
 * 
 * 职责：
 * 1. 管理控制台 UI 窗口
 * 2. 管理所有角色窗口（创建/销毁/配置）
 * 3. 扫描 models/ 目录发现可用角色
 * 4. 提供 MIDI 输入设备选择与通道分配
 * 5. 读取/保存 config.json 和 mapping.json
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ⚡ GPU 加速
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('use-angle', 'd3d11');

// ============================================================
// 状态管理
// ============================================================

let controlWindow = null;
const characterWindows = new Map(); // instanceId → BrowserWindow

// ============================================================
// 控制台窗口
// ============================================================

function createControlWindow() {
    controlWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'AnimoNote Control Center',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
        },
    });

    controlWindow.maximize();
    controlWindow.once('ready-to-show', () => controlWindow.show());

    // 开发模式：使用 Vite 开发服务器
    // 生产模式：使用 Vite 构建后的文件
    const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
    if (isDev) {
        controlWindow.loadURL('http://localhost:5173');
        controlWindow.webContents.openDevTools();
    } else {
        controlWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    }

    controlWindow.on('closed', () => {
        controlWindow = null;
        // 关闭所有角色窗口
        for (const [id, win] of characterWindows) {
            win.close();
        }
        characterWindows.clear();
    });
}

// ============================================================
// 角色窗口管理
// ============================================================

/**
 * 创建或显示一个角色窗口
 */
function createCharacterWindow(instanceId, modelDir, midiChannel) {
    // 如果窗口已存在，聚焦它
    if (characterWindows.has(instanceId)) {
        const win = characterWindows.get(instanceId);
        win.focus();
        return win;
    }

    // 尝试从 config.json 加载保存的位置
    let savedX = undefined;
    let savedY = undefined;
    try {
        const configPath = path.join(modelDir, 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.window && config.window.x !== undefined && config.window.y !== undefined) {
                savedX = config.window.x;
                savedY = config.window.y;
            }
        }
    } catch (e) {
        console.error('[Main] Failed to load window position:', e.message);
    }

    try {
        const win = new BrowserWindow({
            width: 600,
            height: 800,
            x: savedX,
            y: savedY,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            hasShadow: false,
            type: 'toolbar',
            focusable: false,
            skipTaskbar: true,
            webPreferences: {
                preload: path.join(__dirname, '..', 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,          // ★ 必须禁用 sandbox 才能使用 Node 模块
                webSecurity: false,      // ★ 允许 file:// 协议加载本地模块
                allowRunningInsecureContent: true,
            },
        });

        // 加载角色页面
        // ★ 注意：Electron 的 loadFile query 参数会自动进行 URL 编码
        //   所以这里传入原始路径即可，不要手动 encodeURIComponent
        //   否则会导致双重编码（如 %3A → %253A）
        //   子窗口 renderer.js 会做 decodeURIComponent 还原
        win.loadFile(path.join(__dirname, '..', 'index.html'), {
            query: {
                instanceId,
                modelDir,
                midiChannel: String(midiChannel),
            }
        });

        // 默认鼠标穿透
        win.setIgnoreMouseEvents(true, { forward: true });

        // 窗口关闭时清理
        win.on('closed', () => {
            console.log(`[Character] Window closed: ${instanceId}`);
            characterWindows.delete(instanceId);
            if (controlWindow && !controlWindow.isDestroyed()) {
                controlWindow.webContents.send('character-closed', { instanceId });
            }
        });

        // 监听渲染进程错误
        win.webContents.on('console-message', (event, level, message) => {
            console.log(`[Character:${instanceId}] ${message}`);
        });

        win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error(`[Character:${instanceId}] Failed to load: ${errorDescription} (${errorCode})`);
        });

        characterWindows.set(instanceId, win);
        console.log(`[Character] Window created: ${instanceId}`);
        return win;
    } catch (err) {
        console.error(`[Character] Failed to create window ${instanceId}:`, err);
        throw err;
    }
}

/**
 * 关闭角色窗口
 */
function closeCharacterWindow(instanceId) {
    const win = characterWindows.get(instanceId);
    if (win) {
        win.close();
        characterWindows.delete(instanceId);
    }
}

// ============================================================
// IPC: 角色窗口鼠标穿透控制
// ============================================================

ipcMain.on('set-draggable', (event, draggable) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        if (draggable) {
            win.setIgnoreMouseEvents(false);
        } else {
            win.setIgnoreMouseEvents(true, { forward: true });
        }
    }
});

ipcMain.on('window-move', (event, { deltaX, deltaY }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        const [x, y] = win.getPosition();
        win.setPosition(Math.round(x + deltaX), Math.round(y + deltaY));
    }
});

ipcMain.on('save-window-position', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        const [x, y] = win.getPosition();
        // 尝试从 webContents 的 URL 获取 modelDir
        const url = new URL(win.webContents.getURL());
        const modelDir = url.searchParams.get('modelDir');
        if (modelDir) {
            try {
                const decodedDir = decodeURIComponent(modelDir);
                const configPath = path.join(decodedDir, 'config.json');
                let config = {};
                if (fs.existsSync(configPath)) {
                    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                }
                if (!config.window) config.window = {};
                config.window.x = x;
                config.window.y = y;
                fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
                console.log(`[Main] Saved window position for ${decodedDir}: ${x}, ${y}`);
            } catch (e) {
                console.error('[Main] Failed to save window position:', e.message);
            }
        }
    }
});

// ============================================================
// IPC: 角色窗口状态上报
// ============================================================

ipcMain.on('character-status', (event, status) => {
    // 将角色窗口的状态转发到控制台渲染进程
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('character-status', status);
    }
});

// ============================================================
// IPC: 转发配置更新到角色窗口
// ============================================================

ipcMain.on('update-character-config', (event, { instanceId, config }) => {
    const win = characterWindows.get(instanceId);
    if (win && !win.isDestroyed()) {
        win.webContents.send('update-config', config);
    }
});

// ============================================================
// IPC: 文件系统操作
// ============================================================

ipcMain.handle('scan-models', async () => {
    const modelsDir = path.join(__dirname, '..', 'models');
    const available = [];

    if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
        return available;
    }

    const entries = fs.readdirSync(modelsDir, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const configPath = path.join(modelsDir, entry.name, 'config.json');
            const mappingPath = path.join(modelsDir, entry.name, 'mapping.json');

            if (fs.existsSync(configPath)) {
                try {
                    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                    const mapping = fs.existsSync(mappingPath)
                        ? JSON.parse(fs.readFileSync(mappingPath, 'utf-8'))
                        : { note_mappings: {} };

                    const midiChannel = config.midi?.channel || config.midi_channel || 1;
                    const midiDevice = config.midi?.device_name || '';

                    available.push({
                        id: entry.name,
                        displayName: config.display_name || entry.name,
                        configPath,
                        mappingPath,
                        modelDir: path.join(modelsDir, entry.name),
                        midiChannel,
                        midiDevice,
                        hasModel: fs.existsSync(config.model?.pmx_path
                            ? path.resolve(modelsDir, entry.name, config.model.pmx_path)
                            : path.join(modelsDir, entry.name, `${entry.name}.pmx`)),
                        noteCount: Object.keys(mapping.note_mappings || {}).length,
                    });
                } catch (err) {
                    console.error(`Error loading config for ${entry.name}:`, err.message);
                }
            }
        }
    }

    return available;
});

ipcMain.handle('read-mapping', async (event, { modelDir }) => {
    const mappingPath = path.join(modelDir, 'mapping.json');
    if (!fs.existsSync(mappingPath)) return { note_mappings: {} };
    try {
        return JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
    } catch { return { note_mappings: {} }; }
});

ipcMain.handle('save-mapping', async (event, { modelDir, noteMappings }) => {
    const mappingPath = path.join(modelDir, 'mapping.json');
    try {
        fs.writeFileSync(mappingPath, JSON.stringify({ note_mappings: noteMappings }, null, 4), 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('scan-vmd-files', async (event, { modelDir }) => {
    const vmdFiles = [];
    const searchDirs = [modelDir, path.join(modelDir, 'actions')];
    for (const dir of searchDirs) {
        if (fs.existsSync(dir)) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.toLowerCase().endsWith('.vmd')) {
                    vmdFiles.push({
                        name: entry.name,
                        path: path.join(dir, entry.name),
                        relativePath: path.relative(modelDir, path.join(dir, entry.name)),
                    });
                }
            }
        }
    }
    return vmdFiles;
});

ipcMain.handle('read-config', async (event, { modelDir }) => {
    const configPath = path.join(modelDir, 'config.json');
    if (!fs.existsSync(configPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch { return null; }
});

ipcMain.handle('save-config', async (event, { modelDir, config }) => {
    const configPath = path.join(modelDir, 'config.json');
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('scan-pmx-files', async (event, { modelDir }) => {
    const pmxFiles = [];
    if (fs.existsSync(modelDir)) {
        const entries = fs.readdirSync(modelDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && (entry.name.toLowerCase().endsWith('.pmx') || entry.name.toLowerCase().endsWith('.pmd'))) {
                pmxFiles.push({ name: entry.name, path: path.join(modelDir, entry.name) });
            }
        }
    }
    return pmxFiles;
});

ipcMain.handle('delete-model', async (event, { modelId, modelDir }) => {
    try {
        if (fs.existsSync(modelDir)) {
            // 安全起见，检查是否在 models 目录下
            const modelsDir = path.resolve(__dirname, '..', 'models');
            if (!path.resolve(modelDir).startsWith(modelsDir)) {
                throw new Error('非法删除路径');
            }
            // 移至系统回收站
            await shell.trashItem(modelDir);
            return { success: true };
        }
        return { success: false, error: '目录不存在' };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('create-model', async (event, { modelId, displayName }) => {
    const modelsDir = path.join(__dirname, '..', 'models');
    const modelDir = path.join(modelsDir, modelId);

    if (fs.existsSync(modelDir)) {
        return { success: false, error: `角色 ${modelId} 已存在` };
    }

    try {
        fs.mkdirSync(path.join(modelDir, 'actions'), { recursive: true });

        const defaultConfig = {
            instance_id: modelId,
            display_name: displayName || modelId,
            midi: { device_name: "", channel: 1 },
            model: {
                pmx_path: `./${modelId}.pmx`,
                vmd_path: `./idle.vmd`,
                scale: 1.0,
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 }
            },
            window: {
                width: 600, height: 800,
                position: { x: 100, y: 100 },
                always_on_top: true,
                mouse_through_default: true,
                drag_modifier_key: "Alt"
            },
            idle: {
                vmd_path: "./idle.vmd",
                loop: true,
                blend_time: 0.3
            },
            blink: {
                enabled: true,
                min_interval: 2000,
                max_interval: 6000,
                duration: 120
            },
            audio: { enabled: false, vocal_path: null },
            physics: { enabled: true, gravity: -9.8, substeps: 3 }
        };

        fs.writeFileSync(path.join(modelDir, 'config.json'), JSON.stringify(defaultConfig, null, 4), 'utf-8');
        fs.writeFileSync(path.join(modelDir, 'mapping.json'), JSON.stringify({ note_mappings: {} }, null, 4), 'utf-8');

        return { success: true, modelDir };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ============================================================
// IPC: 角色窗口启停（单进程内）
// ============================================================

ipcMain.handle('start-character', async (event, { instanceId, modelDir, midiChannel }) => {
    try {
        createCharacterWindow(instanceId, modelDir, midiChannel);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('stop-character', async (event, { instanceId }) => {
    closeCharacterWindow(instanceId);
    return { success: true };
});

ipcMain.handle('get-characters', async () => {
    const result = [];
    for (const [instanceId, win] of characterWindows) {
        result.push({
            instanceId,
            status: !win.isDestroyed() ? 'running' : 'stopped',
        });
    }
    return result;
});

// ============================================================
// App Lifecycle
// ============================================================

app.whenReady().then(createControlWindow);

app.on('window-all-closed', () => {
    for (const [id, win] of characterWindows) {
        win.close();
    }
    characterWindows.clear();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (!controlWindow) createControlWindow();
});
