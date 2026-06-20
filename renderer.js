/**
 * AnimoNote - 场景窗口渲染器（单窗口多角色）
 * 
 * 管理一个 Three.js 场景中的所有 MMD 角色。
 * 通过 IPC 接收来自主进程的召唤/召回/排练模式指令。
 */

const urlParams = new URLSearchParams(window.location.search);

// ============================================================
// 主初始化
// ============================================================

async function main() {
    const api = window.electronAPI;

    // ============================================================
    // 加载 Ammo.js（物理引擎，需全局注册供 MMDPhysics 使用）
    // ammo.js UMD 加载后自动将 window.Ammo 设为已初始化的模块
    // ============================================================
    let ammoLoaded = false;
    console.log('[Scene] Loading Ammo.js physics engine...');
    if (typeof Ammo !== 'undefined') {
        ammoLoaded = true;
        console.log('[Scene] Ammo.js already loaded');
    } else {
        await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = './node_modules/ammo.js/ammo.js';
            script.onload = () => {
                ammoLoaded = typeof Ammo !== 'undefined';
                console.log('[Scene] Ammo.js loaded, physics available:', ammoLoaded);
                resolve();
            };
            script.onerror = () => {
                console.warn('[Scene] Failed to load ammo.js, physics will be disabled');
                resolve(); // 不阻塞初始化流程
            };
            document.head.appendChild(script);
        });
    }

    // ============================================================
    // 动态导入 Three.js ES Modules
    // ============================================================
    let THREE, MMDLoader, MMDAnimationHelper, OrbitControls, TransformControls;

    console.log('[Scene] Loading Three.js modules...');
    THREE = await import('three');
    const mmdLoaderMod = await import('three/addons/loaders/MMDLoader.js');
    const mmdHelperMod = await import('three/addons/animation/MMDAnimationHelper.js');
    const orbitCtrlMod = await import('three/addons/controls/OrbitControls.js');
    const transformCtrlMod = await import('three/addons/controls/TransformControls.js');
    MMDLoader = mmdLoaderMod.MMDLoader;
    MMDAnimationHelper = mmdHelperMod.MMDAnimationHelper;
    OrbitControls = orbitCtrlMod.OrbitControls;
    TransformControls = transformCtrlMod.TransformControls;

    // 挂到全局供 AnimationController 使用
    window.MMDLoader = MMDLoader;

    // ============================================================
    // 场景初始化
    // ============================================================

    const container = document.getElementById('canvas-container');

    const renderer = new THREE.WebGLRenderer({
        alpha: true, antialias: true, preserveDrawingBuffer: false,
        powerPreference: 'high-performance', stencil: false, depth: true,
    });
    renderer.setClearColor(0x1a1a2e, 0); // alpha = 0 (完全透明)
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 20);
    camera.lookAt(0, 5, 0);

    // ============================================================
    // 灯光
    // ============================================================

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(5, 15, 10);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 200;
    mainLight.shadow.bias = -0.001;
    // 初始设为合适范围，之后从设置加载
    mainLight.shadow.camera.left = -100;
    mainLight.shadow.camera.right = 100;
    mainLight.shadow.camera.top = 100;
    mainLight.shadow.camera.bottom = -100;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.5);
    fillLight.position.set(-8, 5, -10);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffaa66, 0.4);
    rimLight.position.set(8, 2, -12);
    scene.add(rimLight);

    const bottomLight = new THREE.DirectionalLight(0xffffff, 0.3);
    bottomLight.position.set(0, -5, 5);
    scene.add(bottomLight);

    // ============================================================
    // Grid Helper（排练模式显示）
    // ============================================================

    const gridHelper = new THREE.GridHelper(20, 20, 0x4fc3f7, 0x2a2a4a);
    gridHelper.position.y = -0.5;
    gridHelper.visible = false;
    scene.add(gridHelper);

    // ============================================================
    // 调试模式：地面网格（绿色调，区别于排练模式的蓝色网格）
    // ============================================================

    const debugGrid = new THREE.GridHelper(30, 30, 0x66bb6a, 0x2e7d32);
    debugGrid.position.y = -0.49;
    debugGrid.visible = false;
    scene.add(debugGrid);

    // Axes helper（调试模式下显示坐标轴）
    const debugAxes = new THREE.AxesHelper(5);
    debugAxes.visible = false;
    scene.add(debugAxes);

    // ============================================================
    // 阴影接收地面（全局阴影平面）
    // ============================================================

    // 默认阴影设置
    const shadowSettings = {
        enabled: true,
        opacity: 0.45,
        color: '#000000',
        cameraSize: 100,
    };

    /**
     * 更新阴影摄像机范围（可无限大）
     */
    function updateShadowCameraSize(size) {
        shadowSettings.cameraSize = size;
        mainLight.shadow.camera.left = -size;
        mainLight.shadow.camera.right = size;
        mainLight.shadow.camera.top = size;
        mainLight.shadow.camera.bottom = -size;
        mainLight.shadow.camera.updateProjectionMatrix();
    }

    const shadowGroundGeometry = new THREE.PlaneGeometry(2000, 2000);
    const shadowGroundMaterial = new THREE.ShadowMaterial({
        opacity: shadowSettings.opacity,
        color: shadowSettings.color,
        transparent: true,
        depthWrite: false,
    });
    const shadowGround = new THREE.Mesh(shadowGroundGeometry, shadowGroundMaterial);
    shadowGround.position.set(0, -0.5, 0);
    shadowGround.rotation.x = -Math.PI / 2;
    shadowGround.receiveShadow = true;
    shadowGround.visible = shadowSettings.enabled;
    scene.add(shadowGround);

    /**
     * 更新全局阴影外观
     */
    function updateShadowAppearance() {
        shadowGroundMaterial.opacity = shadowSettings.opacity;
        shadowGroundMaterial.color.set(shadowSettings.color);
        shadowGroundMaterial.needsUpdate = true;
        // 仅当全局开关开启且至少一个角色有阴影时才显示地面
        let anyCharHasShadow = shadowSettings.enabled;
        if (anyCharHasShadow) {
            anyCharHasShadow = false;
            for (const [, char] of characters) {
                if (char.model) {
                    char.model.traverse((child) => {
                        if (child.isMesh && child.castShadow) {
                            anyCharHasShadow = true;
                        }
                    });
                }
            }
        }
        shadowGround.visible = anyCharHasShadow;
    }

    /**
     * 切换角色阴影启用状态
     */
    function setCharacterShadow(instanceId, enabled) {
        const char = characters.get(instanceId);
        if (!char || !char.model) return;
        char.model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = enabled;
                child.needsUpdate = true;
            }
        });
    }

    // ============================================================
    // 角色管理器
    // ============================================================

    const characters = new Map(); // instanceId -> { model, helper, blinkController, config, info }

    // ============================================================
    // MMD 观赏模式状态
    // ============================================================

    let viewingModeActive = false;
    let viewingModePlaylists = { entries: [] }; // { entries: [{ name, vmdPath, audioPath, assignTo }] }
    let viewingModePlayMode = 'list-loop';
    let viewingModeCurrent = null; // { entryIndex, name }
    let viewingModeAudio = null;   // HTML5 Audio 元素
    let viewingModeTimer = null;   // 无音频时的自动切换定时器
    let viewingModeProgressInterval = null; // 进度上报定时器
    let viewingModeProgressStart = 0;       // 定时模式起始时间
    let viewingModeProgressDuration = 30000; // 定时模式总时长
    // 清理函数 map: characterId -> cleanup function
    let viewingModeVmdCleanups = new Map();

    // ============================================================
    // MIDI 路由系统
    // ============================================================

    /** @type {Array<{ midiChannel, animationController, noteMappings, resolveVmdPath, idleVmdPath, instanceId, bpm }>} */
    const midiChannelEntries = []; // 支持同通道多角色
    let globalMidiInitialized = false;

    async function initGlobalMidi() {
        if (globalMidiInitialized) return true;
        try {
            const access = await navigator.requestMIDIAccess();
            for (const input of access.inputs.values()) {
                input.onmidimessage = handleMidiMessage;
                // 记录 MIDI 设备名用于调试面板
                debugMidiDeviceName = input.name || input.manufacturer || '未知设备';
            }
            access.onstatechange = (event) => {
                if (event.port.type === 'input' && event.port.state === 'connected') {
                    event.port.onmidimessage = handleMidiMessage;
                    debugMidiDeviceName = event.port.name || event.port.manufacturer || '未知设备';
                }
            };
            globalMidiInitialized = true;
            console.log('[Scene] Global MIDI initialized');
            return true;
        } catch (err) {
            console.warn('[Scene] Global MIDI init failed:', err.message);
            return false;
        }
    }

    // ============================================================
    // MIDI Clock / BPM 追踪
    // ============================================================

    let globalBpm = 120;
    let _lastClockTime = 0;
    const _clockIntervals = [];
    const _noteOnTimes = new Map(); // noteName -> timestamp

    /** 处理 MIDI Clock tick (0xF8)，计算 BPM */
    let _bpmReportThrottle = 0;
    function handleMidiClock() {
        const now = performance.now();
        if (_lastClockTime > 0) {
            const interval = now - _lastClockTime;
            _clockIntervals.push(interval);
            if (_clockIntervals.length > 24) _clockIntervals.shift();
            const avg = _clockIntervals.reduce((a, b) => a + b, 0) / _clockIntervals.length;
            globalBpm = Math.round(60000 / (avg * 24));
            // 限频上报 BPM（每秒最多 4 次）
            if (now - _bpmReportThrottle > 250) {
                _bpmReportThrottle = now;
                reportCharacterStatus('__bpm__', null, null, false, { bpm: globalBpm });
            }
        }
        _lastClockTime = now;
    }

    function handleMidiMessage(event) {
        const data = event.data;
        if (!data || data.length < 1) return;

        // ★ 观赏模式开启时无视所有 MIDI 消息
        if (viewingModeActive) return;

        const status = data[0];

        // MIDI 实时消息（单字节，无数据）
        if (status === 0xF8) { handleMidiClock(); return; }
        if (status === 0xFA || status === 0xFB) { _lastClockTime = 0; _clockIntervals.length = 0; return; }
        if (status === 0xFC) { _lastClockTime = 0; return; }
        if (data.length < 3) return;

        const note = data[1], velocity = data[2];
        const channel = (status & 0x0F) + 1;
        const type = status & 0xF0;
        const noteName = midiNoteToName(note);

        // ★ 摄像机路由（优先于角色，仅 VMD 模式下生效）
        if (cameraEnabled && cameraSource === 'vmd' && cameraNoteMappings && cameraNoteMappings[noteName] && cameraMidiChannel === channel) {
            const camMapping = cameraNoteMappings[noteName];
            if (type === 0x90 && velocity > 0) {
                // Note On → 切换摄像机 VMD
                const vmdPath = resolveCameraPath(camMapping.vmd_path);
                if (vmdPath) {
                    const loop = camMapping.play_mode === 'loop';
                    const blendTime = camMapping.blend_time ?? camMapping.fade_in ?? 0.3;
                    loadAndPlayCameraVmd(vmdPath, loop, blendTime);
                    cameraCurrentNote = noteName;
                    cameraCurrentAction = camMapping.vmd_path;
                    reportCameraStatus();
                }
            }
            // Note Off: 摄像机 VMD 继续播放，不做特殊处理
            return; // 摄像机已处理，不再路由到角色
        }

        // ★ 多角色路由：先按通道+noteMappings匹配，再全量按noteMappings匹配
        let char = null;
        // 第一步：精确通道 + 拥有该音符映射
        for (const entry of midiChannelEntries) {
            if (entry.midiChannel === channel && entry.noteMappings && entry.noteMappings[noteName]) {
                char = entry;
                break;
            }
        }
        // 第二步：任意通道有该音符映射（同通道无匹配时）
        if (!char) {
            for (const entry of midiChannelEntries) {
                if (entry.noteMappings && entry.noteMappings[noteName]) {
                    char = entry;
                    break;
                }
            }
        }
        // 第三步：回退到通道首角色（至少 fallback idle 能工作）
        if (!char) {
            for (const entry of midiChannelEntries) {
                if (entry.midiChannel === channel) {
                    char = entry;
                    break;
                }
            }
        }
        if (!char) return;
        if (!char) return;

        // Note On
        if (type === 0x90 && velocity > 0) {
            _noteOnTimes.set(noteName, performance.now());
            const mapping = char.noteMappings[noteName];
            if (mapping && mapping.vmd_path) {
                const vmdPath = char.resolveVmdPath(mapping.vmd_path);
                const useBpm = mapping.fade_mode === 'bpm' ? globalBpm : 120;
                const fadeIn = mapping.fade_in ?? mapping.fade_duration ?? 0.1;
                const fadeOut = mapping.fade_out ?? mapping.fade_duration ?? 0.1;
                char.animationController.triggerNote(
                    noteName, vmdPath,
                    fadeIn,
                    mapping.retrigger_mode || 'reset',
                    false,
                    mapping.play_mode || 'once',
                    mapping.fade_mode || 'fixed',
                    useBpm,
                    fadeOut
                );
                reportCharacterStatus(char.instanceId, noteName, mapping.vmd_path, false);
            } else if (char.idleVmdPath) {
                char.animationController.triggerNote(
                    noteName, char.idleVmdPath, 0.05, 'reset', true, 'once', 'fixed', 120
                );
                reportCharacterStatus(char.instanceId, noteName, '(fallback)', true);
            }
        }
        // Note Off
        else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
            const noteDuration = _noteOnTimes.has(noteName)
                ? (performance.now() - _noteOnTimes.get(noteName)) / 1000
                : 0;
            _noteOnTimes.delete(noteName);
            // 使用标准节拍映射函数计算拍数和音符类型
            const beatInfo = window.calculateBeatsFromTime(noteDuration * 1000, globalBpm);
            const noteBeats = beatInfo.beats;
            const beatLen = 60 / globalBpm;
            // 计算淡出时长
            const mapEntry = char.noteMappings[noteName];
            let fadeOut;
            if (mapEntry?.fade_mode === 'bpm' && noteBeats > 0) {
                fadeOut = Math.max(0.02, noteBeats * beatLen);
            } else if (mapEntry?.fade_mode === 'fixed') {
                fadeOut = mapEntry.fade_out ?? mapEntry.fade_duration ?? undefined;
            }
            // 将实际拍数 + 音符类型写入动画状态，供 releaseNote 使用
            const existingState = char.animationController.activeAnimations?.get(noteName);
            if (existingState) {
                existingState.noteBeats = noteBeats;
                existingState.noteType = beatInfo.type;
            }
            char.animationController.releaseNote(noteName, fadeOut);
            reportCharacterStatus(char.instanceId, null, null, false, { beats: noteBeats, noteType: beatInfo.type });
        }
    }

    async function summonCharacter({ instanceId, modelDir, midiChannel, config }) {
        if (characters.has(instanceId)) {
            console.log('[Scene] Character already summoned:', instanceId);
            return;
        }

        console.log('[Scene] Summoning character:', instanceId);
        reportCharacterStatus(instanceId, null, null);

        if (!config || !config.model || !config.model.pmx_path) {
            console.warn('[Scene] No valid config for', instanceId);
            return;
        }

        try {
            const loader = new MMDLoader();
            const resolvePath = (p) => {
                if (!p) return p;
                return p.startsWith('./') || p.startsWith('.\\') 
                    ? path.resolve(modelDir, p) 
                    : path.resolve(modelDir, p);
            };
            // 注意：在场景窗口中无法使用 Node path，需要用 API
            const resolve = (p) => {
                if (!p) return p;
                if (p.startsWith('./') || p.startsWith('.\\')) {
                    return modelDir + '/' + p.substring(2);
                }
                return modelDir + '/' + p;
            };

            const pmxPath = resolve(config.model.pmx_path);

            // 设置资源路径
            const lastSep = Math.max(pmxPath.lastIndexOf('/'), pmxPath.lastIndexOf('\\'));
            const modelDirPath = lastSep >= 0 ? pmxPath.substring(0, lastSep + 1) : '';
            let resourcePath = modelDirPath;
            if (resourcePath && !resourcePath.startsWith('http') && !resourcePath.startsWith('file')) {
                resourcePath = 'file:///' + resourcePath.replace(/\\/g, '/');
            }
            loader.setResourcePath(resourcePath);
            loader.setCrossOrigin(undefined);

            console.log('[Scene] Loading model:', pmxPath);

            const model = await new Promise((resolve, reject) => {
                loader.load(pmxPath, (m) => resolve(m), null, (err) => reject(err));
            });

            // 材质处理
            model.traverse((child) => {
                if (child.isMesh) {
                    child.frustumCulled = false;
                    child.castShadow = true;
                    child.receiveShadow = true;
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach((m) => {
                        if (!m) return;
                        m.userData.originalTransparent = m.transparent;
                        m.side = THREE.DoubleSide;
                        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
                    });
                }
            });

            // 应用位置和旋转
            const pos = config.model?.position || {};
            model.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
            const rot = config.model?.rotation || {};
            model.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
            const scale = config.model?.scale || 1.0;
            model.scale.set(scale, scale, scale);

            // 应用透明度、亮度和阴影
            const opacity = config.model?.opacity !== undefined ? config.model.opacity : 1.0;
            const brightness = config.model?.brightness !== undefined ? config.model.brightness : 1.0;
            const shadowEnabled = config.model?.shadow_enabled !== false; // 默认开启
            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = shadowEnabled;
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(m => {
                        m.opacity = opacity;
                        m.transparent = opacity < 1.0 || m.userData.originalTransparent;
                        m.color.setRGB(brightness, brightness, brightness);
                        m.needsUpdate = true;
                    });
                }
            });

            // 更新全局阴影外观（从配置读取）
            if (config.model?.shadow_opacity !== undefined) shadowSettings.opacity = config.model.shadow_opacity;
            if (config.model?.shadow_color !== undefined) shadowSettings.color = config.model.shadow_color;
            if (config.model?.shadow_enabled !== undefined) shadowSettings.enabled = config.model.shadow_enabled;
            updateShadowAppearance();

            scene.add(model);

            // 初始化动画帮助器
            // ★ MMDAnimationHelper 构造器不接受 physics 参数，
            //    物理开关由 add() 的 params.physics 控制
            const physicsEnabled = ammoLoaded && config.physics?.enabled !== false;
            let helper;
            try {
                helper = new MMDAnimationHelper({
                    resetPhysicsOnLoop: config.physics?.reset_on_loop !== false,
                });
                if (physicsEnabled) console.log('[Scene] Physics enabled for', instanceId);
            } catch (e) {
                console.warn('[Scene] Helper init error:', e.message);
                helper = new MMDAnimationHelper();
            }

            // 加载待机动画
            // 优先级: config.idle.vmd_path > config.model.vmd_path（旧版兼容）
            const idleVmdPath = config.idle?.vmd_path || config.model?.vmd_path;
            if (idleVmdPath) {
                const idlePath = resolve(idleVmdPath);
                loader.loadAnimation(idlePath, model, (vmd) => {
                    const tryAdd = (physicsEnabled_) => {
                        try {
                            // ★ add(object, params) 只有2个参数，
                            //    AnimationClip 必须作为 params.animation 传入
                            //    physics 也必须通过 params.physics 控制
                            const addParams = {
                                animation: vmd,
                                physics: physicsEnabled_,  // 控制是否初始化物理
                                loop: config.idle?.loop !== false,
                                animationBlend: true,
                                blendTime: config.idle?.blend_time || 0.3,
                            };
                            if (physicsEnabled_) {
                                // MMDPhysics 默认重力 (0, -9.8*10, 0)，此处保持一致
                                const g = config.physics?.gravity ?? -9.8;
                                addParams.gravity = new THREE.Vector3(0, g * 10, 0);
                                // unitStep 是 Bullet 固定步长，保持默认 1/65
                                // maxStepNum 是每帧最多子步数（即配置里的 substeps）
                                addParams.unitStep = 1 / 65;
                                addParams.maxStepNum = config.physics?.substeps || 3;
                            }
                            helper.add(model, addParams);
                            console.log('[Scene] Idle animation for', instanceId, ':', idleVmdPath, physicsEnabled_ ? '(physics)' : '(no-physics)');
                            return true;
                        } catch (e) {
                            if (physicsEnabled_) {
                                console.warn('[Scene] Idle add with physics failed, retrying without physics:', e.message);
                                // 降级：重建 helper 并显式禁用物理重试
                                helper = new MMDAnimationHelper();
                                return tryAdd(false);
                            }
                            console.warn('[Scene] Idle add failed even without physics:', e.message);
                            return false;
                        }
                    };
                    tryAdd(physicsEnabled);
                }, null, (err) => console.warn('[Scene] Idle load fail:', err.message));
            }

            // 存储角色信息
            characters.set(instanceId, { model, helper, config, modelDir, midiChannel });

            // ============================================================
            // ★ MIDI → VMD 映射：创建 AnimationController 并注册 MIDI 路由
            // ============================================================

            // 初始化全局 MIDI（非阻塞）
            initGlobalMidi().catch(() => {});

            // 创建 AnimationController
            const animationController = new AnimationController(helper, model);

            // 提取音符映射表
            const noteMappings = config.note_mappings || {};

            // 构建 VMD 路径解析函数
            const resolveVmdPathFn = (vmdPath) => {
                if (!vmdPath) return vmdPath;
                if (vmdPath.startsWith('./') || vmdPath.startsWith('.\\')) {
                    return modelDir + '/' + vmdPath.substring(2);
                }
                return modelDir + '/' + vmdPath;
            };

            // 注册 MIDI 路由（数组模式，支持同通道多角色）
            const fallbackIdlePath = idleVmdPath ? resolveVmdPathFn(idleVmdPath) : null;
            const charBpm = config.midi?.bpm || 120;
            midiChannelEntries.push({
                midiChannel,
                animationController,
                noteMappings,
                resolveVmdPath: resolveVmdPathFn,
                idleVmdPath: fallbackIdlePath,
                instanceId,
                bpm: charBpm,
            });

            // 更新角色状态中的动画控制器引用
            const charEntry = characters.get(instanceId);
            charEntry.animationController = animationController;
            charEntry.noteMappings = noteMappings;
            charEntry.bpm = charBpm;

            console.log(`[Scene] MIDI routing registered: CH ${midiChannel} → ${instanceId} (${Object.keys(noteMappings).length} mappings)`);

            // 加载摄像机视角 (仅在第一个角色加载时尝试恢复)
            let cameraLoaded = false;
            if (characters.size === 1) {
                cameraLoaded = await loadCameraView();
            }

            // 如果没加载到视角，则自动缩放
            if (!cameraLoaded) {
                fitCameraToScene(camera, scene, THREE);
            }

            // 加载调试/阴影等全局设置
            const settings = await api.readSettings();
            
            // 加载调试模式配置
            if (settings.debug) {
                debugModeEnabled = settings.debug.enabled === true;
                debugShowGrid = settings.debug.show_grid !== false;
                debugShowInfo = settings.debug.show_info !== false;
                applyDebugMode();
            }

            // 加载阴影设置（首次加载时应用全局配置）
            if (settings.shadow) {
                if (settings.shadow.opacity !== undefined) shadowSettings.opacity = settings.shadow.opacity;
                if (settings.shadow.color !== undefined) shadowSettings.color = settings.shadow.color;
                if (settings.shadow.cameraSize !== undefined) updateShadowCameraSize(settings.shadow.cameraSize);
                updateShadowAppearance();
            }

            console.log('[Scene] Character summoned:', instanceId);
            reportCharacterStatus(instanceId, null, null);
        } catch (err) {
            console.error('[Scene] Failed to summon', instanceId, ':', err.message);
        }
    }

    function recallCharacter({ instanceId }) {
        const char = characters.get(instanceId);
        if (!char) return;

        console.log('[Scene] Recalling character:', instanceId);

        // ★ 清理 AnimationController
        if (char.animationController) {
            char.animationController.dispose();
        }

        // ★ 移除 MIDI 通道路由
        const idx = midiChannelEntries.findIndex(e => e.instanceId === instanceId);
        if (idx >= 0) {
            const removed = midiChannelEntries.splice(idx, 1)[0];
            console.log(`[Scene] MIDI routing removed: CH ${removed.midiChannel} → ${instanceId}`);
        }

        // 如果当前选中的是被召回的角色，先脱离控制
        if (selectedCharacterId === instanceId && transformControls) {
            transformControls.detach();
            selectedCharacterId = null;
            updateSettingsPanel();
        }

        if (char.helper && char.model) {
            try { char.helper.remove(char.model); } catch (e) { /* ignore */ }
        }

        if (char.model) {
            scene.remove(char.model);
            char.model.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                }
            });
        }

        characters.delete(instanceId);
        
        // 如果所有角色都已召回，自动停止观赏模式
        if (characters.size === 0 && viewingModeActive) {
            console.log('[Scene] All characters recalled, stopping viewing mode');
            stopViewingMode();
        } else {
            fitCameraToScene(camera, scene, THREE);
        }
        
        updateShadowAppearance();
        console.log('[Scene] Character recalled:', instanceId);
    }

    // ============================================================
    // 调试模式
    // ============================================================

    let debugModeEnabled = false;
    let debugShowGrid = true;
    let debugShowInfo = true;
    let debugInfoElements = {};
    let debugMidiDeviceName = '--';

    function initDebugInfoElements() {
        const panel = document.getElementById('debug-info');
        if (!panel) return;
        debugInfoElements = {
            panel,
            fps: document.getElementById('debug-fps'),
            camera: document.getElementById('debug-camera'),
            cameraAction: document.getElementById('debug-camera-action'),
            characters: document.getElementById('debug-characters'),
            midi: document.getElementById('debug-midi'),
            bpm: document.getElementById('debug-bpm'),
            memory: document.getElementById('debug-memory'),
        };
    }

    function updateDebugInfo() {
        if (!debugModeEnabled || !debugShowInfo) return;
        const el = debugInfoElements;
        if (!el.panel) return;
        // FPS
        if (el.fps) {
            const val = el.fps.querySelector('.debug-value');
            if (val) val.textContent = _lastFpsValue;
        }
        // 摄像机信息
        if (el.camera) {
            const val = el.camera.querySelector('.debug-value');
            const pos = camera.position;
            if (val) val.textContent = `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`;
        }
        // 当前动作
        if (el.cameraAction) {
            const val = el.cameraAction.querySelector('.debug-value');
            if (val) val.textContent = cameraCurrentAction || '无';
        }
        // 角色数
        if (el.characters) {
            const val = el.characters.querySelector('.debug-value');
            if (val) val.textContent = characters.size;
        }
        // MIDI 信息
        if (el.midi) {
            const val = el.midi.querySelector('.debug-value');
            if (val) val.textContent = `${debugMidiDeviceName} | CH: ${cameraMidiChannel}`;
        }
        // BPM
        if (el.bpm) {
            const val = el.bpm.querySelector('.debug-value');
            if (val) val.textContent = globalBpm;
        }
        // 内存
        if (el.memory) {
            const val = el.memory.querySelector('.debug-value');
            if (!val) return;
            const mem = performance.memory;
            if (mem) {
                const usedMB = (mem.usedJSHeapSize / 1048576).toFixed(1);
                const totalMB = (mem.jsHeapSizeLimit / 1048576).toFixed(1);
                val.textContent = `${usedMB}MB / ${totalMB}MB`;
            } else {
                val.textContent = '(不可用)';
            }
        }
    }

    function applyDebugMode() {
        // 控制调试网格
        debugGrid.visible = debugModeEnabled && debugShowGrid;
        debugAxes.visible = debugModeEnabled && debugShowGrid;
        // 控制调试信息面板
        if (debugInfoElements.panel) {
            debugInfoElements.panel.classList.toggle('hidden', !(debugModeEnabled && debugShowInfo));
        }
        console.log(`[Debug] Mode: ${debugModeEnabled ? 'ON' : 'OFF'}, grid: ${debugShowGrid}, info: ${debugShowInfo}`);
    }

    async function loadDebugSettings() {
        try {
            if (!api) return;
            const settings = await api.readSettings();
            if (settings && settings.debug) {
                debugModeEnabled = settings.debug.enabled === true;
                debugShowGrid = settings.debug.show_grid !== false;
                debugShowInfo = settings.debug.show_info !== false;
                applyDebugMode();
            }
        } catch (err) {
            console.warn('[Debug] Failed to load settings:', err.message);
        }
    }

    // ============================================================
    // 摄像机管理
    // ============================================================

    let cameraEnabled = false;
    let cameraHelper = null;
    let cameraLoader = null;
    let cameraDir = '';
    let cameraMidiChannel = 1;
    let cameraNoteMappings = {};
    let cameraCurrentAction = null;
    let cameraCurrentNote = null;
    let cameraDefaultVmdPath = null;
    let cameraDefaultLoop = true;
    /** 摄像机源: 'rehearsal' | 'vmd' */
    let cameraSource = 'vmd';
    /** 排练模式机位缓存（用于每帧叠加） */
    let _cachedRehearsalPos = null;
    let _cachedRehearsalRot = null;
    let _cachedRehearsalTarget = null;

    function resolveCameraPath(p) {
        if (!p) return p;
        if (p.startsWith('./') || p.startsWith('.\\')) {
            return cameraDir + '/' + p.substring(2);
        }
        return cameraDir + '/' + p;
    }

    function loadAndPlayCameraVmd(vmdPath, loop = true, blendTime = 0.3, onComplete) {
        if (!cameraHelper || !cameraLoader || !vmdPath) {
            if (onComplete) onComplete(false, 'camera helper not ready');
            return;
        }

        cameraLoader.loadAnimation(vmdPath, camera, (vmd) => {
            if (!cameraHelper) { if (onComplete) onComplete(false, 'camera helper disposed'); return; }
            try {
                // 先移除旧的摄像机动画
                try { cameraHelper.remove(camera); } catch (e) { /* ignore */ }
                // 添加新的摄像机动画
                cameraHelper.add(camera, {
                    animation: vmd,
                    loop: loop,
                    animationBlend: true,
                    blendTime: blendTime,
                });
                console.log('[Camera] Playing VMD:', vmdPath);
                if (onComplete) onComplete(true, vmdPath);
            } catch (e) {
                console.warn('[Camera] Animation add error:', e.message);
                if (onComplete) onComplete(false, e.message);
            }
        }, null, (err) => {
            console.warn('[Camera] VMD load error:', err.message);
            if (onComplete) onComplete(false, err.message);
        });
    }

    function summonCamera(data) {
        const config = data.config;
        if (!config) return;

        cameraDir = data.cameraDir || '';
        cameraMidiChannel = config.midi?.channel || 1;
        cameraNoteMappings = config.note_mappings || {};
        cameraDefaultVmdPath = config.camera_vmd?.default_vmd || './default.vmd';
        cameraDefaultLoop = config.camera_vmd?.loop !== false;
        cameraSource = 'vmd';

        // 初始化调试面板元素引用
        initDebugInfoElements();

        // 从全局设置读取调试模式配置
        loadDebugSettings();

        // 初始化摄像机动画助手
        cameraHelper = new MMDAnimationHelper();
        cameraLoader = new MMDLoader();

        // 设置资源路径为摄像机目录
        let resourcePath = cameraDir;
        if (resourcePath && !resourcePath.startsWith('http') && !resourcePath.startsWith('file')) {
            resourcePath = 'file:///' + resourcePath.replace(/\\/g, '/');
        }
        cameraLoader.setResourcePath(resourcePath);

        cameraEnabled = true;
        cameraCurrentNote = null;
        cameraCurrentAction = null;

        if (cameraSource === 'vmd') {
            // VMD 模式：加载默认摄像机 VMD
            const defaultVmd = resolveCameraPath(cameraDefaultVmdPath);
            if (defaultVmd) {
                reportCameraStatus();
                loadAndPlayCameraVmd(defaultVmd, cameraDefaultLoop, 0.3, (success, info) => {
                    if (success) {
                        cameraCurrentAction = cameraDefaultVmdPath;
                        console.log('[Camera] Default VMD loaded successfully:', info);
                    } else {
                        cameraCurrentAction = '(加载失败: ' + info + ')';
                        console.warn('[Camera] Default VMD load failed:', info);
                    }
                    reportCameraStatus();
                });
            } else {
                console.warn('[Camera] No default VMD path configured');
            }
        } else {
            // 排练模式机位：加载已保存的摄像机位置
            console.log('[Camera] Using rehearsal camera position');
            cameraCurrentAction = '(排练模式机位)';
            reportCameraStatus();
        }

        // 初始化全局 MIDI（如果还没初始化）
        initGlobalMidi().catch(() => {});

        console.log('[Camera] Summoned, CH:', cameraMidiChannel);
        reportCameraStatus();
    }

    function recallCamera() {
        if (cameraHelper && camera) {
            try { cameraHelper.remove(camera); } catch (e) { /* ignore */ }
        }
        cameraHelper = null;
        cameraLoader = null;
        cameraEnabled = false;
        cameraCurrentNote = null;
        cameraCurrentAction = null;

        // 关闭调试模式
        debugModeEnabled = false;
        applyDebugMode();

        // 重置到排练机位
        if (_cachedRehearsalPos) {
            _applyCachedRehearsalCamera();
            console.log('[Camera] Recalled, position reset to rehearsal');
        } else {
            console.log('[Camera] Recalled');
        }
    }

    function reportCameraStatus() {
        if (api) {
            api.reportStatus({
                instanceId: 'camera',
                currentNote: cameraCurrentNote || null,
                currentAction: cameraCurrentAction || null,
            });
        }
    }

    function reportCharacterStatus(instanceId, note, action, isFallback = false, extra) {
        if (api) {
            const payload = {
                instanceId,
                currentNote: note || null,
                currentAction: action || null,
                isFallback,
            };
            if (extra !== undefined && typeof extra === 'object') Object.assign(payload, extra);
            else if (extra !== undefined) payload.bpm = extra; // 兼容旧调用（数字=bpm）
            api.reportStatus(payload);
        }
    }

    /**
     * 加载摄像机默认 VMD 重置位置（供观赏模式播放完毕使用）
     */
    function _loadCameraDefaultVmd() {
        if (!api) return;
        try {
            const projectRoot = api.getProjectRoot();
            const configPath = api.resolvePath(projectRoot, 'camera', 'config.json');
            const configRaw = api.readFile(configPath);
            if (configRaw) {
                const cfg = JSON.parse(configRaw);
                const defaultVmdRel = cfg.camera_vmd?.default_vmd || './actions/default.vmd';
                const defaultVmdPath = api.resolvePath(projectRoot, 'camera', defaultVmdRel.replace('./', ''));
                if (api.existsSync(defaultVmdPath)) {
                    console.log('[ViewingMode] Loading default camera VMD:', defaultVmdPath);
                    const loader = new MMDLoader();
                    loader.loadAnimation(defaultVmdPath, camera, (vmd) => {
                        const helper = new MMDAnimationHelper();
                        helper.add(camera, {
                            animation: vmd,
                            loop: false,
                            animationBlend: true,
                            blendTime: 0.3,
                        });
                        window._resetCameraHelper = helper;
                        console.log('[ViewingMode] Default camera VMD loaded');
                    }, null, (err) => {
                        console.warn('[ViewingMode] Default camera VMD load error:', err.message);
                        _resetCameraPosition();
                    });
                    return;
                }
            }
        } catch (e) {
            console.warn('[ViewingMode] Failed to load default camera VMD:', e.message);
        }
        _resetCameraPosition();
    }

    /** 根据摄像机源重置摄像头位置 */
    function _resetViewingCamera() {
        // 先清理观赏模式正在播放的镜头 VMD helper，避免其持续覆盖摄像机位置
        if (window._viewingCameraHelper) {
            try { window._viewingCameraHelper.remove(camera); } catch (e) { /* ignore */ }
            window._viewingCameraHelper = null;
        }

        // 先尝试清理上一次的重置镜头动画 helper
        if (window._resetCameraHelper) {
            try { window._resetCameraHelper.remove(camera); } catch (e) { /* ignore */ }
            window._resetCameraHelper = null;
        }

        if (cameraEnabled && cameraSource === 'vmd') {
            // VMD 模式：加载 default.vmd
            _loadCameraDefaultVmd();
        } else {
            // 排练模式：应用缓存的排练机位
            if (_cachedRehearsalPos) {
                _applyCachedRehearsalCamera();
                console.log('[ViewingMode] Camera reset to cached rehearsal position');
            } else {
                _loadRehearsalCameraFromSettings();
            }
        }
    }

    /** 从 settings.json 同步加载排练模式保存的摄像机位置 */
    function _loadRehearsalCameraFromSettings() {
        if (!api) { _resetCameraPosition(); return; }
        try {
            const projectRoot = api.getProjectRoot();
            if (!projectRoot) { _resetCameraPosition(); return; }
            const settingsRaw = api.readFile(api.resolvePath(projectRoot, 'settings.json'));
            if (!settingsRaw) { _resetCameraPosition(); return; }
            const settings = JSON.parse(settingsRaw);
            const cam = settings.rehearsalCamera;
            if (cam && cam.position) {
                _cachedRehearsalPos = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
                _cachedRehearsalRot = cam.rotation ? { x: cam.rotation.x, y: cam.rotation.y, z: cam.rotation.z } : null;
                _cachedRehearsalTarget = cam.target ? { x: cam.target.x, y: cam.target.y, z: cam.target.z } : null;
                _applyCachedRehearsalCamera();
                console.log('[ViewingMode] Camera reset from settings');
                return;
            }
        } catch (e) {
            console.warn('[ViewingMode] Failed to load camera from settings:', e.message);
        }
        _resetCameraPosition();
    }

    /** 简单重置摄像头到默认视角 */
    function _resetCameraPosition() {
        camera.position.set(0, 10, 20);
        camera.lookAt(0, 5, 0);
        console.log('[ViewingMode] Camera reset to default position');
    }

    function fitCameraToScene(cam, scn, THREE) {
        if (characters.size === 0) {
            cam.position.set(0, 10, 20);
            cam.lookAt(0, 5, 0);
            return;
        }

        const box = new THREE.Box3();
        let first = true;
        for (const [, char] of characters) {
            if (char.model) {
                const b = new THREE.Box3().setFromObject(char.model);
                if (first) {
                    box.copy(b);
                    first = false;
                } else {
                    box.union(b);
                }
            }
        }

        if (first) return;

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = maxDim * 2.0 + 5;

        if (!isRehearsal) {
            cam.position.set(center.x, center.y + size.y * 0.3, dist);
            cam.lookAt(center.x, center.y + size.y * 0.2, center.z);
        }
    }

    // ============================================================
    // 排练模式
    // ============================================================

    let isRehearsal = false;
    let orbitControls = null;
    let transformControls = null;
    let selectedCharacterId = null;
    let rehearsalOverlay = document.getElementById('rehearsal-overlay');
    let settingsPanel = document.getElementById('character-settings-panel');

    function updateSettingsPanel() {
        if (!selectedCharacterId || !settingsPanel) {
            settingsPanel?.classList.add('hidden');
            return;
        }

        const char = characters.get(selectedCharacterId);
        if (!char) return;

        settingsPanel.classList.remove('hidden');
        document.getElementById('current-char-id').textContent = selectedCharacterId;
        
        const scale = char.model.scale.x;
        document.getElementById('prop-scale').value = scale;
        document.getElementById('val-scale').textContent = scale.toFixed(2);

        let opacity = 1;
        let brightness = 1;
        char.model.traverse((child) => {
            if (child.isMesh && child.material && opacity === 1) {
                const m = Array.isArray(child.material) ? child.material[0] : child.material;
                opacity = m.opacity || 1;
                brightness = m.color.r;
            }
        });

        document.getElementById('prop-opacity').value = opacity;
        document.getElementById('val-opacity').textContent = opacity.toFixed(2);
        
        document.getElementById('prop-brightness').value = brightness;
        document.getElementById('val-brightness').textContent = brightness.toFixed(2);

        // 阴影控制
        const shadowToggle = document.getElementById('prop-shadow-enabled');
        const shadowOpacitySlider = document.getElementById('prop-shadow-opacity');
        const shadowColorPicker = document.getElementById('prop-shadow-color');
        const valShadowOpacity = document.getElementById('val-shadow-opacity');
        if (shadowToggle) {
            // 检查当前角色是否启用阴影
            let charShadowEnabled = true;
            char.model.traverse((child) => {
                if (child.isMesh) {
                    charShadowEnabled = child.castShadow;
                }
            });
            shadowToggle.checked = charShadowEnabled;
        }
        if (shadowOpacitySlider && valShadowOpacity) {
            shadowOpacitySlider.value = shadowSettings.opacity;
            valShadowOpacity.textContent = shadowSettings.opacity.toFixed(2);
        }
        if (shadowColorPicker) {
            shadowColorPicker.value = shadowSettings.color;
        }
        const shadowRange = document.getElementById('prop-shadow-range');
        const valShadowRange = document.getElementById('val-shadow-range');
        if (shadowRange && valShadowRange) {
            shadowRange.value = shadowSettings.cameraSize;
            valShadowRange.textContent = Math.round(shadowSettings.cameraSize);
        }
    }

    function setupSettingsPanelListeners() {
        document.getElementById('prop-scale')?.addEventListener('input', (e) => {
            if (!selectedCharacterId) return;
            const val = parseFloat(e.target.value);
            const char = characters.get(selectedCharacterId);
            if (char) {
                char.model.scale.set(val, val, val);
                document.getElementById('val-scale').textContent = val.toFixed(2);
            }
        });

        document.getElementById('prop-opacity')?.addEventListener('input', (e) => {
            if (!selectedCharacterId) return;
            const val = parseFloat(e.target.value);
            const char = characters.get(selectedCharacterId);
            if (char) {
                char.model.traverse((child) => {
                    if (child.isMesh) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(m => {
                            m.opacity = val;
                            m.transparent = val < 1.0 || m.userData.originalTransparent;
                            m.needsUpdate = true;
                        });
                    }
                });
                document.getElementById('val-opacity').textContent = val.toFixed(2);
            }
        });

        document.getElementById('prop-brightness')?.addEventListener('input', (e) => {
            if (!selectedCharacterId) return;
            const val = parseFloat(e.target.value);
            const char = characters.get(selectedCharacterId);
            if (char) {
                char.model.traverse((child) => {
                    if (child.isMesh) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(m => {
                            m.color.setRGB(val, val, val);
                        });
                    }
                });
                document.getElementById('val-brightness').textContent = val.toFixed(2);
            }
        });

        // 阴影启用开关
        document.getElementById('prop-shadow-enabled')?.addEventListener('change', (e) => {
            if (!selectedCharacterId) return;
            const enabled = e.target.checked;
            setCharacterShadow(selectedCharacterId, enabled);
            // 更新全局阴影可见性（只要至少一个角色有阴影就显示地面）
            updateShadowAppearance();
        });

        // 阴影透明度
        document.getElementById('prop-shadow-opacity')?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            shadowSettings.opacity = val;
            updateShadowAppearance();
            document.getElementById('val-shadow-opacity').textContent = val.toFixed(2);
        });

        // 阴影颜色
        document.getElementById('prop-shadow-color')?.addEventListener('input', (e) => {
            shadowSettings.color = e.target.value;
            updateShadowAppearance();
        });

        // 阴影范围
        document.getElementById('prop-shadow-range')?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            updateShadowCameraSize(val);
            document.getElementById('val-shadow-range').textContent = val;
        });

        // Gizmo 模式切换
        const modes = ['translate', 'rotate', 'scale'];
        modes.forEach(mode => {
            document.getElementById(`mode-${mode}`)?.addEventListener('click', () => {
                if (!transformControls) return;
                transformControls.setMode(mode);
                
                // 更新按钮状态
                modes.forEach(m => {
                    document.getElementById(`mode-${m}`)?.classList.remove('active');
                });
                document.getElementById(`mode-${mode}`)?.classList.add('active');
            });
        });

        // 重置逻辑辅助函数
        const resetProps = (char) => {
            char.model.scale.set(1, 1, 1);
            char.model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(m => {
                        m.opacity = 1.0;
                        m.transparent = m.userData.originalTransparent;
                        m.color.setRGB(1, 1, 1);
                        m.needsUpdate = true;
                    });
                }
            });
            // 重置全局阴影
            shadowSettings.enabled = true;
            shadowSettings.opacity = 0.45;
            shadowSettings.color = '#000000';
            updateShadowCameraSize(100);
            updateShadowAppearance();
            updateSettingsPanel();
        };

        const resetGizmo = (char) => {
            char.model.position.set(0, 0, 0);
            char.model.rotation.set(0, 0, 0);
            if (transformControls) transformControls.update();
        };

        // 按钮点击事件
        document.getElementById('reset-props')?.addEventListener('click', () => {
            if (!selectedCharacterId) return;
            const char = characters.get(selectedCharacterId);
            if (char) resetProps(char);
        });

        document.getElementById('reset-gizmo')?.addEventListener('click', () => {
            if (!selectedCharacterId) return;
            const char = characters.get(selectedCharacterId);
            if (char) resetGizmo(char);
        });

        document.getElementById('reset-all')?.addEventListener('click', () => {
            if (!selectedCharacterId) return;
            const char = characters.get(selectedCharacterId);
            if (char) {
                resetProps(char);
                resetGizmo(char);
            }
        });
    }

    function toggleRehearsal(active) {
        isRehearsal = active;

        if (active) {
            document.body.style.pointerEvents = 'auto';
            if (api) {
                api.setWindowIgnoreMouseEvents(false);
                api.setWindowOpacity(0.92);
            }
            renderer.setClearColor(0x1a1a2e, 0.15);
            gridHelper.visible = true;

            if (!orbitControls) {
                orbitControls = new OrbitControls(camera, renderer.domElement);
                orbitControls.enableDamping = true;
                orbitControls.dampingFactor = 0.1;
                orbitControls.target.set(0, 5, 0);
                orbitControls.update();
            }
            orbitControls.enabled = true;

            if (!transformControls) {
                transformControls = new TransformControls(camera, renderer.domElement);
                transformControls.setSize(0.8);
                transformControls.addEventListener('dragging-changed', (event) => {
                    if (orbitControls) orbitControls.enabled = !event.value;
                });
                scene.add(transformControls);
            }
            transformControls.enabled = true;

            if (rehearsalOverlay) rehearsalOverlay.classList.remove('hidden');
            document.getElementById('rehearsal-status')?.classList.remove('hidden');
            console.log('[Scene] Rehearsal mode: ON');
        } else {
            document.body.style.pointerEvents = 'none';
            if (api) {
                api.setWindowOpacity(1.0);
                api.setWindowIgnoreMouseEvents(true);
            }
            saveAllCharacterPositions();
            saveCameraView();
            renderer.setClearColor(0x1a1a2e, 0);
            gridHelper.visible = false;
            if (orbitControls) orbitControls.enabled = false;
            if (transformControls) {
                transformControls.detach();
                transformControls.enabled = false;
            }
            if (rehearsalOverlay) rehearsalOverlay.classList.add('hidden');
            document.getElementById('rehearsal-status')?.classList.add('hidden');
            selectedCharacterId = null;
            updateSettingsPanel();
            console.log('[Scene] Rehearsal mode: OFF');
        }
    }

    async function saveAllCharacterPositions() {
        for (const [instanceId, char] of characters) {
            if (char.model && api) {
                const pos = {
                    x: parseFloat(char.model.position.x.toFixed(4)),
                    y: parseFloat(char.model.position.y.toFixed(4)),
                    z: parseFloat(char.model.position.z.toFixed(4)),
                };
                const rot = {
                    x: parseFloat(char.model.rotation.x.toFixed(4)),
                    y: parseFloat(char.model.rotation.y.toFixed(4)),
                    z: parseFloat(char.model.rotation.z.toFixed(4)),
                };
                
                let opacity = 1;
                let brightness = 1;
                let shadowEnabled = true;
                char.model.traverse((child) => {
                    if (child.isMesh && child.material) {
                        const m = Array.isArray(child.material) ? child.material[0] : child.material;
                        opacity = m.opacity || 1;
                        brightness = m.color.r;
                        shadowEnabled = child.castShadow;
                    }
                });
                const scale = char.model.scale.x;

                await api.saveCharacterPosition({ 
                    instanceId, 
                    position: pos, 
                    rotation: rot,
                    scale: scale,
                    opacity: opacity,
                    brightness: brightness,
                    shadowEnabled: shadowEnabled,
                    shadowOpacity: shadowSettings.opacity,
                    shadowColor: shadowSettings.color,
                });
            }
        }
    }

    /** 立即将当前摄像机状态同步到缓存 */
    function _syncCameraCache() {
        _cachedRehearsalPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        _cachedRehearsalRot = { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z };
        _cachedRehearsalTarget = orbitControls
            ? { x: orbitControls.target.x, y: orbitControls.target.y, z: orbitControls.target.z }
            : null;
    }

    /** 应用缓存的排练机位到摄像机 */
    function _applyCachedRehearsalCamera() {
        if (!_cachedRehearsalPos) return;
        camera.position.set(_cachedRehearsalPos.x, _cachedRehearsalPos.y, _cachedRehearsalPos.z);
        if (_cachedRehearsalTarget && orbitControls) {
            orbitControls.target.set(_cachedRehearsalTarget.x, _cachedRehearsalTarget.y, _cachedRehearsalTarget.z);
            orbitControls.update();
        } else if (_cachedRehearsalRot) {
            camera.rotation.set(_cachedRehearsalRot.x, _cachedRehearsalRot.y, _cachedRehearsalRot.z);
        }
    }

    async function saveCameraView() {
        if (!api) return;
        _syncCameraCache();
        const cameraInfo = {
            position: { x: _cachedRehearsalPos.x, y: _cachedRehearsalPos.y, z: _cachedRehearsalPos.z },
            rotation: { x: _cachedRehearsalRot.x, y: _cachedRehearsalRot.y, z: _cachedRehearsalRot.z },
            target: _cachedRehearsalTarget ? { x: _cachedRehearsalTarget.x, y: _cachedRehearsalTarget.y, z: _cachedRehearsalTarget.z } : null,
        };
        const shadowInfo = {
            opacity: shadowSettings.opacity,
            color: shadowSettings.color,
            cameraSize: shadowSettings.cameraSize,
        };
        try {
            await api.saveSettings({ rehearsalCamera: cameraInfo, shadow: shadowInfo });
        } catch (e) {
            console.warn('[Camera] Failed to save camera position:', e.message);
        }
    }

    async function loadCameraView() {
        if (!api) return false;
        try {
            const settings = await api.readSettings();
            const cam = settings && settings.rehearsalCamera;
            if (cam && cam.position) {
                _cachedRehearsalPos = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
                _cachedRehearsalRot = cam.rotation ? { x: cam.rotation.x, y: cam.rotation.y, z: cam.rotation.z } : null;
                _cachedRehearsalTarget = cam.target ? { x: cam.target.x, y: cam.target.y, z: cam.target.z } : null;
                _applyCachedRehearsalCamera();
                // 即使没有 orbitControls，也确保 target 被记录用于后续 lookAt
                if (_cachedRehearsalTarget && !orbitControls) {
                    camera.lookAt(_cachedRehearsalTarget.x, _cachedRehearsalTarget.y, _cachedRehearsalTarget.z);
                }
                console.log('[Camera] Loaded rehearsal camera position');
                return true;
            }
        } catch (e) {
            console.warn('[Camera] Failed to load camera position:', e.message);
        }
        return false;
    }

    function setupRehearsalInteraction() {
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        renderer.domElement.addEventListener('click', (event) => {
            if (!isRehearsal || !transformControls) return;

            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);

            const meshes = [];
            for (const [instanceId, char] of characters) {
                if (char.model) {
                    char.model.traverse((child) => {
                        if (child.isMesh) meshes.push({ mesh: child, instanceId });
                    });
                }
            }

            const intersects = raycaster.intersectObjects(meshes.map(m => m.mesh));
            if (intersects.length > 0) {
                const hitMesh = intersects[0].object;
                const hitEntry = meshes.find(m => m.mesh === hitMesh);
                if (hitEntry) {
                    const char = characters.get(hitEntry.instanceId);
                    if (char && char.model) {
                        transformControls.attach(char.model);
                        selectedCharacterId = hitEntry.instanceId;
                        updateSettingsPanel();
                        const info = document.getElementById('transform-info');
                        if (info) info.textContent = '已选择: ' + hitEntry.instanceId + ' | G:移动 R:旋转 S:缩放';
                    }
                }
            } else {
                transformControls.detach();
                selectedCharacterId = null;
                updateSettingsPanel();
                const info = document.getElementById('transform-info');
                if (info) info.textContent = '点击角色选择';
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (!isRehearsal || !transformControls) return;
        if (e.key === 'Escape') {
            transformControls.detach();
            selectedCharacterId = null;
            updateSettingsPanel();
            const info = document.getElementById('transform-info');
            if (info) info.textContent = '点击角色选择';
        }
    });

    // ============================================================
    // 观赏模式控制函数
    // ============================================================

    /** 保存观赏模式前的角色/摄像机位置，用于恢复 */
    let _viewingSavedPositions = new Map(); // instanceId -> { position, rotation, scale }
    let _viewingSavedCamera = null;          // { position, rotation, target }
    let _viewingPositionsSaved = false;

    function _saveAndResetViewingPositions() {
        if (_viewingPositionsSaved) return; // 只保存一次
        _viewingPositionsSaved = true;
        _viewingSavedPositions = new Map();

        // 保存所有角色位置
        for (const [instanceId, char] of characters) {
            if (char.model) {
                _viewingSavedPositions.set(instanceId, {
                    position: char.model.position.clone(),
                    rotation: char.model.rotation.clone(),
                    scale: char.model.scale.clone(),
                });
                // 重置到原点（摄像机 VMD 预期角色在原点）
                char.model.position.set(0, 0, 0);
                char.model.rotation.set(0, 0, 0);
                console.log('[ViewingMode] Saved & reset position for', instanceId);
            }
        }

        // 保存摄像机位置
        _viewingSavedCamera = {
            position: camera.position.clone(),
            rotation: camera.rotation.clone(),
        };
        if (typeof orbitControls !== 'undefined' && orbitControls) {
            _viewingSavedCamera.target = orbitControls.target.clone();
        }
        // 重置摄像机到排练模式保存的机位（镜头 VMD 将接管控制）
        if (_cachedRehearsalPos) {
            _applyCachedRehearsalCamera();
        } else {
            camera.position.set(0, 10, 20);
            camera.lookAt(0, 5, 0);
            if (typeof orbitControls !== 'undefined' && orbitControls) {
                orbitControls.target.set(0, 5, 0);
                orbitControls.update();
            }
        }
        console.log('[ViewingMode] Saved & reset camera position');
    }

    function _restoreViewingPositions() {
        if (!_viewingPositionsSaved) return;
        _viewingPositionsSaved = false;

        // 恢复角色位置
        for (const [instanceId, saved] of _viewingSavedPositions) {
            const char = characters.get(instanceId);
            if (char && char.model) {
                char.model.position.copy(saved.position);
                char.model.rotation.copy(saved.rotation);
                char.model.scale.copy(saved.scale);
                console.log('[ViewingMode] Restored position for', instanceId);
            }
        }
        _viewingSavedPositions.clear();

        // 恢复摄像机位置
        if (_viewingSavedCamera) {
            camera.position.copy(_viewingSavedCamera.position);
            camera.rotation.copy(_viewingSavedCamera.rotation);
            if (_viewingSavedCamera.target && typeof orbitControls !== 'undefined' && orbitControls) {
                orbitControls.target.copy(_viewingSavedCamera.target);
                orbitControls.update();
            }
            _viewingSavedCamera = null;
            console.log('[ViewingMode] Restored camera position');
        }
    }

    function startViewingMode(data) {
        viewingModeActive = true; // ★ 先置标志，立即拦截 MIDI
        viewingModePlaylists = data.playlists || { entries: [] };
        viewingModePlayMode = data.playMode || 'list-loop';
        console.log('[ViewingMode] Started, playMode:', viewingModePlayMode,
            'entries:', (viewingModePlaylists.entries || []).length);

        // ★ 释放所有角色的 MIDI 触发动画，强制回到待机状态
        for (const [charId, char] of characters) {
            if (char.animationController) {
                char.animationController.releaseAll(0.15);
                console.log('[ViewingMode] Released animations for', charId);
            }
        }

        // ★ 保存并重置角色/摄像机位置（为镜头 VMD 做准备）
        _saveAndResetViewingPositions();

        // 开始播放
        startViewingPlayback();
    }

    function stopViewingMode() {
        viewingModeActive = false;
        stopViewingPlayback();
        // ★ 清除当前 Action，恢复角色位置
        _restoreViewingPositions();
        // ★ 摄像机锁定到排练机位（覆盖 restore 可能带来的陈旧位置）
        if (_cachedRehearsalPos) {
            _applyCachedRehearsalCamera();
            console.log('[ViewingMode] Camera locked to rehearsal position after exit');
        }
        console.log('[ViewingMode] Fully exited');
    }

    /** 停止播放但保持观赏模式 ON（条目仍可选、可编辑） */
    function stopViewingPlaybackKeepMode() {
        if (viewingModeAudio) {
            viewingModeAudio.pause();
            viewingModeAudio.src = '';
            viewingModeAudio = null;
        }
        if (viewingModeTimer) {
            clearTimeout(viewingModeTimer);
            viewingModeTimer = null;
        }
        stopProgressReporting();
        // 清理观赏模式镜头 helper（优先于 VMD cleanups）
        if (window._viewingCameraHelper) {
            try { window._viewingCameraHelper.remove(camera); } catch (e) { /* ignore */ }
            window._viewingCameraHelper = null;
        }
        if (window._resetCameraHelper) {
            try { window._resetCameraHelper.remove(camera); } catch (e) { /* ignore */ }
            window._resetCameraHelper = null;
        }
        if (viewingModeVmdCleanups) {
            for (const [, cleanup] of viewingModeVmdCleanups) {
                try { cleanup(); } catch (e) { /* ignore */ }
            }
            viewingModeVmdCleanups.clear();
        }
        // 根据摄像机源重置摄像头位置
        _resetViewingCamera();
        viewingModeCurrent = null;
        // 不清空 playlists，保留条目可继续编辑/选择
        if (api) {
            api.reportStatus({
                instanceId: '__viewing__',
                viewingActive: viewingModeActive,
                viewingStopped: true,
            });
        }
    }

    /** 播放指定条目（供 IPC 调用） */
    function playSpecificEntry(data) {
        const idx = data.entryIndex;
        if (idx === undefined || idx < 0) return;
        // 如果观赏模式未开启，先开启
        if (!viewingModeActive) {
            viewingModeActive = true;
            for (const [, char] of characters) {
                if (char.animationController) char.animationController.releaseAll(0.15);
            }
        }
        // 使用传入的歌单或已有歌单
        if (data.playlists) {
            viewingModePlaylists = data.playlists;
        }
        if (data.playMode) {
            viewingModePlayMode = data.playMode;
        }
        playViewingEntry(idx);
    }

    function getAllEntries() {
        return viewingModePlaylists.entries || [];
    }

    function startViewingPlayback() {
        const entries = getAllEntries();
        if (entries.length === 0) return;
        playViewingEntry(0);
    }

    function playViewingEntry(entryIndex) {
        if (!viewingModeActive) return;

        const allEntries = getAllEntries();
        if (allEntries.length === 0) return;

        if (entryIndex >= allEntries.length) {
            if (viewingModePlayMode === 'list-loop') {
                playViewingEntry(0);
            }
            return;
        }

        const entry = allEntries[entryIndex];
        viewingModeCurrent = { entryIndex, name: entry.name, assignTo: entry.assignTo || 'global', cameraVmd: entry.cameraVmdPath || '', multiplyX: entry.multiplyX ?? 1, multiplyY: entry.multiplyY ?? 1, multiplyZ: entry.multiplyZ ?? 1, presetName: entry.presetName || '' };
        const assignTarget = entry.assignTo || 'global';
        console.log(`[ViewingMode] Playing [${entryIndex}]: ${entry.name || ''} → ${assignTarget}`);

        // 上报播放状态到控制中心
        reportViewingStatus(entryIndex, entry);

        // 清除上一个条目的所有 VMD 动画
        for (const [, cleanup] of viewingModeVmdCleanups) {
            try { cleanup(); } catch (e) { /* ignore */ }
        }
        viewingModeVmdCleanups.clear();

        // 确定目标角色列表
        let targetChars = [];
        if (assignTarget === 'global') {
            // 全局：所有已召唤角色
            for (const [charId] of characters) {
                targetChars.push(charId);
            }
        } else {
            // 特定角色
            if (characters.has(assignTarget)) {
                targetChars.push(assignTarget);
            }
        }

        // 为每个目标角色加载并播放 VMD（每个角色独立 Loader 防冲突）
        if (entry.vmdPath) {
            for (const charId of targetChars) {
                const char = characters.get(charId);
                if (!char) continue;

                const resolve = (p) => {
                    if (!p) return p;
                    if (p.includes(':\\') || p.includes(':/') || p.startsWith('\\')) {
                        return p;
                    }
                    if (p.startsWith('./') || p.startsWith('.\\')) {
                        return char.modelDir + '/' + p.substring(2);
                    }
                    return char.modelDir + '/' + p;
                };
                const fullVmdPath = resolve(entry.vmdPath);

                // ★ 每个角色使用独立的 MMDLoader 实例
                const loader = new MMDLoader();
                loader.loadAnimation(fullVmdPath, char.model, (vmd) => {
                    if (!viewingModeActive || !characters.has(charId)) return;

                    if (char.animationController) {
                        char.animationController.triggerNote(
                            '__viewing__', fullVmdPath, 0.3, 'reset', false, 'loop', 'fixed', 120, 0.3
                        );
                    }

                    viewingModeVmdCleanups.set(charId, () => {
                        if (char.animationController) {
                            char.animationController.releaseNote('__viewing__', 0.2);
                        }
                    });
                }, null, (err) => {
                    console.warn(`[ViewingMode] VMD load error for ${charId}:`, err.message);
                });
            }
        }

        // ★ 保存并重置角色/摄像机位置（为镜头 VMD 或排练机位做准备）
        _saveAndResetViewingPositions();

        // 清理之前的重置镜头动画
        if (window._resetCameraHelper) {
            try { window._resetCameraHelper.remove(camera); } catch (e) { /* ignore */ }
            window._resetCameraHelper = null;
        }

        // ★ 加载镜头 VMD（需要摄像机已召唤）
        if (entry.cameraVmdPath && cameraEnabled) {
            const camVmdPath = entry.cameraVmdPath;
            console.log('[ViewingMode] Loading camera VMD:', camVmdPath);
            // 创建独立的 Helper 和 Loader，不依赖摄像机模块是否召唤
            const camLoader = new MMDLoader();
            try {
                camLoader.loadAnimation(camVmdPath, camera, (vmd) => {
                    if (!viewingModeActive) return;
                    try {
                        // 如果已有 viewing camera helper，先清理
                        if (window._viewingCameraHelper) {
                            try { window._viewingCameraHelper.remove(camera); } catch (e) { /* ignore */ }
                        }
                        const helper = new MMDAnimationHelper();
                        helper.add(camera, {
                            animation: vmd,
                            loop: true,
                            animationBlend: true,
                            blendTime: 0.3,
                        });
                        window._viewingCameraHelper = helper;
                        console.log('[ViewingMode] Camera VMD loaded');
                    } catch (e) {
                        console.warn('[ViewingMode] Camera VMD add error:', e.message);
                    }
                }, null, (err) => {
                    console.warn('[ViewingMode] Camera VMD load error:', err.message);
                });
            } catch (e) {
                console.warn('[ViewingMode] Camera VMD init error:', e.message);
            }
            // 记录清理函数
            viewingModeVmdCleanups.set('__camera__', () => {
                if (window._viewingCameraHelper) {
                    try { window._viewingCameraHelper.remove(camera); } catch (e) { /* ignore */ }
                    window._viewingCameraHelper = null;
                }
            });
        }

        // 播放音频（全局只播放一次）
        if (entry.audioPath) {
            playViewingAudio(entry.audioPath,
                () => advanceViewingPlaylist(entryIndex),   // 播放完成
                () => scheduleViewingTimeout(entryIndex)    // 播放失败
            );
        } else {
            scheduleViewingTimeout(entryIndex);
        }
    }

    /** 无音频或音频失败时，用定时器模拟播放时长后自动切换 */
    function scheduleViewingTimeout(entryIndex, durationMs = 30000) {
        if (viewingModeTimer) clearTimeout(viewingModeTimer);
        viewingModeProgressStart = performance.now();
        viewingModeProgressDuration = durationMs;
        viewingModeTimer = setTimeout(() => {
            advanceViewingPlaylist(entryIndex);
        }, durationMs);
        // 定时器模式也上报进度
        startProgressReporting();
    }

    /** 启动进度上报（每 250ms） */
    function startProgressReporting() {
        stopProgressReporting();
        viewingModeProgressInterval = setInterval(() => {
            if (!viewingModeActive) { stopProgressReporting(); return; }
            let currentTime = 0, duration = 0;
            if (viewingModeAudio && !viewingModeAudio.paused && viewingModeAudio.duration) {
                currentTime = viewingModeAudio.currentTime;
                duration = viewingModeAudio.duration;
            } else if (viewingModeTimer && viewingModeProgressDuration) {
                // 定时器模式：根据耗时估算
                const elapsed = performance.now() - viewingModeProgressStart;
                currentTime = elapsed / 1000;
                duration = viewingModeProgressDuration / 1000;
            }
            if (duration > 0 && api) {
                api.reportStatus({
                    instanceId: '__viewing__',
                    viewingActive: viewingModeActive,
                    viewingProgressCurrent: currentTime,
                    viewingProgressDuration: duration,
                });
            }
        }, 250);
    }

    function stopProgressReporting() {
        if (viewingModeProgressInterval) {
            clearInterval(viewingModeProgressInterval);
            viewingModeProgressInterval = null;
        }
    }

    function seekViewingAudio(data) {
        const time = data.currentTime;
        if (viewingModeAudio && viewingModeAudio.duration) {
            viewingModeAudio.currentTime = Math.max(0, Math.min(time, viewingModeAudio.duration));
        }
    }

    function playViewingAudio(audioPath, onEnded, onError) {
        // 停止之前的音频
        if (viewingModeAudio) {
            viewingModeAudio.pause();
            viewingModeAudio.src = '';
            viewingModeAudio = null;
        }

        try {
            // 确保音频路径是 file:// 格式
            let src = audioPath;
            if (!src.startsWith('file://') && !src.startsWith('http://') && !src.startsWith('https://')) {
                src = 'file:///' + src.replace(/\\/g, '/');
            }

            viewingModeAudio = new Audio(src);
            viewingModeAudio.volume = 1.0;

            let endedOrErrored = false;

            viewingModeAudio.addEventListener('ended', () => {
                if (endedOrErrored) return;
                endedOrErrored = true;
                stopProgressReporting();
                console.log('[ViewingMode] Audio ended');
                if (onEnded) onEnded();
            });

            viewingModeAudio.addEventListener('error', (e) => {
                if (endedOrErrored) return;
                endedOrErrored = true;
                stopProgressReporting();
                const mediaErr = viewingModeAudio?.error;
                console.warn('[ViewingMode] Audio error:', mediaErr?.message || 'unknown',
                    '- falling back to timer');
                if (onError) onError();
            });

            const playPromise = viewingModeAudio.play();
            if (playPromise) {
                playPromise.then(() => {
                    // 播放成功后开始上报进度
                    startProgressReporting();
                }).catch(err => {
                    if (endedOrErrored) return;
                    endedOrErrored = true;
                    console.warn('[ViewingMode] Audio play failed:', err.message,
                        '- falling back to timer');
                    if (onError) onError();
                });
            }
        } catch (err) {
            console.warn('[ViewingMode] Audio creation failed:', err.message,
                '- falling back to timer');
            if (onError) onError();
        }
    }

    function advanceViewingPlaylist(currentIndex) {
        if (!viewingModeActive) return;

        const allEntries = getAllEntries();
        if (allEntries.length === 0) return;

        let nextIndex;
        switch (viewingModePlayMode) {
            case 'single-loop':
                nextIndex = currentIndex;
                break;
            case 'single':
                // 单曲播放：播完停止
                console.log('[ViewingMode] Single play ended, stopping playback');
                stopViewingPlaybackKeepMode();
                return;
            case 'random':
                nextIndex = Math.floor(Math.random() * allEntries.length);
                break;
            case 'list-loop':
            default:
                nextIndex = (currentIndex + 1) % allEntries.length;
                break;
        }

        // 上报进度
        reportViewingStatus(nextIndex, allEntries[nextIndex], 'next');

        playViewingEntry(nextIndex);
    }

    function stopViewingPlayback() {
        if (viewingModeAudio) {
            viewingModeAudio.pause();
            viewingModeAudio.src = '';
            viewingModeAudio = null;
        }
        if (viewingModeTimer) {
            clearTimeout(viewingModeTimer);
            viewingModeTimer = null;
        }
        stopProgressReporting();
        // 清理观赏模式镜头 helper
        if (window._viewingCameraHelper) {
            try { window._viewingCameraHelper.remove(camera); } catch (e) { /* ignore */ }
            window._viewingCameraHelper = null;
        }
        if (window._resetCameraHelper) {
            try { window._resetCameraHelper.remove(camera); } catch (e) { /* ignore */ }
            window._resetCameraHelper = null;
        }
        if (viewingModeVmdCleanups) {
            for (const [, cleanup] of viewingModeVmdCleanups) {
                try { cleanup(); } catch (e) { /* ignore */ }
            }
            viewingModeVmdCleanups.clear();
        }
        viewingModeCurrent = null;

        // 通知控制中心停止状态
        if (api) {
            api.reportStatus({
                instanceId: '__viewing__',
                viewingActive: false,
            });
        }
    }

    function reportViewingStatus(entryIndex, entry, state = 'playing') {
        if (!api) return;
        const progress = state === 'next' ? '切换中...' : '播放中';
        const assignTarget = entry?.assignTo || 'global';
        api.reportStatus({
            instanceId: '__viewing__',
            viewingActive: viewingModeActive,
            viewingCharId: assignTarget,
            viewingEntryIndex: entryIndex,
            viewingName: entry?.name || '',
            viewingVmd: entry?.vmdPath || '',
            viewingAudio: entry?.audioPath || '',
            viewingCameraVmd: entry?.cameraVmdPath || '',
            viewingPresetName: viewingModeCurrent?.presetName || '',
            viewingProgress: progress,
            viewingPlayMode: viewingModePlayMode,
            viewingMultiplyX: viewingModeCurrent?.multiplyX ?? 1,
            viewingMultiplyY: viewingModeCurrent?.multiplyY ?? 1,
            viewingMultiplyZ: viewingModeCurrent?.multiplyZ ?? 1,
        });
    }

    // ============================================================
    // IPC 监听注册
    // ============================================================

    if (api) {
        api.sceneReady();
        api.onSummonCharacter((data) => summonCharacter(data));
        api.onRecallCharacter((data) => recallCharacter(data));
        api.onRehearsalChange((data) => toggleRehearsal(data.active));
        api.onViewingModeChange((data) => {
            if (data.active) {
                startViewingMode(data);
            } else {
                stopViewingMode();
            }
        });
        api.onPlayViewingEntry((data) => playSpecificEntry(data));
        api.onStopViewingPlayback(() => stopViewingPlaybackKeepMode());
        api.onSeekViewingEntry((data) => seekViewingAudio(data));
        // 重置镜头（观看模式手动重置）
        api.onResetViewingCamera?.((data) => {
            _resetViewingCamera();
            console.log('[ViewingMode] Manual camera reset');
        });
        // 实时更新观赏模式倍率
        api.onUpdateViewingMultiplier?.(({ multiplyX, multiplyY, multiplyZ }) => {
            if (viewingModeCurrent) {
                if (multiplyX !== undefined) viewingModeCurrent.multiplyX = multiplyX;
                if (multiplyY !== undefined) viewingModeCurrent.multiplyY = multiplyY;
                if (multiplyZ !== undefined) viewingModeCurrent.multiplyZ = multiplyZ;
                console.log('[ViewingMode] Multiplier updated:', multiplyX, multiplyY, multiplyZ);
            }
        });

        // 摄像机 IPC
        api.onCameraSummon((data) => summonCamera(data));
        api.onCameraRecall(() => recallCamera());
        api.onUpdateCameraMappings(({ noteMappings }) => {
            cameraNoteMappings = noteMappings || {};
            console.log('[Camera] Mappings updated (' + Object.keys(cameraNoteMappings).length + ' notes)');
        });

        api.onUpdateMappings(({ instanceId, midiChannel, noteMappings }) => {
            const entry = midiChannelEntries.find(e => e.instanceId === instanceId);
            if (entry) {
                entry.noteMappings = noteMappings;
                console.log(`[Scene] Mappings updated for ${instanceId} (${Object.keys(noteMappings).length} notes)`);
            }
            const char = characters.get(instanceId);
            if (char) char.noteMappings = noteMappings;
        });
        api.onUpdateConfig(({ instanceId, config }) => {
            const char = characters.get(instanceId);
            if (!char || !char.model) return;
            if (config.scale !== undefined) char.model.scale.set(config.scale, config.scale, config.scale);
            if (config.opacity !== undefined) {
                char.model.traverse((child) => {
                    if (child.isMesh) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(m => {
                            m.opacity = config.opacity;
                            m.transparent = config.opacity < 1.0 || m.userData.originalTransparent;
                            m.needsUpdate = true;
                        });
                    }
                });
            }
            if (config.shadowEnabled !== undefined) {
                setCharacterShadow(instanceId, config.shadowEnabled);
            }
            if (config.shadowOpacity !== undefined) {
                shadowSettings.opacity = config.shadowOpacity;
                updateShadowAppearance();
            }
            if (config.shadowColor !== undefined) {
                shadowSettings.color = config.shadowColor;
                updateShadowAppearance();
            }
        });
    }

    window.addEventListener('resize', () => {
        const w = window.innerWidth, h = window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });

    // 动画循环 - 使用 Clock 计算帧间隔时间（delta）
    const clock = new THREE.Clock();
    let _fpsCounter = 0, _fpsTime = 0, _lastFpsReport = 0;
    let _lastFpsValue = '--';
    let _debugUpdateTimer = 0;

    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        if (orbitControls) orbitControls.update();

        // FPS 统计
        _fpsCounter++;
        _fpsTime += delta;
        if (_fpsTime >= 1.0 && api) {
            const fps = Math.round(_fpsCounter / _fpsTime);
            _lastFpsValue = fps;
            _fpsCounter = 0;
            _fpsTime = 0;
            // 限频上报 FPS（每秒 1 次）
            reportCharacterStatus('__fps__', null, null, false, { fps });
        }

        // 更新调试面板信息（每帧更新，5帧间隔降低开销）
        if (debugModeEnabled) {
            _debugUpdateTimer += delta;
            if (_debugUpdateTimer >= 0.2) { // 每秒 5 次
                _debugUpdateTimer = 0;
                updateDebugInfo();
            }
        }

        // 更新角色动画
        for (const [, char] of characters) {
            if (char.helper) {
                try { char.helper.update(delta); } catch (e) {}
            }
        }
        // 更新摄像机动画（优先级：重置镜头 > 观赏模式镜头(VMD) > 排练机位 > 摄像机模块）
        if (window._resetCameraHelper && !isRehearsal) {
            // ① 重置镜头动画（播放完毕或手动重置时）
            try { window._resetCameraHelper.update(delta); } catch (e) {}
        } else if (window._viewingCameraHelper && viewingModeActive && !isRehearsal) {
            // ② 观赏模式镜头 VMD 动画
            try { window._viewingCameraHelper.update(delta); } catch (e) {}
            if (viewingModeCurrent && cameraEnabled) {
                const mx = viewingModeCurrent.multiplyX ?? 1;
                const my = viewingModeCurrent.multiplyY ?? 1;
                const mz = viewingModeCurrent.multiplyZ ?? 1;
                if (cameraSource === 'vmd') {
                    // VMD 模式：摄像机 VMD 实时位置乘以倍率
                    if (mx !== 1 || my !== 1 || mz !== 1) {
                        // 以原点为基准缩放位置
                        camera.position.x *= mx;
                        camera.position.y *= my;
                        camera.position.z *= mz;
                    }
                } else if (_cachedRehearsalPos) {
                    // 排练模式：排练机位偏移叠加
                    camera.position.x -= _cachedRehearsalPos.x * mx;
                    camera.position.y -= _cachedRehearsalPos.y * my;
                    camera.position.z -= _cachedRehearsalPos.z * mz;
                }
            }
        } else if (viewingModeActive && !isRehearsal) {
            // ③ 无镜头文件时：应用排练机位 + 基础偏移叠加
            if (_cachedRehearsalPos) {
                _applyCachedRehearsalCamera();
            }
            if (_cachedRehearsalPos && viewingModeCurrent && cameraEnabled) {
                const mx = viewingModeCurrent.multiplyX ?? 1;
                const my = viewingModeCurrent.multiplyY ?? 1;
                const mz = viewingModeCurrent.multiplyZ ?? 1;
                camera.position.x -= _cachedRehearsalPos.x * mx;
                camera.position.y -= _cachedRehearsalPos.y * my;
                camera.position.z -= _cachedRehearsalPos.z * mz;
            }
        } else if (cameraHelper && cameraEnabled && !isRehearsal) {
            // ④ 摄像机模块默认动画
            try { cameraHelper.update(delta); } catch (e) {}
        } else if (!cameraEnabled && !isRehearsal && !viewingModeActive) {
            // ⑤ 未召唤摄像机时锁定到排练机位
            if (_cachedRehearsalPos) {
                _applyCachedRehearsalCamera();
            }
        }
        renderer.render(scene, camera);
    }

    setupRehearsalInteraction();
    setupSettingsPanelListeners();
    document.getElementById('rehearsal-save-exit-btn')?.addEventListener('click', async () => {
        await saveAllCharacterPositions();
        toggleRehearsal(false);
        if (api) api.reportStatus({ instanceId: '__rehearsal__', rehearsalActive: false });
    });

    // 排练模式重置摄像机：回到保存的位置
    document.getElementById('rehearsal-reset-camera-btn')?.addEventListener('click', () => {
        if (_cachedRehearsalPos) {
            _applyCachedRehearsalCamera();
            console.log('[Rehearsal] Camera reset to cached rehearsal position');
        } else {
            camera.position.set(0, 10, 20);
            camera.lookAt(0, 5, 0);
            if (orbitControls) {
                orbitControls.target.set(0, 5, 0);
                orbitControls.update();
            }
            console.log('[Rehearsal] Camera reset to default position');
        }
    });

    animate();
    console.log('[Scene] Ready');
}

main().catch(err => console.error('[Scene] Fatal:', err));