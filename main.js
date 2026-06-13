/**
 * AnimoNote - 子实例主进程
 *
 * 每个 AnimoNote 实例是一个独立的 Electron 进程。
 * 通过命令行参数 --instance-id 和 --model-dir 区分。
 *
 * 启动方式:
 *   electron . --instance-id=miku --model-dir=./models/miku
 *
 * ⚡ GPU 加速说明:
 * - Electron 默认启用 GPU 加速 (Chromium 的 GPU 渲染)
 * - Three.js WebGL 自动使用 GPU (通过 ANGLE 层调用 Direct3D)
 * - 透明窗口 + WebGL 在 Windows 上使用 DirectComposition 合成
 * - 以下配置强制启用 GPU 并优化透明窗口性能
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// ============================================================
// ⚡ GPU 加速配置（必须在 app.whenReady() 之前设置）
// ============================================================

// 强制启用 GPU 加速（默认已启用，显式声明确保不被禁用）
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// 透明窗口 GPU 合成优化
app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('disable-software-rasterizer');

// 使用 Direct3D 11 (Windows 上 WebGL 的最佳路径)
app.commandLine.appendSwitch('use-angle', 'd3d11');

// 多实例 GPU 内存优化：限制每个实例的 GPU 内存使用
app.commandLine.appendSwitch('max-gpu-memory', '512');

// 禁用 VSync 以减少输入延迟（对 MIDI 实时响应有利）
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');

// ============================================================
// 命令行参数解析
// ============================================================

const args = process.argv.slice(2);
const INSTANCE_ID = args.find(a => a.startsWith('--instance-id='))?.split('=')[1] || 'default';
const MODEL_DIR = args.find(a => a.startsWith('--model-dir='))?.split('=')[1] || path.join(__dirname, 'models', INSTANCE_ID);
const MIDI_CHANNEL = parseInt(args.find(a => a.startsWith('--midi-channel='))?.split('=')[1] || '1', 10);

// ❌ 关键：不调用 requestSingleInstanceLock()，允许无限多开

// ============================================================
// 窗口创建
// ============================================================

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 600,
        height: 800,
        transparent: true,                // ★ 关键：RGBA 背景透明
        frame: false,                     // 无边框
        alwaysOnTop: true,                // 置顶显示
        hasShadow: false,                 // 无窗口阴影
        type: 'toolbar',                  // 某些 Windows 版本需要
        focusable: false,                 // 不可获得焦点（避免抢走 DAW 焦点）
        skipTaskbar: true,                // 不在任务栏显示
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // 加载角色页面，传入参数
    // ★ 注意：Electron 的 loadFile query 参数会自动进行 URL 编码
    //   所以这里传入原始路径即可，不要手动 encodeURIComponent
    //   否则会导致双重编码（如 %3A → %253A）
    //   子窗口 renderer.js 会做 decodeURIComponent 还原
    mainWindow.loadFile('index.html', {
        query: {
            instanceId: INSTANCE_ID,
            modelDir: MODEL_DIR,
            midiChannel: String(MIDI_CHANNEL),
        }
    });

    // 默认：完全鼠标穿透
    mainWindow.setIgnoreMouseEvents(true, { forward: true });

    // 可选：开发模式下打开 DevTools
    // mainWindow.webContents.openDevTools();
}

// ============================================================
// IPC: 鼠标穿透控制
// ============================================================

ipcMain.on('set-draggable', (event, draggable) => {
    if (mainWindow) {
        if (draggable) {
            // 用户按住 Alt 键 → 允许鼠标交互（拖拽）
            mainWindow.setIgnoreMouseEvents(false);
        } else {
            // 默认状态 → 鼠标穿透
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
        }
    }
});

// ============================================================
// IPC: 获取实例信息
// ============================================================

ipcMain.handle('get-instance-info', async () => {
    return {
        instanceId: INSTANCE_ID,
        modelDir: MODEL_DIR,
        midiChannel: MIDI_CHANNEL,
    };
});

// ============================================================
// App Lifecycle
// ============================================================

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
