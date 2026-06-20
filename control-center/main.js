const { app, BrowserWindow, ipcMain, shell, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// GPU 加速
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('use-angle', 'd3d11');

// ============================================================
// 状态管理
// ============================================================

let controlWindow = null;
let sceneWindow = null;
const summonedCharacters = new Map(); // instanceId -> { modelDir, midiChannel, config }

// ============================================================
// 控制中心窗口
// ============================================================

function createControlWindow() {
    controlWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'AnimoNote Control Center',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: false,
        },
    });

    controlWindow.maximize();
    controlWindow.once('ready-to-show', () => controlWindow.show());

    const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
    if (isDev) {
        controlWindow.loadURL('http://localhost:5173');
        controlWindow.webContents.openDevTools();
    } else {
        controlWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    }

    controlWindow.on('closed', () => {
        controlWindow = null;
        if (sceneWindow) {
            sceneWindow.close();
            sceneWindow = null;
        }
        summonedCharacters.clear();
    });
}

// ============================================================
// 场景窗口（单窗口管理所有角色）
// ============================================================

function createSceneWindow(displayId) {
    if (sceneWindow && !sceneWindow.isDestroyed()) {
        sceneWindow.focus();
        return sceneWindow;
    }

    const displays = screen.getAllDisplays();
    const targetDisplay = displays.find(d => d.id === displayId) || screen.getPrimaryDisplay();
    const { x, y, width, height } = targetDisplay.bounds;

    sceneWindow = new BrowserWindow({
        x: x,
        y: y,
        width: width,
        height: height,
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
            sandbox: false,
            webSecurity: false,
            allowRunningInsecureContent: true,
        },
    });

    sceneWindow.loadFile(path.join(__dirname, '..', 'index.html'));

    // 默认鼠标穿透
    sceneWindow.setIgnoreMouseEvents(true, { forward: true });

    sceneWindow.on('closed', () => {
        console.log('[Scene] Window closed');
        sceneWindow = null;
        summonedCharacters.clear();
        if (controlWindow && !controlWindow.isDestroyed()) {
            controlWindow.webContents.send('character-closed', { instanceId: '__scene__' });
        }
    });

    sceneWindow.webContents.on('console-message', (event, level, message) => {
         console.log(`[Scene] Console message: ${message}`);
    });

    console.log('[Scene] Window created');
    return sceneWindow;
}

// ============================================================
// IPC: 角色管理（召唤/召回）
// ============================================================

