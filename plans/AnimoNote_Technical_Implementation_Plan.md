# AnimoNote 桌面虚拟乐手系统：技术实施与工程计划书

> **版本：** v1.1  
> **作者：** Zoo / 架构师  
> **日期：** 2026-06-13  
> **技术栈：** Electron + Three.js + Web MIDI API + ammo.js

---

## 目录

1. [项目工程总览](#1-项目工程总览)
2. [多实例与多通道架构设计](#2-多实例与多通道架构设计)
3. [中央控制台设计](#3-中央控制台设计)
4. [模型目录独立配置体系](#4-模型目录独立配置体系)
5. [关键技术难点与终极解决方案](#5-关键技术难点与终极解决方案)
6. [数据结构定义与 Config 规范](#6-数据结构定义与-config-规范)
7. [Vibe Coding 分步工程实施计划](#7-vibe-coding-分步工程实施计划)
8. [附录：项目目录结构](#8-附录项目目录结构)

---

## 1. 项目工程总览

### 1.1 定位：桌面动作采样器

**AnimoNote** 不是传统意义上的桌面宠物或壁纸引擎插件。它的核心定位是 **"桌面动作采样器（Desktop Motion Sampler）"**——一个将 MMD 模型转化为**实时 MIDI 驱动的虚拟乐手**的硬核工具。

其核心工作流如下：

```
DAW (Ableton/FL Studio)
    │
    ├── MIDI 输出 (虚拟 MIDI 端口, 如 loopMIDI)
    │       │
    │       ├──→ AnimoNote Instance #1 (Channel 1)  →  初音未来 (miku.pmx)
    │       │       │                                    ├── C3 → 挥手.vmd
    │       │       │                                    ├── D3 → 跳跃.vmd
    │       │       │                                    └── E3 → 转身.vmd
    │       │
    │       ├──→ AnimoNote Instance #2 (Channel 2)  →  镜音铃 (rin.pmx)
    │       │       │                                    ├── C3 → 敲鼓.vmd
    │       │       │                                    ├── D3 → 钹.vmd
    │       │       │                                    └── E3 → 踩镲.vmd
    │       │
    │       └──→ AnimoNote Instance #3 (Channel 10) →  巡音露卡 (luka.pmx)  [鼓组通道]
    │
    └── 最终效果：桌面上多个透明角色同时演奏，形成虚拟乐队
```

### 1.2 最终视觉愿景

用户将在 Windows 桌面上看到 **多个完全透明、鼠标穿透的 3D 角色窗口**，每个角色独立运行、独立响应 MIDI 通道。当 DAW 播放 MIDI 序列时，这些角色如同被音符"附身"一般，精准地执行对应的 VMD 动作——**低音区角色律动、中音区角色舞蹈、高音区角色跳跃**，形成一场桌面上的全息演唱会。

---

## 2. 多实例与多通道架构设计

### 2.1 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    中央控制台 (Control Center)              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ MIDI 输入选择 │  │ 通道分配面板  │  │ 实例管理面板  │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
│         │                │                  │             │
│         ▼                ▼                  ▼             │
│  ┌──────────────────────────────────────────────────┐    │
│  │              实例注册表 (Instance Registry)         │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐          │    │
│  │  │ miku    │  │ rin     │  │ luka    │  ...      │    │
│  │  │ CH=1    │  │ CH=2    │  │ CH=10   │          │    │
│  │  │ PID=1234│  │ PID=5678│  │ PID=9012│          │    │
│  │  └─────────┘  └─────────┘  └─────────┘          │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
           │                │                  │
           │ spawn          │ spawn            │ spawn
           ▼                ▼                  ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ AnimoNote #1 │ │ AnimoNote #2 │ │ AnimoNote #3 │
    │ miku (CH1)   │ │ rin (CH2)    │ │ luka (CH10)  │
    │ 透明窗口      │ │ 透明窗口      │ │ 透明窗口      │
    │ Three.js     │ │ Three.js     │ │ Three.js     │
    └──────────────┘ └──────────────┘ └──────────────┘
```

### 2.2 Electron 多实例机制

#### 2.2.1 关闭单例锁

Electron 默认通过 [`app.requestSingleInstanceLock()`](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelock) 机制阻止多开。AnimoNote **必须显式禁用此行为**。

**策略：** 不在 `main.js` 中调用 `app.requestSingleInstanceLock()`，同时通过命令行参数 `--instance-id` 区分不同进程。

```javascript
// main.js — 多实例入口核心逻辑
const { app, BrowserWindow } = require('electron');
const path = require('path');

// 解析命令行参数
const args = process.argv.slice(2);
const instanceId = args.find(a => a.startsWith('--instance-id='))?.split('=')[1] || 'default';
const modelDir = args.find(a => a.startsWith('--model-dir='))?.split('=')[1] || `./models/${instanceId}`;

// ❌ 不调用 requestSingleInstanceLock — 允许无限多开
// app.requestSingleInstanceLock();  // 这行绝对不能出现

function createWindow() {
    const win = new BrowserWindow({
        width: 600,
        height: 800,
        transparent: true,           // 关键：透明背景
        frame: false,                // 无边框
        alwaysOnTop: true,           // 置顶
        resizable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // 加载角色页面，传入模型目录路径
    win.loadFile('index.html', {
        query: { instanceId, modelDir }
    });
}

app.whenReady().then(createWindow);
```

#### 2.2.3 启动方式

用户通过中央控制台一键启动实例，或手动通过命令行：

```powershell
# 手动启动单个实例
AnimoNote.exe --instance-id=miku --model-dir=./models/miku

# 中央控制台自动生成的启动命令
AnimoNote.exe --instance-id=rin --model-dir=./models/rin
```

每个实例是完全独立的 **操作系统进程**，拥有独立的 V8 堆、独立的 `BrowserWindow`、独立的 Three.js 渲染上下文。

### 2.3 MIDI 通道分流架构

#### 2.3.1 整体数据流

```
DAW (Ableton Live / FL Studio)
    │
    ├──→ loopMIDI (虚拟 MIDI 端口)  ←── 推荐方案
    │       │
    │       ├──→ AnimoNote #1 (监听 Channel 1)
    │       │       └── Web MIDI API: input.channel = 1
    │       │
    │       ├──→ AnimoNote #2 (监听 Channel 2)
    │       │       └── Web MIDI API: input.channel = 2
    │       │
    │       └──→ AnimoNote #3 (监听 Channel 10)
    │               └── Web MIDI API: input.channel = 10
    │
    └── 每个实例只处理自己通道的 Note On/Off 事件
```

#### 2.3.2 Web MIDI API 通道过滤

每个实例在初始化 MIDI 时，根据 `config.json` 中的 `midi_channel` 进行过滤：

```javascript
// midi-handler.js — 通道分流核心
class MidiHandler {
    constructor(config) {
        this.channel = config.midi_channel;   // 1-16
        this.noteMappings = config.note_mappings;
        this.onNoteOn = null;   // 回调：触发动画
        this.onNoteOff = null;  // 回调：停止动画（可选）
    }

    async init() {
        const access = await navigator.requestMIDIAccess();
        for (const input of access.inputs.values()) {
            input.onmidimessage = (event) => this._onMessage(event);
        }
    }

    _onMessage(event) {
        const [status, note, velocity] = event.data;
        const channel = (status & 0x0F) + 1;  // 提取 MIDI 通道 (1-16)
        const messageType = status & 0xF0;

        // ★ 核心：通道过滤 — 非本通道消息直接丢弃
        if (channel !== this.channel) return;

        if (messageType === 0x90 && velocity > 0) {
            // Note On
            const noteName = midiNoteToName(note);  // 0-127 → "C3"
            this._trigger(noteName, velocity);
        } else if (messageType === 0x80 || (messageType === 0x90 && velocity === 0)) {
            // Note Off
            const noteName = midiNoteToName(note);
            this._release(noteName);
        }
    }

    _trigger(noteName, velocity) {
        const mapping = this.noteMappings[noteName];
        if (!mapping) return;  // 未映射的音符，忽略

        if (this.onNoteOn) {
            this.onNoteOn({
                note: noteName,
                velocity,
                vmdPath: mapping.vmd_path,
                blendTime: mapping.blend_time,
                retriggerMode: mapping.retrigger_mode,
            });
        }
    }

    _release(noteName) {
        const mapping = this.noteMappings[noteName];
        if (!mapping) return;

        if (this.onNoteOff) {
            this.onNoteOff({ note: noteName });
        }
    }
}
```

#### 2.3.3 关于虚拟 MIDI 端口的说明

Web MIDI API 在 Windows 上通过 **Microsoft GS Wavetable Synth** 或第三方虚拟 MIDI 驱动（如 [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html)、[MIDIberry](https://www.midiberry.com/)）工作。推荐用户安装 **loopMIDI** 作为 DAW 与 AnimoNote 之间的桥梁。

> **注意：** Web MIDI API 在 Electron 中默认可用，无需额外 Native Addon。这是选择 Electron 而非其他框架的关键优势之一。

---

## 3. 中央控制台设计

### 3.1 定位与职责

**中央控制台（Control Center）** 是 AnimoNote 系统的**指挥中枢**，是一个独立的 Electron 窗口。它不加载 3D 场景，而是负责：

1. **MIDI 输入设备管理** — 枚举并选择可用的 MIDI 输入设备
2. **通道分配** — 为每个实例分配 MIDI 通道（1-16）
3. **实例生命周期管理** — 启动/停止/重启子进程
4. **模型目录管理** — 扫描 `models/` 目录，发现可用的角色配置
5. **运行状态监控** — 显示每个实例的 PID、CPU/内存占用、当前触发的音符

### 3.2 控制台 UI 布局

```
┌──────────────────────────────────────────────────────────────┐
│  AnimoNote Control Center  ─── □ ×                           │
├──────────────────────────────────────────────────────────────┤
│  ┌─ MIDI 输入 ──────────────────────────────────────────┐   │
│  │  [▼ loopMIDI Port]  [Refresh]  [Status: ✅ Connected] │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ 角色实例列表 ─────────────────────────────────────────┐   │
│  │  ┌──────┬────────┬───────┬────────┬────────┬────────┐  │   │
│  │  │ 角色  │ 通道   │ 状态  │  PID   │ 当前音符 │ 操作   │  │   │
│  │  ├──────┼────────┼───────┼────────┼────────┼────────┤  │   │
│  │  │ 初音  │ CH 01  │ 🟢 运行 │ 1234   │ C3     │ [停止] │  │   │
│  │  │ 镜音  │ CH 02  │ 🟢 运行 │ 5678   │ D#3    │ [停止] │  │   │
│  │  │ 巡音  │ CH 10  │ 🔴 停止 │ —      │ —      │ [启动] │  │   │
│  │  │ 弱音  │ CH 03  │ 🟡 待机 │ —      │ —      │ [启动] │  │   │
│  │  └──────┴────────┴───────┴────────┴────────┴────────┘  │   │
│  │                                                         │   │
│  │  [➕ 添加角色]  [🔄 全部重启]  [📁 打开模型目录]          │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ 日志输出 ───────────────────────────────────────────┐   │
│  │  [12:00:01] miku: Note On  C3  → wave.vmd            │   │
│  │  [12:00:02] rin:  Note On  D#3 → cymbal.vmd          │   │
│  │  [12:00:03] miku: Note Off C3                        │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 控制台与子进程的通信协议

控制台通过 **stdin/stdout JSON 管道** 与子进程通信：

```javascript
// control-center.js — 控制台核心逻辑
const { spawn } = require('child_process');

class InstanceManager {
    constructor() {
        this.instances = new Map();  // instanceId → ChildProcess
    }

    /**
     * 启动一个角色实例
     */
    startInstance(instanceId, modelDir, midiChannel) {
        const proc = spawn('AnimoNote.exe', [
            `--instance-id=${instanceId}`,
            `--model-dir=${modelDir}`,
            `--midi-channel=${midiChannel}`,
        ], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // 从子进程接收状态信息
        proc.stdout.on('data', (data) => {
            const msg = JSON.parse(data.toString());
            this._handleMessage(instanceId, msg);
        });

        this.instances.set(instanceId, {
            process: proc,
            midiChannel,
            status: 'running',
            currentNote: null,
        });
    }

    /**
     * 停止一个角色实例
     */
    stopInstance(instanceId) {
        const instance = this.instances.get(instanceId);
        if (instance) {
            instance.process.kill();
            this.instances.delete(instanceId);
        }
    }

    /**
     * 扫描 models/ 目录，发现可用的角色
     */
    async scanModels() {
        const fs = require('fs');
        const path = require('path');
        const modelsDir = './models';

        const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
        const available = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const configPath = path.join(modelsDir, entry.name, 'config.json');
                if (fs.existsSync(configPath)) {
                    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                    available.push({
                        id: entry.name,
                        displayName: config.display_name || entry.name,
                        configPath,
                        modelDir: path.join(modelsDir, entry.name),
                    });
                }
            }
        }

        return available;
    }
}
```

### 3.4 子进程 → 控制台的状态上报

每个子进程通过 stdout 定期上报状态：

```javascript
// 子进程 (renderer.js) — 状态上报
function reportStatus(status) {
    const message = JSON.stringify({
        type: 'status',
        instanceId: INSTANCE_ID,
        timestamp: Date.now(),
        ...status,
        // { currentNote: "C3", currentVmd: "wave.vmd", fps: 60, ... }
    });
    process.stdout.write(message + '\n');
}

// 每帧或状态变化时上报
setInterval(() => {
    reportStatus({
        currentNote: animationController.currentNote,
        currentVmd: animationController.currentVmd,
        fps: stats.getFPS(),
        memoryUsage: process.memoryUsage(),
    });
}, 1000);  // 每秒上报一次
```

---

## 4. 模型目录独立配置体系

### 4.1 目录结构规范

每个角色拥有**独立的模型目录**，目录内包含该角色所需的所有文件：

```
models/
├── miku/                          ← 角色目录名 = instance_id
│   ├── config.json                ← 角色配置文件（不含 note_mappings）
│   ├── mapping.json               ← 独立的音符映射文件
│   ├── miku.pmx                   ← MMD 模型文件
│   ├── idle.vmd                   ← 待机动作
│   └── actions/                   ← 动作 VMD 文件夹
│       ├── wave.vmd
│       ├── jump.vmd
│       ├── turn.vmd
│       ├── point.vmd
│       ├── kick.vmd
│       └── spin.vmd
│
├── rin/
│   ├── config.json
│   ├── mapping.json
│   ├── rin.pmx
│   ├── idle.vmd
│   └── actions/
│       ├── drum.vmd
│       ├── cymbal.vmd
│       └── hihat.vmd
│
└── luka/
    ├── config.json
    ├── mapping.json
    ├── luka.pmx
    ├── idle.vmd
    └── actions/
        └── ...
```

### 4.2 配置分离原则

| 文件 | 职责 | 是否可独立编辑 |
|------|------|--------------|
| [`config.json`](models/miku/config.json) | 角色身份、模型路径、窗口设置、MIDI 通道 | ✅ 用户可编辑 |
| [`mapping.json`](models/miku/mapping.json) | 音符→VMD 动作映射表 | ✅ 用户可编辑，可独立替换 |
| `*.pmx` | MMD 模型二进制文件 | ❌ 不直接编辑 |
| `*.vmd` | MMD 动作二进制文件 | ❌ 不直接编辑 |

### 4.3 config.json（不含映射）

```json
{
    "instance_id": "miku",
    "display_name": "初音未来",
    "midi_channel": 1,

    "model": {
        "pmx_path": "./miku.pmx",
        "vmd_path": "./idle.vmd",
        "scale": 1.0,
        "position": { "x": 0, "y": 0, "z": 0 },
        "rotation": { "x": 0, "y": 0, "z": 0 }
    },

    "window": {
        "width": 600,
        "height": 800,
        "position": { "x": 100, "y": 100 },
        "always_on_top": true,
        "mouse_through_default": true,
        "drag_modifier_key": "Alt"
    },

    "idle": {
        "vmd_path": "./idle.vmd",
        "loop": true,
        "blend_time": 0.3
    },

    "audio": {
        "enabled": false,
        "vocal_path": null
    },

    "physics": {
        "enabled": true,
        "gravity": -9.8,
        "substeps": 3
    }
}
```

### 4.4 mapping.json（独立音符映射文件）

```json
{
    "note_mappings": {
        "C3": {
            "vmd_path": "./actions/wave.vmd",
            "blend_time": 0.05,
            "retrigger_mode": "reset",
            "description": "挥手"
        },
        "D3": {
            "vmd_path": "./actions/jump.vmd",
            "blend_time": 0.1,
            "retrigger_mode": "smooth",
            "description": "跳跃"
        },
        "E3": {
            "vmd_path": "./actions/turn.vmd",
            "blend_time": 0.05,
            "retrigger_mode": "reset",
            "description": "转身"
        },
        "F#3": {
            "vmd_path": "./actions/point.vmd",
            "blend_time": 0.05,
            "retrigger_mode": "reset",
            "description": "指人"
        },
        "G3": {
            "vmd_path": "./actions/kick.vmd",
            "blend_time": 0.05,
            "retrigger_mode": "reset",
            "description": "踢腿"
        },
        "A4": {
            "vmd_path": "./actions/spin.vmd",
            "blend_time": 0.15,
            "retrigger_mode": "smooth",
            "description": "旋转"
        },
        "C4": {
            "vmd_path": "./actions/wave.vmd",
            "blend_time": 0.05,
            "retrigger_mode": "reset",
            "description": "挥手（高八度）"
        }
    }
}
```

### 4.5 加载逻辑

```javascript
// config-loader.js — 配置加载器
class ConfigLoader {
    /**
     * 从模型目录加载配置
     * @param {string} modelDir - 模型目录路径
     * @returns {{ config: object, mappings: object }}
     */
    static load(modelDir) {
        const path = require('path');
        const fs = require('fs');

        // 1. 加载 config.json
        const configPath = path.join(modelDir, 'config.json');
        if (!fs.existsSync(configPath)) {
            throw new Error(`Config not found: ${configPath}`);
        }
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

        // 2. 加载 mapping.json（独立文件）
        const mappingPath = path.join(modelDir, 'mapping.json');
        let mappings = {};
        if (fs.existsSync(mappingPath)) {
            mappings = JSON.parse(fs.readFileSync(mappingPath, 'utf-8')).note_mappings || {};
        }

        // 3. 合并：将 mappings 注入 config
        config.note_mappings = mappings;

        // 4. 解析相对路径为绝对路径（相对于模型目录）
        config.model.pmx_path = path.resolve(modelDir, config.model.pmx_path);
        config.model.vmd_path = path.resolve(modelDir, config.model.vmd_path);
        config.idle.vmd_path = path.resolve(modelDir, config.idle.vmd_path);

        for (const [note, mapping] of Object.entries(config.note_mappings)) {
            mapping.vmd_path = path.resolve(modelDir, mapping.vmd_path);
        }

        return config;
    }
}
```

---

## 5. 关键技术难点与终极解决方案

### 5.1 窗口层：完全透明 + 鼠标穿透

#### 5.1.1 Electron 透明窗口配置

```javascript
// main.js — 窗口配置
const win = new BrowserWindow({
    width: 600,
    height: 800,
    x: 100 + (instanceIndex * 50),   // 多实例错位排列
    y: 100 + (instanceIndex * 50),
    transparent: true,                // ★ 关键：RGBA 背景透明
    frame: false,                     // 无标题栏
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
```

#### 5.1.2 CSS 背景完全透明

```css
/* style.css — 渲染进程样式 */
html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent !important;  /* 关键 */
}

#canvas-container {
    width: 100%;
    height: 100%;
    background: transparent !important;
}

/* Three.js 渲染器背景透明 */
canvas {
    background: transparent !important;
}
```

#### 5.1.3 Three.js 渲染器透明配置

```javascript
// renderer.js — Three.js 透明渲染
const renderer = new THREE.WebGLRenderer({
    alpha: true,          // ★ 关键：启用 Alpha 通道
    antialias: true,
    preserveDrawingBuffer: false,
});
renderer.setClearColor(0x000000, 0);  // 完全透明背景 (alpha = 0)
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
```

#### 5.1.4 鼠标穿透（Click-Through）

这是最棘手的部分。Electron 的 `BrowserWindow` 默认会拦截鼠标事件。我们需要实现 **事件区域穿透**——让角色身体区域响应点击（用于拖拽），而透明区域让鼠标事件穿透到背后的 DAW。

**方案 A（推荐）：** 使用 `win.setIgnoreMouseEvents(true, { forward: true })` 配合 CSS `pointer-events` 控制。

```javascript
// main.js — 鼠标穿透逻辑
let isDragging = false;

// 默认：完全鼠标穿透
win.setIgnoreMouseEvents(true, { forward: true });

// 通过 IPC 从渲染进程接收拖拽状态
ipcMain.on('set-draggable', (event, draggable) => {
    if (draggable) {
        // 用户按住 Alt 键或点击了拖拽手柄 → 允许鼠标交互
        win.setIgnoreMouseEvents(false);
    } else {
        // 默认状态 → 鼠标穿透
        win.setIgnoreMouseEvents(true, { forward: true });
    }
});
```

```javascript
// renderer.js — 渲染进程
// 用户按住 Alt 键时允许拖拽
document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') {
        window.electronAPI.setDraggable(true);
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') {
        window.electronAPI.setDraggable(false);
    }
});
```

**方案 B（备选）：** 在角色底部绘制一个半透明的"拖拽手柄"UI 元素，只有点击该区域时才可交互。

### 5.2 音符解析层：MIDI 整数 → 音符字符串

#### 5.2.1 算法设计

MIDI 规范中，音符编号 `0-127` 与音名的对应关系如下：

| MIDI Note | 音名 | 八度 |
|-----------|------|------|
| 0         | C    | -1   |
| 12        | C    | 0    |
| 24        | C    | 1    |
| ...       | ...  | ...  |
| 60        | C    | 4    |
| 61        | C#   | 4    |
| 62        | D    | 4    |
| ...       | ...  | ...  |
| 127       | G    | 9    |

**转换公式：**

```
octave = Math.floor(note / 12) - 1
noteIndex = note % 12
```

#### 5.2.2 高效实现

```javascript
// midi-utils.js — MIDI 音符转换器
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * 将 MIDI Note 编号 (0-127) 转换为标准音名 (如 "C4", "F#3", "Bb2")
 * @param {number} midiNote - MIDI 音符编号 (0-127)
 * @returns {string} 标准音名
 */
function midiNoteToName(midiNote) {
    if (midiNote < 0 || midiNote > 127) {
        throw new Error(`Invalid MIDI note: ${midiNote}`);
    }
    const octave = Math.floor(midiNote / 12) - 1;
    const noteIndex = midiNote % 12;
    return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * 将标准音名 (如 "C4") 转换回 MIDI Note 编号
 * @param {string} noteName - 标准音名 (如 "C4", "F#3")
 * @returns {number} MIDI 音符编号 (0-127)
 */
function nameToMidiNote(noteName) {
    const match = noteName.match(/^([A-G][#b]?)(-?\d+)$/);
    if (!match) {
        throw new Error(`Invalid note name: ${noteName}`);
    }
    const [, name, octaveStr] = match;
    const octave = parseInt(octaveStr, 10);
    const noteIndex = NOTE_NAMES.indexOf(name);
    if (noteIndex === -1) {
        throw new Error(`Unknown note: ${name}`);
    }
    return (octave + 1) * 12 + noteIndex;
}

/**
 * 支持升调/降调别名 (如 "Bb2" → "A#2")
 * 用户配置中可能使用 "Bb" 而非 "A#"
 */
function normalizeNoteName(noteName) {
    const flatToSharp = {
        'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'
    };
    for (const [flat, sharp] of Object.entries(flatToSharp)) {
        if (noteName.includes(flat)) {
            return noteName.replace(flat, sharp);
        }
    }
    return noteName;
}
```

#### 5.2.3 性能基准

该算法仅涉及整数除法和取模运算，单次转换耗时 **< 0.001ms**。即使以 MIDI 的最高理论速率（约 1000 条消息/秒）运行，CPU 开销也完全可以忽略不计。

### 5.3 动画触发与重置层：Retrigger 机制

#### 5.3.1 问题定义

当用户以 **16 分音符（约 100ms 间隔）** 连续敲击同一个 MIDI 键时，Three.js 的 `MMDAnimationHelper` 面临以下挑战：

1. **动画叠加：** 连续触发可能导致多个动画实例叠加，造成骨骼扭曲
2. **状态残留：** 前一个动画尚未播放完毕，新动画无法正确重置
3. **平滑过渡：** 硬切换会导致视觉上的"跳帧"

#### 5.3.2 Retrigger 模式设计

```javascript
// animation-controller.js — Retrigger 核心逻辑
class AnimationController {
    constructor(mmdHelper, model) {
        this.helper = mmdHelper;
        this.model = model;
        this.activeAnimations = new Map();  // noteName → AnimationState
        this.lastTriggerTime = new Map();   // noteName → timestamp
        this.MIN_TRIGGER_INTERVAL = 20;     // 最小触发间隔 (ms)，防抖保护
    }

    /**
     * 触发音符对应的 VMD 动作
     */
    triggerNote(noteName, vmdPath, blendTime, retriggerMode) {
        // ★ 防抖保护：防止 16 分音符连续触发导致性能问题
        const now = performance.now();
        const lastTime = this.lastTriggerTime.get(noteName) || 0;
        if (now - lastTime < this.MIN_TRIGGER_INTERVAL) return;
        this.lastTriggerTime.set(noteName, now);

        const existing = this.activeAnimations.get(noteName);

        if (existing) {
            // ★ 同一音符正在播放 → 执行 Retrigger
            switch (retriggerMode) {
                case 'reset':
                    this._hardReset(existing, vmdPath, blendTime);
                    break;
                case 'smooth':
                    this._smoothRestart(existing, vmdPath, blendTime);
                    break;
                default:
                    this._hardReset(existing, vmdPath, blendTime);
            }
        } else {
            // 首次触发 → 正常播放
            this._startNew(noteName, vmdPath, blendTime);
        }
    }

    /**
     * 模式 A: 硬重置 (Hard Reset)
     * 立即停止当前动画，将骨骼重置到第 0 帧，然后重新播放
     * 适合：打击乐、吉他扫弦、鼓组等需要精确节拍的动作
     */
    _hardReset(existing, vmdPath, blendTime) {
        // 1. 立即停止当前动画
        this.helper.remove(this.model, existing.vmdAsset);

        // 2. 卸载旧的 VMD 资源
        existing.vmdAsset.dispose();

        // 3. 加载并播放新动画（从第 0 帧开始）
        this._loadAndPlay(existing.noteName, vmdPath, blendTime, 0);
    }

    /**
     * 模式 B: 平滑重启 (Smooth Restart)
     * 不打断当前动画，而是快速淡出 + 淡入新动画
     * 适合：舞蹈动作、连续旋律中的连奏
     */
    _smoothRestart(existing, vmdPath, blendTime) {
        // 1. 对当前动画设置快速淡出
        existing.fadingOut = true;
        existing.fadeOutDuration = blendTime;

        // 2. 同时开始加载新动画，加载完成后淡入
        this._loadAndPlay(existing.noteName, vmdPath, blendTime, 0, {
            fadeIn: true,
            fadeInDuration: blendTime,
        });
    }

    /**
     * 加载 VMD 并播放
     */
    async _loadAndPlay(noteName, vmdPath, blendTime, startFrame, options = {}) {
        const loader = new THREE.MMDLoader();
        const vmdAsset = await loader.loadAsync(vmdPath);

        const state = {
            noteName,
            vmdAsset,
            startTime: performance.now(),
            isPlaying: true,
        };

        this.activeAnimations.set(noteName, state);

        // 使用 MMDAnimationHelper 播放
        this.helper.add(this.model, vmdAsset, {
            loop: false,
            animationBlend: true,
            blendTime: blendTime,
        });

        // 设置起始帧
        if (startFrame > 0) {
            this.helper.setAnimationTime(this.model, vmdAsset, startFrame);
        }
    }

    /**
     * 释放音符（Note Off 或超时）
     */
    releaseNote(noteName, fadeOutTime = 0.1) {
        const existing = this.activeAnimations.get(noteName);
        if (!existing) return;

        // 淡出后移除
        this.helper.remove(this.model, existing.vmdAsset, fadeOutTime);
        this.activeAnimations.delete(noteName);
    }
}

#### 5.3.3 两种 Retrigger 模式的对比

| 特性 | `reset`（硬重置） | `smooth`（平滑重启） |
|------|-------------------|---------------------|
| **视觉表现** | 瞬间跳回第 0 帧重新播放 | 当前动作淡出，新动作淡入 |
| **延迟** | 极低（< 1 帧） | 较低（约 blendTime） |
| **适用场景** | 鼓组、打击乐、吉他扫弦 | 舞蹈、旋律连奏、长音 |
| **CPU 开销** | 低 | 中等（需要同时管理两个动画） |
| **实现复杂度** | 低 | 中 |

---

## 6. 数据结构定义与 Config 规范

### 6.1 完整配置字段说明

| 字段路径 | 类型 | 必填 | 说明 |
|---------|------|------|------|
| `instance_id` | `string` | ✅ | 实例唯一标识，用于命令行参数区分 |
| `display_name` | `string` | ✅ | 显示名称（窗口标题、调试日志） |
| `midi_channel` | `number` | ✅ | 监听的 MIDI 通道 (1-16) |
| `model.pmx_path` | `string` | ✅ | MMD 模型文件路径（相对模型目录） |
| `model.vmd_path` | `string` | ✅ | 默认待机动作路径 |
| `model.scale` | `number` | ❌ | 模型缩放 (默认 1.0) |
| `window.mouse_through_default` | `boolean` | ❌ | 默认是否鼠标穿透 (默认 true) |
| `window.drag_modifier_key` | `string` | ❌ | 拖拽修饰键 (默认 "Alt") |
| `idle.vmd_path` | `string` | ✅ | 待机动画路径 |
| `idle.loop` | `boolean` | ❌ | 待机动画是否循环 (默认 true) |
| `note_mappings` | `object` | ✅ | 音符→动作映射表，键为音名 (如 "C3")，来自 mapping.json |
| `note_mappings.*.vmd_path` | `string` | ✅ | 该音符对应的 VMD 动作文件 |
| `note_mappings.*.blend_time` | `number` | ❌ | 动画混合时间（秒，默认 0.1） |
| `note_mappings.*.retrigger_mode` | `string` | ❌ | 重触发模式: `"reset"` 或 `"smooth"` (默认 `"reset"`) |
| `physics.enabled` | `boolean` | ❌ | 是否启用 ammo.js 刚体物理 (默认 true) |

---

## 7. Vibe Coding 分步工程实施计划

> 以下将项目拆分为 **6 个微型阶段**，每个阶段均可独立交付、独立测试。每个阶段都适合用 AI 全量生成代码后手动 Debug。

### 阶段 0：中央控制台（Control Center）

**目标：** 创建中央控制台应用，负责扫描 `models/` 目录、管理 MIDI 输入设备、分配通道、启停子实例。这是整个系统的指挥中心。

**交付产物：**
- [`control-center/main.js`](control-center/main.js) — 控制台 Electron 主进程
- [`control-center/index.html`](control-center/index.html) — 控制台 UI
- [`control-center/style.css`](control-center/style.css) — 控制台样式
- [`control-center/renderer.js`](control-center/renderer.js) — 控制台逻辑（扫描模型、启停实例）
- [`control-center/instance-manager.js`](control-center/instance-manager.js) — 子进程管理器

**测试标准：**
1. ✅ 控制台启动后自动扫描 `models/` 目录，列出所有含 `config.json` 的角色
2. ✅ 可为每个角色分配 MIDI 通道（1-16）
3. ✅ 点击"启动"按钮，成功 spawn 子进程
4. ✅ 点击"停止"按钮，子进程被 kill
5. ✅ 控制台显示每个实例的运行状态

---

### 阶段 1：透明多壳子（Transparent Shell）

**目标：** 创建一个 Electron 应用，启动后显示一个完全透明、鼠标穿透的窗口，窗口内有一个简单的 Three.js 场景（一个旋转的立方体或球体），验证透明渲染和鼠标穿透机制。

**交付产物：**
- [`package.json`](package.json) — 项目依赖配置
- [`main.js`](main.js) — Electron 主进程（多实例入口、透明窗口、鼠标穿透）
- [`preload.js`](preload.js) — 预加载脚本（IPC 桥接）
- [`index.html`](index.html) — 渲染进程入口
- [`renderer.js`](renderer.js) — Three.js 场景（透明背景 + 旋转几何体）
- [`style.css`](style.css) — 透明样式

**测试标准：**
1. ✅ 启动后窗口完全透明，只能看到旋转的 3D 物体
2. ✅ 点击透明区域，鼠标事件穿透到桌面/其他窗口
3. ✅ 按住 Alt 键可以拖拽窗口
4. ✅ 同时启动两个实例（`--instance-id=a` 和 `--instance-id=b`），两个独立窗口互不干扰

---

### 阶段 2：MIDI 通道分流（MIDI Channel Router）

**目标：** 在阶段 1 的基础上，接入 Web MIDI API，实现 MIDI 通道过滤。每个实例只响应配置文件中指定的 MIDI 通道。

**交付产物：**
- [`src/midi-handler.js`](src/midi-handler.js) — MIDI 处理器（通道过滤 + 音符回调）
- [`src/midi-utils.js`](src/midi-utils.js) — MIDI 音符转换工具（`midiNoteToName` / `nameToMidiNote`）
- [`src/config-loader.js`](src/config-loader.js) — 配置加载器（加载 config.json + mapping.json）
- 更新 [`renderer.js`](renderer.js) — 集成 MIDI 处理器，收到音符时在控制台打印

**测试标准：**
1. ✅ 连接虚拟 MIDI 端口（如 loopMIDI），DAW 发送 MIDI 到指定通道
2. ✅ 实例 A（Channel 1）只打印 Channel 1 的音符
3. ✅ 实例 B（Channel 2）只打印 Channel 2 的音符
4. ✅ 控制台输出格式为 `[Note On] C4 velocity=100` 或 `[Note Off] C4`
5. ✅ `midiNoteToName(60)` 返回 `"C4"`，`nameToMidiNote("C4")` 返回 `60`

---

### 阶段 3：MMD 模型加载与待机动画（MMD Viewer）

**目标：** 在透明窗口中加载真实的 PMX 模型，播放待机 VMD 动画。这是视觉上最激动人心的阶段。

**交付产物：**
- [`src/mmd-loader.js`](src/mmd-loader.js) — MMD 模型加载器（封装 `MMDLoader`）
- [`src/mmd-viewer.js`](src/mmd-viewer.js) — MMD 场景管理器（灯光、相机、渲染循环）
- [`src/animation-controller.js`](src/animation-controller.js) — 动画控制器（播放/停止/切换）
- 更新 [`index.html`](index.html) — 集成 MMD 场景
- 示例模型目录 [`models/miku/`](models/miku/) — 含 config.json、mapping.json、pmx、vmd

**测试标准：**
1. ✅ 启动后透明窗口中显示完整的 MMD 模型
2. ✅ 模型正确播放待机动画（idle.vmd），循环播放
3. ✅ 模型缩放、位置、旋转可通过配置文件调整
4. ✅ 窗口大小自适应模型显示

---

### 阶段 4：音符触发动作（Note → VMD Trigger）

**目标：** 将阶段 2 的 MIDI 输入与阶段 3 的 MMD 动画系统连接起来。收到 MIDI 音符时，触发对应的 VMD 动作，并实现 Retrigger 机制。

**交付产物：**
- 更新 [`src/animation-controller.js`](src/animation-controller.js) — 实现 `triggerNote()` / `releaseNote()` 和 Retrigger 逻辑
- 更新 [`src/midi-handler.js`](src/midi-handler.js) — 连接 MIDI 回调到动画控制器
- 更新 [`models/miku/mapping.json`](models/miku/mapping.json) — 添加完整的音符映射配置

**测试标准：**
1. ✅ DAW 发送 `C3` → 模型执行 `wave.vmd`
2. ✅ DAW 发送 `D3` → 模型执行 `jump.vmd`
3. ✅ 连续快速发送 `C3`（16 分音符节奏）→ 模型每次都能重置并重新播放（Retrigger）
4. ✅ `retrigger_mode: "reset"` 瞬间跳回第 0 帧
5. ✅ `retrigger_mode: "smooth"` 平滑过渡到新动作
6. ✅ 未映射的音符被忽略，不产生任何动作

---

### 阶段 5：多实例虚拟乐队（Multi-Instance Orchestra）

**目标：** 最终的集成阶段。通过中央控制台启动多个实例，每个实例加载不同的角色、监听不同的 MIDI 通道，在桌面上形成虚拟乐队。

**交付产物：**
- [`models/miku/`](models/miku/) — 初音未来（Channel 1）
- [`models/rin/`](models/rin/) — 镜音铃（Channel 2）
- [`models/luka/`](models/luka/) — 巡音露卡（Channel 10）
- [`launcher.ps1`](launcher.ps1) — PowerShell 一键启动脚本（备用）
- 更新 [`control-center/`](control-center/) — 完善多实例管理功能

**测试标准：**
1. ✅ 通过控制台一键启动 3 个实例
2. ✅ 每个实例显示不同的角色
3. ✅ DAW 在 Channel 1 发送音符 → 只有初音未来响应
4. ✅ DAW 在 Channel 2 发送音符 → 只有镜音铃响应
5. ✅ DAW 在 Channel 10 发送音符 → 只有巡音露卡响应
6. ✅ 所有窗口完全透明、鼠标穿透，不影响 DAW 操作
7. ✅ 控制台正确显示所有实例的运行状态和当前音符

---

## 8. 附录：项目目录结构

```
AnimoNote/
│
├── package.json                     # 项目依赖 (Electron, Three.js, ammo.js)
├── main.js                          # Electron 主进程入口（子实例用）
├── preload.js                       # 预加载脚本（IPC 桥接）
├── index.html                       # 渲染进程入口
├── renderer.js                      # 渲染进程主逻辑
├── style.css                        # 透明样式
│
├── control-center/                  # 中央控制台
│   ├── main.js                      # 控制台 Electron 主进程
│   ├── index.html                   # 控制台 UI
│   ├── style.css                    # 控制台样式
│   ├── renderer.js                  # 控制台逻辑
│   └── instance-manager.js          # 子进程管理器
│
├── src/                             # 核心源码
│   ├── midi-handler.js              # MIDI 处理器（通道过滤）
│   ├── midi-utils.js                # MIDI 音符转换工具
│   ├── config-loader.js             # 配置加载器
│   ├── mmd-loader.js                # MMD 模型加载器
│   ├── mmd-viewer.js                # MMD 场景管理器
│   └── animation-controller.js      # 动画控制器（Retrigger）
│
├── models/                          # 角色模型目录
│   ├── miku/                        # 初音未来
│   │   ├── config.json              # 角色配置
│   │   ├── mapping.json             # 音符映射表
│   │   ├── miku.pmx                 # MMD 模型
│   │   ├── idle.vmd                 # 待机动作
│   │   └── actions/                 # 动作 VMD 文件夹
│   │       ├── wave.vmd
│   │       ├── jump.vmd
│   │       ├── turn.vmd
│   │       ├── point.vmd
│   │       ├── kick.vmd
│   │       └── spin.vmd
│   │
│   ├── rin/                         # 镜音铃
│   │   ├── config.json
│   │   ├── mapping.json
│   │   ├── rin.pmx
│   │   ├── idle.vmd
│   │   └── actions/
│   │       ├── drum.vmd
│   │       ├── cymbal.vmd
│   │       └── hihat.vmd
│   │
│   └── luka/                        # 巡音露卡
│       ├── config.json
│       ├── mapping.json
│       ├── luka.pmx
│       ├── idle.vmd
│       └── actions/
│
├── launcher.ps1                     # PowerShell 一键启动脚本
│
└── plans/                           # 计划文档
    └── AnimoNote_Technical_Implementation_Plan.md
```

---

> **文档结束。**
> *让每一个音符，都成为角色舞动的灵魂。*