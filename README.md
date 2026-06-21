# 🎵 AnimoNote — 桌面虚拟乐手系统

> **Desktop Virtual Musician System**  
> 将 MMD 模型转化为实时 MIDI 驱动的虚拟乐手的硬核工具。

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Electron](https://img.shields.io/badge/Electron-28.x-47848F)
![Three.js](https://img.shields.io/badge/Three.js-0.160-000000)
![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 📖 目录

- [项目简介](#-项目简介)
- [核心特性](#-核心特性)
- [系统架构](#-系统架构)
- [环境要求](#-环境要求)
- [快速开始](#-快速开始)
- [配置指南](#-配置指南)
- [使用说明](#-使用说明)
- [开发指南](#-开发指南)
- [部署与构建](#-部署与构建)
- [项目结构](#-项目结构)
- [常见问题](#-常见问题)

---

## 🎯 项目简介

**AnimoNote** 是一个基于 Electron + Three.js 的桌面应用程序，它允许你：

1. 将 **MMD 模型**（PMX 格式）加载到透明窗口中，显示在桌面上
2. 通过 **MIDI 设备**（如 MIDI 键盘 / DAW 虚拟 MIDI 端口）实时控制 MMD 角色
3. 为每个 **音符** 映射不同的 **VMD 动作**，让角色随音乐起舞
4. 支持 **多角色同时登场**，每个角色独立响应不同的 MIDI 通道
5. 内置 **排练模式**，可在 3D 场景中自由调整角色的位置、旋转和缩放
6. **MMD 观赏模式**，可播放完整的 VMD 动作文件并同步音频

简单来说：**用 MIDI 音符触发 MMD 角色的舞蹈动作，在桌面上打造一场全息演唱会。**

### 核心工作流

```
DAW (Ableton/FL Studio)
    │
    ├── MIDI 输出 (虚拟 MIDI 端口, 如 loopMIDI)
    │       │
    │       ├──→ AnimoNote (Channel 1)  →  初音未来
    │       │       │                        ├── C3 → 挥手.vmd
    │       │       │                        ├── D3 → 跳跃.vmd
    │       │       │                        └── E3 → 转身.vmd
    │       │
    │       └──→ AnimoNote (Channel 2)  →  镜音铃
    │               │                        ├── C3 → 敲鼓.vmd
    │               │                        ├── D3 → 钹.vmd
    │               │                        └── E3 → 踩镲.vmd
    │
    └── 最终效果：桌面上多个透明角色同时演奏，形成虚拟乐队
```

---

## ✨ 核心特性

### 🎹 MIDI 驱动
- 通过 **Web MIDI API** 连接任意 MIDI 输入设备
- 支持 **1-16 通道**独立过滤，多角色可分属不同通道
- 自动 **BPM 追踪**（通过 MIDI Clock 信号）
- 灵活的音符映射引擎：每个音符可绑定独立的 VMD 动作

### 🎭 MMD 渲染
- 支持加载 **PMX 格式** 的 MMD 模型
- 支持 **VMD 格式** 的动作文件驱动骨骼动画
- 基于 **Three.js** 的 WebGL 渲染，支持阴影、抗锯齿、色调映射
- 支持 **Ammo.js** 物理引擎（基于 Bullet），模拟服装物理

### 🪟 透明窗口
- 完全透明的 Electron 窗口，角色浮现在桌面上
- **鼠标穿透** 模式，不影响日常操作
- 窗口始终置顶，支持多显示器
- GPU 加速优化（Direct3D 11 / ANGLE）

### 🎬 MMD 观赏模式
- 无视 MIDI 输入，播放完整的 VMD 动作 + 同步音频
- 支持 **播放列表** 管理，可创建多个条目
- 支持 **摄像机 VMD**（单独的文件，独立于角色动作）
- 播放模式：单曲循环、列表循环、随机播放

### 🎛️ 中央控制台
- Vue 3 + Naive UI 构建的图形化管理界面
- **角色管理**：扫描、创建、删除角色
- **配置编辑**：编辑模型的 PMX/VMD 路径、缩放、位置等
- **映射编辑**：为每个 MIDI 音符配置对应的 VMD 动作
- **实时状态**：查看已召唤角色的 FPS、当前动作等信息

### 🔧 排练模式
- 3D 场景中自由拖拽角色（位置/旋转/缩放）
- 支持 **TransformControls**（移动 G / 旋转 R / 缩放 S）
- 可调节角色透明度、亮度、阴影属性
- 退出时自动保存位置到角色配置

### 📷 摄像机模块
- 固定实例（不可删除），支持 MIDI 触发的摄像机动作切换
- 独立的 VMD 动作映射

---

## 🏗️ 系统架构

### 进程模型

```
┌──────────────────────────────────────────────────────────┐
│                AnimoNote (Electron 主进程)                  │
│                                                          │
│  ┌─────────────────┐      ┌──────────────────────────┐  │
│  │  控制中心窗口     │      │    场景窗口 (透明)          │  │
│  │  (Vue 3 + Naive) │◄─IPC─►  (Three.js 3D 渲染器)     │  │
│  │  - 角色管理       │      │  - MMD 模型渲染            │  │
│  │  - 映射编辑       │      │  - MIDI 事件处理           │  │
│  │  - 配置编辑       │      │  - 多角色编排               │  │
│  │  - 观赏模式       │      │  - 排练模式                 │  │
│  └─────────────────┘      └──────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

- **单进程多窗口架构**：控制中心和场景窗口运行在同一个 Electron 进程中
- 控制中心窗口：1200×800，可最大化，用于管理配置
- 场景窗口：全屏、透明、无边框、置顶、鼠标穿透，用于渲染 3D 角色

### 数据流

```
MIDI 设备 → Web MIDI API
    ↓
MidiHandler (通道过滤 + 音符解析)
    ↓
音符映射查找 (note_mappings → vmd_path)
    ↓
AnimationController.triggerNote()
    ↓
MMDAnimationHelper.add(model, vmdAsset)
    ↓
渲染循环 → WebGL → 透明窗口 → 桌面显示
```

### 技术栈

| 技术 | 用途 |
|------|------|
| **Electron 28.x** | 桌面应用框架，窗口管理 |
| **Vue 3.x** | 控制中心前端框架 |
| **Naive UI** | Vue 组件库（深色主题） |
| **Three.js 0.160** | 3D 渲染引擎 |
| **Three.js MMD addons** | MMDLoader + MMDAnimationHelper |
| **Ammo.js** | Bullet 物理引擎（服装物理） |
| **Web MIDI API** | MIDI 输入设备通信 |
| **Vite** | 控制中心开发服务器与构建工具 |

---

## 📋 环境要求

| 依赖 | 版本要求 |
|------|---------|
| **Node.js** | ≥ 18.x |
| **npm** | ≥ 9.x |
| **操作系统** | Windows 10/11（推荐）、macOS、Linux |
| **GPU** | 支持 Direct3D 11（Windows）/ OpenGL 3.3+ |
| **MIDI 设备** | 任意 MIDI 输入设备（或虚拟 MIDI 端口如 loopMIDI） |

> **Windows 推荐配置：** 独立显卡 + loopMIDI（虚拟 MIDI 端口）+ DAW（如 FL Studio、Ableton Live）

---

## 🚀 快速开始

### 1️⃣ 安装依赖

```bash
# 克隆或进入项目目录
cd AnimoNote

# 安装 npm 依赖
npm install
```

### 2️⃣ 准备模型

在 `models/` 目录下创建角色文件夹，结构如下：

```
models/
└── my_character/              # 角色 ID（目录名）
    ├── config.json            # 角色配置（必填）
    ├── mapping.json           # 音符映射（可选）
    ├── character.pmx          # MMD 模型文件（必填）
    ├── idle.vmd               # 待机动作（推荐）
    └── actions/               # 动作 VMD 文件夹
        ├── dance1.vmd
        ├── dance2.vmd
        └── ...
```

### 3️⃣ 启动应用

```bash
# 生产模式启动
npm start

# 开发模式启动（带 DevTools）
npm run start:dev
```

### 4️⃣ 使用 PowerShell 启动器（Windows）

```powershell
# 启动控制台 + 所有已配置的角色
.\launcher.ps1

# 仅启动控制台
.\launcher.ps1 -ConsoleOnly
```

启动后，控制中心窗口将自动打开，扫描 `models/` 目录中的角色。

---

## ⚙️ 配置指南

### 角色配置 (`models/<id>/config.json`)

```json
{
  "instance_id": "miku",
  "display_name": "初音未来",
  "midi": {
    "channel": 1,
    "root_note": "C4"
  },
  "model": {
    "pmx_path": "./miku.pmx",
    "vmd_path": "./idle.vmd",
    "scale": 1.0,
    "position": { "x": 0, "y": 0, "z": 0 },
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "opacity": 1.0,
    "brightness": 1.0,
    "shadow_enabled": true,
    "shadow_opacity": 0.45,
    "shadow_color": "#000000"
  },
  "idle": {
    "vmd_path": "./idle.vmd",
    "loop": true,
    "blend_time": 0.3
  },
  "blink": {
    "enabled": true,
    "min_interval": 2000,
    "max_interval": 6000,
    "duration": 120
  },
  "physics": {
    "enabled": true,
    "gravity": -9.8,
    "substeps": 3,
    "reset_on_loop": true
  }
}
```

### 音符映射 (`models/<id>/mapping.json`)

```json
{
  "note_mappings": {
    "C4": {
      "vmd_path": "./actions/c4.vmd",
      "blend_time": 0.1,
      "retrigger_mode": "reset",
      "play_mode": "once",
      "fade_mode": "fixed",
      "fade_in": 0.1,
      "fade_out": 0.1,
      "description": "Low C"
    },
    "D4": {
      "vmd_path": "./actions/d4.vmd",
      "blend_time": 0.15,
      "retrigger_mode": "smooth",
      "play_mode": "once",
      "fade_mode": "fixed"
    }
  }
}
```

**参数说明：**

| 参数 | 说明 | 可选值 |
|------|------|--------|
| `vmd_path` | VMD 动作文件路径（相对模型目录） | `"./actions/dance.vmd"` |
| `blend_time` | 动画过渡时间（秒） | `0.05` ~ `1.0` |
| `retrigger_mode` | 重复触发模式 | `"reset"`（硬重置）、`"smooth"`（平滑过渡） |
| `play_mode` | 播放模式 | `"once"`（一次）、`"loop"`（循环） |
| `fade_mode` | 淡入淡出模式 | `"fixed"`（固定时长）、`"bpm"`（按 BPM 同步） |

### 全局设置 (`settings.json`)

```json
{
  "midi": {
    "deviceName": "loopMIDI Port 1 in"
  },
  "displayId": 917481049,
  "debug": {
    "enabled": false,
    "show_grid": true,
    "show_info": true
  }
}
```

### 观赏模式配置 (`viewing.json`)

```json
{
  "enabled": false,
  "playlists": { "entries": [] },
  "playMode": "single"
}
```

---

## 📖 使用说明

### 控制中心界面

启动后，控制中心界面包含以下主要区域：

1. **顶部工具栏** — MIDI 设备选择、全部启动/停止
2. **左侧角色列表** — 显示扫描到的所有角色，可创建新角色
3. **主内容区** — 包含三个标签页：
   - **📋 实例** — 召唤/召回角色、排练模式
   - **⚙️ 角色配置** — 编辑选中角色的配置
   - **🎼 映射** — 编辑选中角色的音符映射
4. **📝 日志面板** — 显示操作日志

### 基本工作流

#### 1. 召唤角色
- 在左侧角色列表中点击角色 → 在"实例"标签页点击 **召唤**
- 角色将出现在全屏透明场景窗口中
- 也可点击 **召唤全部** 一次性召唤所有角色

#### 2. 配置音符映射
- 选中角色 → 切换到"映射"标签页
- 使用"快速添加"功能：选择音符 + 选择 VMD 文件 → 点击添加
- 也可直接编辑映射表格中的参数
- 点击 **💾 保存** 写入 `mapping.json`

#### 3. 演奏
- 连接 MIDI 设备（或打开 DAW + loopMIDI）
- 按下 MIDI 音符 → 角色自动播放对应的 VMD 动作
- 控制中心实时显示每个角色的当前音符和动作

#### 4. 排练模式
- 点击 **排练模式** 按钮进入
- 使用鼠标拖拽调整摄像机视角
- 点击角色 → 使用 G（移动）/ R（旋转）/ S（缩放）调整
- 在属性面板中调整透明度、亮度、阴影
- 点击 **保存并退出** 自动保存所有设置

#### 5. MMD 观赏模式
- 切换到"观赏模式"标签页
- 开启开关 → 添加播放列表条目（VMD + 音频）
- 点击 **播放全部** 播放完整舞蹈
- 此模式下 MIDI 输入被忽略

---

## 💻 开发指南

### 开发环境启动

```bash
# 1. 启动 Vite 开发服务器（端口 5173）
npm run dev:control-center

# 2. 另一个终端启动 Electron（--dev 模式自动连接 Vite）
npm run start:dev

# 或使用开发启动器（一键启动）
.\dev-launcher.ps1
# 附带角色实例：
.\dev-launcher.ps1 -WithModels
```

### 项目脚本

| 命令 | 说明 |
|------|------|
| `npm run dev:control-center` | 启动 Vite 开发服务器 |
| `npm run build:control-center` | 构建控制中心为静态文件 |
| `npm start` | 生产模式启动 |
| `npm run start:dev` | 开发模式启动（联机 Vite） |

### 构建前的 UI 准备

```bash
npm run build:control-center
# 输出到 control-center/dist/
```

> 生产模式下，控制中心从 `control-center/dist/index.html` 加载（Vite 构建产物）。

---

## 📦 部署与构建

### 生产部署

#### 方式一：直接运行（推荐开发/调试）

```bash
# 1. 构建控制中心 UI
npm run build:control-center

# 2. 直接启动 Electron
npm start
```

> 需要用户自行安装 Node.js 和 npm。

#### 方式二：打包为独立可执行文件

使用 `electron-builder` 或 `electron-packager` 打包为独立的桌面应用。

```bash
# 安装打包工具
npm install --save-dev electron-builder

# 在 package.json 中添加构建配置
```

**建议的 `package.json` 构建配置：**

```json
{
  "build": {
    "appId": "com.animonote.app",
    "productName": "AnimoNote",
    "directories": {
      "output": "release"
    },
    "files": [
      "control-center/main.js",
      "control-center/preload.js",
      "control-center/dist/**/*",
      "index.html",
      "preload.js",
      "renderer.js",
      "style.css",
      "src/**/*",
      "camera/**/*",
      "models/**/*",
      "package.json"
    ],
    "win": {
      "target": ["nsis", "portable"]
    },
    "mac": {
      "target": ["dmg"]
    },
    "linux": {
      "target": ["AppImage"]
    }
  }
}
```

```bash
# 构建 Windows 安装包
npx electron-builder --win

# 构建所有平台
npx electron-builder -mwl
```

#### 方式三：便携版（无需安装）

使用 `electron-builder` 的 `portable` 目标：

```bash
npx electron-builder --win portable
```

输出文件位于 `release/` 目录。

### 部署注意事项

1. **模型文件**：`models/` 目录默认被 `.gitignore` 忽略，部署时需单独打包模型文件
2. **GPU 加速**：确保目标系统支持 Direct3D 11 或 OpenGL 3.3+
3. **MIDI 驱动**：Windows 可能需要安装 [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html)（虚拟 MIDI 端口）
4. **透明窗口**：仅 Windows 和 macOS 完全支持透明无边框窗口

---

## 📁 项目结构

```
AnimoNote/
├── main.js                          # 子实例主进程（旧架构，保留参考）
├── preload.js                       # 子实例预加载（旧架构）
├── renderer.js                      # 场景窗口渲染器（Three.js + MIDI + 多角色）
├── index.html                       # 场景窗口模板
├── style.css                        # 场景窗口样式
├── package.json                     # 项目配置与依赖
├── settings.json                    # 全局应用设置
├── launcher.ps1                     # PowerShell 一键启动脚本
├── dev-launcher.ps1                 # 开发环境启动脚本
├── .gitignore                       # Git 忽略配置
│
├── control-center/                  # 中央控制台
│   ├── main.js                      # Electron 主进程（窗口管理 + IPC）
│   ├── preload.js                   # 控制台预加载脚本
│   ├── index.html                   # 控制台 HTML 入口
│   ├── vite.config.js               # Vite 构建配置
│   └── src/                         # Vue 3 源码
│       ├── main.js                  # Vue 应用入口
│       ├── App.vue                  # 根组件
│       ├── composables/
│       │   └── useBridge.js         # IPC 桥接 + 响应式状态
│       ├── components/
│       │   ├── ModelList.vue        # 角色列表
│       │   ├── InstanceTable.vue    # 实例管理表格
│       │   ├── ConfigEditor.vue     # 角色配置编辑器
│       │   ├── MappingEditor.vue    # 音符映射编辑器
│       │   ├── MmdViewer.vue        # MMD 观赏模式控制器
│       │   ├── CameraConfigEditor.vue # 摄像机配置编辑器
│       │   └── LogPanel.vue         # 日志面板
│       └── utils/
│           └── midi-utils.js        # MIDI 音符转换工具
│
├── src/                             # 场景核心模块
│   ├── bridge.js                    # 全局变量桥接
│   ├── config-loader.js             # 配置加载器（config + mapping 合并）
│   ├── midi-handler.js              # MIDI 处理器（通道过滤、音符映射）
│   ├── midi-utils.js                # MIDI 音符双向转换工具
│   ├── animation-controller.js      # 动画控制器（防抖、重触发、淡入淡出）
│   ├── blink-controller.js          # 随机眨眼控制器
│   ├── mmd-loader.js                # MMD 模型/动作加载器（Promise 封装）
│   └── mmd-viewer.js                # MMD 场景管理器（灯光、相机、渲染）
│
├── camera/                          # 摄像机模块
│   ├── config.json                  # 摄像机配置
│   ├── mapping.json                 # 摄像机 VMD 映射
│   └── actions/
│       └── default.vmd              # 默认摄像机动画
│
├── models/                          # 角色模型目录（.gitignore 忽略）
│   ├── .keep
│   ├── fnn/                         # 示例角色：芙宁娜
│   │   ├── config.json
│   │   ├── mapping.json
│   │   ├── 【芙宁娜】.pmx
│   │   └── actions/
│   └── ydhl/                        # 示例角色：伊德海莉
│       ├── config.json
│       ├── mapping.json
│       ├── 伊德海莉.pmx
│       └── actions/
│
└── plans/                           # 技术文档
    └── AnimoNote_Technical_Implementation_Plan.md
```

---

## ❓ 常见问题

### Q: 启动后窗口是黑屏/透明失效？
- 确保 GPU 驱动已更新
- 尝试在 `main.js` 中调整 `--use-angle` 参数（如 `d3d11` → `d3d9`）
- 某些虚拟机或远程桌面环境不支持透明窗口

### Q: MIDI 设备无法连接？
- 确保 MIDI 设备已连接并通电
- 使用 Chrome 浏览器访问 [MIDI Test Page](https://www.onlinemiditest.com/) 测试
- 在控制中心的 MIDI 设备下拉框中点击"刷新设备"
- Windows 上需安装相应的 MIDI 驱动

### Q: 模型不显示？
- 确认 `config.json` 中的 `model.pmx_path` 路径正确
- 确认 PMX 文件存在于对应路径
- 查看控制台日志（`Ctrl+Shift+I` 打开 DevTools）

### Q: 动画卡顿/掉帧？
- 降低 `settings.json` 中的渲染分辨率
- 关闭不必要的角色阴影
- 减少同时召唤的角色数量
- 确保使用独立显卡运行

### Q: "Cannot enlarge memory arrays" 错误？
- 这是 Ammo.js WASM 堆内存耗尽问题
- 减少频繁切换的 VMD 动作数量
- 重启应用
- 这是 `animation-controller.js` 中已修复的已知问题（永不反复 remove/add）

### Q: 如何创建新角色？
- 在控制中心左侧点击 **＋** 按钮
- 输入角色 ID（英文目录名）和显示名称
- 或将现成的 PMX 模型文件放入 `models/<id>/` 目录，手动创建 `config.json`

### Q: 如何设置 MIDI 路由？
- 在角色 `config.json` 中设置 `midi.channel`
- 每个角色监听独立的 MIDI 通道
- 场景窗口支持多角色同通道路由

---

## 🔗 相关资源

- [Three.js MMD 示例](https://threejs.org/examples/#webgl_loader_mmd)
- [loopMIDI（虚拟 MIDI 端口）](https://www.tobias-erichsen.de/software/loopmidi.html)
- [MMD 模型配布站](https://www.deviantart.com/)
- [PMX Editor（模型编辑）](https://www.givedo.net/)

---

## 📄 许可证

[MIT License](LICENSE)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/AI-Hobbyist">AI-Hobbyist</a>
</p>