ipcMain.handle('summon-character', async (event, { instanceId, modelDir, midiChannel, displayId }) => {
    try {
        const win = createSceneWindow(displayId);
        
        // 加载角色配置
        let config = null;
        try {
            const configPath = path.join(modelDir, 'config.json');
            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }
            const mappingPath = path.join(modelDir, 'mapping.json');
            if (fs.existsSync(mappingPath)) {
                config = config || {};
                config.note_mappings = JSON.parse(fs.readFileSync(mappingPath, 'utf-8')).note_mappings || {};
            }
        } catch (e) {
            console.error('[Summon] Config load error:', e.message);
        }

        summonedCharacters.set(instanceId, { modelDir, midiChannel, config });

        // 等待窗口加载完成后发送
        const sendSummon = () => {
            if (win && !win.isDestroyed()) {
                win.webContents.send('scene-summon', { instanceId, modelDir, midiChannel, config });
            }
        };

        if (win.webContents.isLoading()) {
            win.webContents.once('did-finish-load', sendSummon);
        } else {
            sendSummon();
        }

         console.log(`[Summon] Character summoned: ${modelDir} / ${instanceId}`);
        return { success: true };
    } catch (err) {
         console.error(`[Summon] Failed: ${err.message}`);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('recall-character', async (event, { instanceId }) => {
    try {
        if (sceneWindow && !sceneWindow.isDestroyed()) {
            sceneWindow.webContents.send('scene-recall', { instanceId });
        }
        summonedCharacters.delete(instanceId);
         console.log(`[Recall] Character recalled: ${instanceId}`);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-summoned-characters', async () => {
    const result = [];
    for (const [instanceId, info] of summonedCharacters) {
        result.push({
            instanceId,
            status: sceneWindow && !sceneWindow.isDestroyed() ? 'summoned' : 'stopped',
            midiChannel: info.midiChannel,
        });
    }
    return result;
});

// ============================================================
// IPC: 排练模式
// ============================================================

ipcMain.handle('enter-rehearsal', async () => {
    try {
        if (sceneWindow && !sceneWindow.isDestroyed()) {
            sceneWindow.webContents.send('scene-rehearsal', { active: true });
            return { success: true };
        }
        return { success: false, error: '场景窗口未创建' };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('exit-rehearsal', async () => {
    try {
        if (sceneWindow && !sceneWindow.isDestroyed()) {
            sceneWindow.webContents.send('scene-rehearsal', { active: false });
            return { success: true };
        }
        return { success: false, error: '场景窗口未创建' };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ============================================================
// IPC: 窗口控制（场景窗口使用）
// ============================================================

ipcMain.on('scene-ready', (event) => {
    console.log('[Scene] Ready signal received');
    // 重新发送所有已召唤的角色
    for (const [instanceId, info] of summonedCharacters) {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
            win.webContents.send('scene-summon', { instanceId, ...info });
        }
    }
});

ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : false);
         console.log(`[Scene] Mouse ignore: ${ignore}`);
    }
});

ipcMain.on('set-window-opacity', (event, opacity) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.setOpacity(opacity);
         console.log(`[Scene] Opacity: ${opacity}`);
    }
});

// ============================================================
// IPC: MMD 观赏模式
// ============================================================

ipcMain.on('start-viewing-mode', (event, data) => {
    if (sceneWindow && !sceneWindow.isDestroyed()) {
        sceneWindow.webContents.send('scene-viewing-mode', { active: true, ...data });
        console.log('[Scene] Viewing mode: ON');
    }
});

ipcMain.on('stop-viewing-mode', (event, data) => {
    if (sceneWindow && !sceneWindow.isDestroyed()) {
        sceneWindow.webContents.send('scene-viewing-mode', { active: false, ...data });
        console.log('[Scene] Viewing mode: OFF');
    }
});

ipcMain.on('play-viewing-entry', (event, data) => {
    if (sceneWindow && !sceneWindow.isDestroyed()) {
        sceneWindow.webContents.send('scene-play-viewing-entry', data);
        console.log('[Scene] Play specific entry:', data.entryIndex);
    }
});

ipcMain.on('stop-viewing-playback', (event) => {
    if (sceneWindow && !sceneWindow.isDestroyed()) {
        sceneWindow.webContents.send('scene-stop-viewing-playback');
        console.log('[Scene] Stop viewing playback');
    }
});

ipcMain.on('seek-viewing-entry', (event, data) => {
    if (sceneWindow && !sceneWindow.isDestroyed()) {
        sceneWindow.webContents.send('scene-seek-viewing-entry', data);
    }
});

// ============================================================
// IPC: 文件浏览对话框
// ============================================================

ipcMain.handle('browse-vmd-file', async () => {
    const result = await dialog.showOpenDialog({
        title: '选择 VMD 动作文件',
        filters: [
            { name: 'MMD 动作文件', extensions: ['vmd'] },
        ],
        properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

ipcMain.handle('browse-audio-file', async () => {
    const result = await dialog.showOpenDialog({
        title: '选择音频文件',
        filters: [
            { name: '音频文件', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'] },
        ],
        properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

ipcMain.handle('scan-audio-files', async (event, { modelDir }) => {
    const audioFiles = [];
    const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'];
    const searchDirs = [modelDir, path.join(modelDir, 'audio'), path.join(modelDir, 'music')];
    for (const dir of searchDirs) {
        if (fs.existsSync(dir)) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (audioExts.includes(ext)) {
                        const fullPath = path.join(dir, entry.name);
                        const relativePath = path.relative(modelDir, fullPath).replace(/\\/g, '/');
                        audioFiles.push({ name: entry.name, path: fullPath, relativePath });
                    }
                }
            }
        }
    }
    return audioFiles;
});

ipcMain.handle('save-character-position', async (event, { instanceId, position, rotation, scale, opacity, brightness, shadowEnabled, shadowOpacity, shadowColor }) => {
    try {
        const info = summonedCharacters.get(instanceId);
        if (!info) return { success: false, error: '角色未找到' };

        const configPath = path.join(info.modelDir, 'config.json');
        let config = {};
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
        if (!config.model) config.model = {};
        if (position) config.model.position = position;
        if (rotation) config.model.rotation = rotation;
        if (scale !== undefined) config.model.scale = scale;
        if (opacity !== undefined) config.model.opacity = opacity;
        if (brightness !== undefined) config.model.brightness = brightness;
        if (shadowEnabled !== undefined) config.model.shadow_enabled = shadowEnabled;
        if (shadowOpacity !== undefined) config.model.shadow_opacity = shadowOpacity;
        if (shadowColor !== undefined) config.model.shadow_color = shadowColor;
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
         console.log(`[Scene] Saved complex state for ${instanceId}`);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ============================================================
// IPC: 状态转发（场景窗口 -> 控制中心）
// ============================================================

ipcMain.on('character-status', (event, status) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('character-status', status);
    }
});

// ============================================================
// IPC: 配置更新转发（控制中心 -> 场景窗口）
// ============================================================

ipcMain.on('update-character-config', (event, { instanceId, config }) => {
    if (sceneWindow && !sceneWindow.isDestroyed()) {
        sceneWindow.webContents.send('update-config', { instanceId, config });
    }
});

// ============================================================
// IPC: 文件系统操作
// ============================================================

function getModelsDir() {
    return path.join(__dirname, '..', 'models');
}

ipcMain.handle('scan-models', async () => {
    const modelsDir = getModelsDir();
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
                    available.push({
                        id: entry.name,
                        displayName: config.display_name || entry.name,
                        configPath,
                        mappingPath,
                        modelDir: path.join(modelsDir, entry.name),
                        midiChannel,
                        hasModel: fs.existsSync(config.model?.pmx_path
                            ? path.resolve(modelsDir, entry.name, config.model.pmx_path)
                            : path.join(modelsDir, entry.name, entry.name + '.pmx')),
                        noteCount: Object.keys(mapping.note_mappings || {}).length,
                    });
                } catch (err) {
                    console.error('Error loading config for', entry.name, err.message);
                }
            }
        }
    }
    return available;
});

ipcMain.handle('read-mapping', async (event, { modelDir }) => {
    const mappingPath = path.join(modelDir, 'mapping.json');
    if (!fs.existsSync(mappingPath)) return { note_mappings: {} };
    try { return JSON.parse(fs.readFileSync(mappingPath, 'utf-8')); }
    catch { return { note_mappings: {} }; }
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
                    const fullPath = path.join(dir, entry.name);
                    const relativePath = path.relative(modelDir, fullPath).replace(/\\/g, '/');
                    vmdFiles.push({ name: entry.name, path: fullPath, relativePath });
                }
            }
        }
    }
    return vmdFiles;
});

ipcMain.handle('read-config', async (event, { modelDir }) => {
    const configPath = path.join(modelDir, 'config.json');
    if (!fs.existsSync(configPath)) return null;
    try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')); }
    catch { return null; }
});

ipcMain.handle('save-config', async (event, { modelDir, config }) => {
    const configPath = path.join(modelDir, 'config.json');
    try {
        // 读取现有配置，保留排练模式设置的字段（rotation, opacity, brightness, scale, position 等）
        let existing = {};
        if (fs.existsSync(configPath)) {
            existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
        // 逐节深度合并：新配置优先，但新配置中不存在的字段保留旧值
        const merged = { ...existing, ...config };
        const sections = ['model', 'midi', 'window', 'idle', 'blink', 'physics'];
        for (const section of sections) {
            if (existing[section] || config[section]) {
                merged[section] = { ...(existing[section] || {}), ...(config[section] || {}) };
            }
        }
        fs.writeFileSync(configPath, JSON.stringify(merged, null, 4), 'utf-8');
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
            const modelsDir = path.resolve(__dirname, '..', 'models');
            if (!path.resolve(modelDir).startsWith(modelsDir)) {
                throw new Error('非法删除路径');
            }
            await shell.trashItem(modelDir);
            return { success: true };
        }
        return { success: false, error: '目录不存在' };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('create-model', async (event, { modelId, displayName }) => {
    const modelsDir = getModelsDir();
    const modelDir = path.join(modelsDir, modelId);
    if (fs.existsSync(modelDir)) {
        return { success: false, error: '角色 ' + modelId + ' 已存在' };
    }
    try {
        fs.mkdirSync(path.join(modelDir, 'actions'), { recursive: true });
        const defaultConfig = {
            instance_id: modelId,
            display_name: displayName || modelId,
            midi: { device_name: '', channel: 1 },
            model: { pmx_path: './' + modelId + '.pmx', vmd_path: './idle.vmd', scale: 1.0, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
            window: { always_on_top: true, mouse_through_default: true },
            idle: { vmd_path: './idle.vmd', loop: true, blend_time: 0.3 },
            blink: { enabled: true, min_interval: 2000, max_interval: 6000, duration: 120 },
            audio: { enabled: false, vocal_path: null },
            physics: { enabled: true, gravity: -9.8, substeps: 3, reset_on_loop: true }
        };
        fs.writeFileSync(path.join(modelDir, 'config.json'), JSON.stringify(defaultConfig, null, 4), 'utf-8');
        fs.writeFileSync(path.join(modelDir, 'mapping.json'), JSON.stringify({ note_mappings: {} }, null, 4), 'utf-8');
        return { success: true, modelDir };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-screens', async () => {
    const displays = screen.getAllDisplays();
    return displays.map(d => ({
        id: d.id,
        label: d.label || `Display ${d.id}`,
        bounds: d.bounds,
        isPrimary: d.id === screen.getPrimaryDisplay().id
    }));
});

ipcMain.handle('read-settings', async () => {
    const settingsPath = path.join(__dirname, '..', 'settings.json');
    if (!fs.existsSync(settingsPath)) return {};
    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch (e) {
        return {};
    }
});

ipcMain.handle('save-settings', async (event, settings) => {
    const settingsPath = path.join(__dirname, '..', 'settings.json');
    try {
        let current = {};
        if (fs.existsSync(settingsPath)) {
            current = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }
        const updated = { ...current, ...settings };
        fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 4), 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ============================================================
// IPC: 摄像机模块
// ============================================================

const CAMERA_DIR = path.join(__dirname, '..', 'camera');

/** 摄像机状态 */
let cameraSummoned = false;
let cameraStatus = { currentNote: null, currentAction: null, fps: '--' };

ipcMain.handle('get-camera-config', async () => {
    const configPath = path.join(CAMERA_DIR, 'config.json');
    if (!fs.existsSync(configPath)) return null;
    try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')); }
    catch { return null; }
});

ipcMain.handle('save-camera-config', async (event, config) => {
    const configPath = path.join(CAMERA_DIR, 'config.json');
    try {
        let existing = {};
        if (fs.existsSync(configPath)) {
            existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
        const merged = { ...existing, ...config };
        if (config.midi) merged.midi = { ...(existing.midi || {}), ...config.midi };
        if (config.camera_vmd) merged.camera_vmd = { ...(existing.camera_vmd || {}), ...config.camera_vmd };
        fs.writeFileSync(configPath, JSON.stringify(merged, null, 4), 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('read-camera-mapping', async () => {
    const mappingPath = path.join(CAMERA_DIR, 'mapping.json');
    if (!fs.existsSync(mappingPath)) return { note_mappings: {} };
    try { return JSON.parse(fs.readFileSync(mappingPath, 'utf-8')); }
    catch { return { note_mappings: {} }; }
});

ipcMain.handle('save-camera-mapping', async (event, { noteMappings }) => {
    const mappingPath = path.join(CAMERA_DIR, 'mapping.json');
    try {
        fs.writeFileSync(mappingPath, JSON.stringify({ note_mappings: noteMappings }, null, 4), 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('scan-camera-vmd-files', async () => {
    const vmdFiles = [];
    const searchDirs = [CAMERA_DIR, path.join(CAMERA_DIR, 'actions')];
    for (const dir of searchDirs) {
        if (fs.existsSync(dir)) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.toLowerCase().endsWith('.vmd')) {
                    const fullPath = path.join(dir, entry.name);
                    const relativePath = path.relative(CAMERA_DIR, fullPath).replace(/\\/g, '/');
                    vmdFiles.push({ name: entry.name, path: fullPath, relativePath });
                }
            }
        }
    }
    return vmdFiles;
});

ipcMain.handle('summon-camera', async (event, params) => {
    try {
        if (!sceneWindow || sceneWindow.isDestroyed()) {
            // 自动创建场景窗口
            createSceneWindow(screen.getPrimaryDisplay().id);
            // 等待场景窗口加载完成
            await new Promise((resolve) => {
                if (sceneWindow && !sceneWindow.isDestroyed()) {
                    if (sceneWindow.webContents.isLoading()) {
                        sceneWindow.webContents.once('did-finish-load', resolve);
                    } else {
                        resolve();
                    }
                } else {
                    resolve();
                }
            });
        }

        // 加载摄像机配置和映射
        let config = null;
        try {
            const configPath = path.join(CAMERA_DIR, 'config.json');
            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }
            const mappingPath = path.join(CAMERA_DIR, 'mapping.json');
            if (fs.existsSync(mappingPath)) {
                config = config || {};
                config.note_mappings = JSON.parse(fs.readFileSync(mappingPath, 'utf-8')).note_mappings || {};
            }
        } catch (e) {
            console.error('[Camera] Config load error:', e.message);
        }

        cameraSummoned = true;
        cameraStatus = { currentNote: null, currentAction: null, fps: '--' };

        // 记录配置详情
        const ch = config?.midi?.channel || 1;
        const root = config?.midi?.root_note || 'C4';
        const defVmd = config?.camera_vmd?.default_vmd || './actions/default.vmd';
        const mapCount = Object.keys(config?.note_mappings || {}).length;
        console.log(`[Camera] Config: CH ${ch}, root ${root}, default VMD: ${defVmd}, ${mapCount} mappings`);

        sceneWindow.webContents.send('scene-camera-summon', { config, cameraDir: CAMERA_DIR });
        console.log('[Camera] Summoned');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('recall-camera', async () => {
    try {
        cameraSummoned = false;
        cameraStatus = { currentNote: null, currentAction: null, fps: '--' };
        if (sceneWindow && !sceneWindow.isDestroyed()) {
            sceneWindow.webContents.send('scene-camera-recall');
        }
        console.log('[Camera] Recalled');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-camera-status', async () => {
    return { summoned: cameraSummoned, ...cameraStatus };
});

// 摄像机状态更新（来自场景窗口）
ipcMain.on('camera-status', (event, status) => {
    if (status.currentNote !== undefined) cameraStatus.currentNote = status.currentNote;
    if (status.currentAction !== undefined) cameraStatus.currentAction = status.currentAction;
    if (status.fps !== undefined) cameraStatus.fps = status.fps;
    // 转发到控制中心
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('camera-status', { instanceId: 'camera', ...status });
    }
});

// 摄像机映射更新转发（控制中心 -> 场景窗口）
ipcMain.on('update-camera-mappings', (event, { noteMappings }) => {
    if (sceneWindow && !sceneWindow.isDestroyed()) {
        sceneWindow.webContents.send('update-camera-mappings', { noteMappings });
    }
});

// 实时更新观赏模式倍率
ipcMain.on('update-viewing-multiplier', (event, { multiplyX, multiplyY, multiplyZ }) => {
    if (sceneWindow && !sceneWindow.isDestroyed()) {
        sceneWindow.webContents.send('scene-update-viewing-multiplier', { multiplyX, multiplyY, multiplyZ });
        console.log('[ViewingMode] Multiplier updated:', multiplyX, multiplyY, multiplyZ);
    }
});

// 重置观看模式镜头
ipcMain.on('reset-viewing-camera', () => {
    if (sceneWindow && !sceneWindow.isDestroyed()) {
        sceneWindow.webContents.send('reset-viewing-camera');
        console.log('[Camera] Reset viewing camera');
    }
});

// ============================================================
// App Lifecycle
// ============================================================

app.whenReady().then(createControlWindow);

app.on('window-all-closed', () => {
    if (sceneWindow) { sceneWindow.close(); sceneWindow = null; }
    summonedCharacters.clear();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (!controlWindow) createControlWindow();
});
