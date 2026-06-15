/**
 * AnimoNote - 子实例渲染进程主逻辑
 * 
 * 职责：
 * 1. 初始化 Three.js 透明场景（动态 import ES modules）
 * 2. 加载 MMD 模型（PMX）和待机动画（VMD）
 * 3. 处理鼠标穿透与拖拽
 * 4. 集成 MIDI 处理器、动画控制器、眨眼控制器
 * 5. 状态上报到中央控制台
 */

// ============================================================
// 实例信息（从 URL 参数获取）
// ============================================================

const urlParams = new URLSearchParams(window.location.search);
const INSTANCE_ID = urlParams.get('instanceId') || 'default';
const MODEL_DIR_RAW = urlParams.get('modelDir') || '';
const MIDI_CHANNEL = parseInt(urlParams.get('midiChannel') || '1', 10);

// ★ 注意：MODEL_DIR_RAW 此时是 URL 编码状态（如 D%3A%5C...）
//   Electron 的 loadFile query 参数会自动编码，所以这里需要解码一次

console.log(`[AnimoNote] Instance: ${INSTANCE_ID}, Channel: ${MIDI_CHANNEL}`);

// ============================================================
// 主初始化
// ============================================================

async function main() {
    const api = window.electronAPI;

    // ★ 解码 MODEL_DIR（必须在 main() 内，确保 preload API 已就绪）
    const MODEL_DIR = MODEL_DIR_RAW.startsWith('%')
        ? decodeURIComponent(MODEL_DIR_RAW)
        : MODEL_DIR_RAW;

    console.log(`[AnimoNote] Model dir: ${MODEL_DIR}`);

    // ============================================================
    // 配置加载（通过 preload API）
    // ============================================================

    let config = null;

    if (api && MODEL_DIR) {
        try {
            const configPath = api.resolvePath(MODEL_DIR, 'config.json');
            const mappingPath = api.resolvePath(MODEL_DIR, 'mapping.json');

            const configRaw = api.readFile(configPath);
            if (configRaw) {
                config = JSON.parse(configRaw);
                const mappingRaw = api.readFile(mappingPath);
                const mapping = mappingRaw ? JSON.parse(mappingRaw) : { note_mappings: {} };
                config.note_mappings = mapping.note_mappings || {};

                // 解析相对路径
                const resolve = (p) => api.resolvePath(MODEL_DIR, p);
                if (config.model?.pmx_path) config.model.pmx_path = resolve(config.model.pmx_path);
                if (config.model?.vmd_path) config.model.vmd_path = resolve(config.model.vmd_path);
                if (config.idle?.vmd_path) config.idle.vmd_path = resolve(config.idle.vmd_path);
                for (const [note, m] of Object.entries(config.note_mappings)) {
                    if (m.vmd_path) m.vmd_path = resolve(m.vmd_path);
                }

                console.log('[Config] Loaded:', config.instance_id);
            } else {
                console.warn('[Config] config.json not found at:', configPath);
            }
        } catch (err) {
            console.error('[Config] Failed to load:', err.message);
        }
    } else {
        console.warn('[Config] electronAPI not available or no MODEL_DIR');
    }

    if (!config) {
        console.warn('[AnimoNote] No config, running in demo mode');
    }

    // ============================================================
    // 动态导入 Three.js ES Modules
    //
    // ★ 使用 import map（在 index.html 中定义）将 bare specifier "three"
    //   映射到 node_modules/three/build/three.module.js，从而让
    //   MMDLoader.js / MMDAnimationHelper.js 内部的
    //   `import { ... } from 'three'` 能够正确解析。
    // ============================================================

    let THREE, MMDLoader, MMDAnimationHelper;

    // 通过 import map 使用 bare specifier 加载（兼容 Electron 和浏览器）
    // import map 会自动将 "three" 解析为 node_modules/three/build/three.module.js
    // ★ three.module.js 只有 named exports，没有 default export，所以使用 import * as
    console.log('[Three] Loading via import map (bare specifier "three")');
    THREE = await import('three');
    const mmdLoaderMod = await import('three/addons/loaders/MMDLoader.js');
    const mmdHelperMod = await import('three/addons/animation/MMDAnimationHelper.js');
    MMDLoader = mmdLoaderMod.MMDLoader;
    MMDAnimationHelper = mmdHelperMod.MMDAnimationHelper;

    // ============================================================
    // Three.js 场景初始化
    // ============================================================

    const container = document.getElementById('canvas-container');

    // GPU 检测
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    console.log(`[GPU] WebGL: ${gl ? (testCanvas.getContext('webgl2') ? '2.0' : '1.0') : 'N/A'}`);
    console.log(`[GPU] Renderer: ${gl ? gl.getParameter(gl.RENDERER) : 'N/A'}`);

    const renderer = new THREE.WebGLRenderer({
        alpha: true, antialias: true, preserveDrawingBuffer: false,
        powerPreference: 'high-performance', stencil: false, depth: true,
    });
    renderer.setClearColor(0x000000, 0);
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
    // 灯光与亮度控制
    // ============================================================

    // ★ 增强光照：MMD 模型使用 MeshPhongMaterial 需要足够的光照才能显示正常亮度
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // 主光源（前方偏上）
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(5, 15, 10);
    mainLight.castShadow = true;
    scene.add(mainLight);

    // 辅光源（后方偏左，冷色）
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.5);
    fillLight.position.set(-8, 5, -10);
    scene.add(fillLight);

    // 背光（后方偏右，暖色）
    const rimLight = new THREE.DirectionalLight(0xffaa66, 0.4);
    rimLight.position.set(8, 2, -12);
    scene.add(rimLight);

    // 底部补光
    const bottomLight = new THREE.DirectionalLight(0xffffff, 0.3);
    bottomLight.position.set(0, -5, 5);
    scene.add(bottomLight);

    // ★ 亮度控制状态
    const brightnessState = {
        ambient: 0.6,
        main: 1.2,
        fill: 0.5,
        rim: 0.4,
        bottom: 0.3,
        // 整体亮度倍率（快捷键调节）
        multiplier: 1.0,
    };

    // ★ 更新所有光源强度
    function updateBrightness() {
        const m = brightnessState.multiplier;
        ambientLight.intensity = brightnessState.ambient * m;
        mainLight.intensity = brightnessState.main * m;
        fillLight.intensity = brightnessState.fill * m;
        rimLight.intensity = brightnessState.rim * m;
        bottomLight.intensity = brightnessState.bottom * m;
    }

    // ★ 亮度提示元素
    const brightnessHint = document.getElementById('brightness-hint');
    const brightnessText = document.getElementById('brightness-text');
    const debugBrightness = document.getElementById('debug-brightness');
    let brightnessHintTimer = null;

    function showBrightnessHint() {
        if (brightnessText) brightnessText.textContent = `☀️ 亮度: ${brightnessState.multiplier.toFixed(1)}x`;
        if (debugBrightness) debugBrightness.textContent = `Brightness: ${brightnessState.multiplier.toFixed(1)}x`;
        if (brightnessHint) {
            brightnessHint.classList.remove('hidden');
            brightnessHint.classList.add('visible');
            clearTimeout(brightnessHintTimer);
            brightnessHintTimer = setTimeout(() => {
                brightnessHint.classList.remove('visible');
                brightnessHint.classList.add('hidden');
            }, 1500);
        }
    }

    // ★ 实时调整参数状态
    const liveParams = {
        brightness: 1.0,
        scale: 1.0,
        opacity: 1.0
    };

    // 从配置初始化参数
    if (config?.model) {
        liveParams.brightness = config.model.light_intensity ?? 1.0;
        liveParams.scale = config.model.scale ?? 1.0;
        liveParams.opacity = config.model.opacity ?? 1.0;
        
        // 应用初始亮度
        brightnessState.multiplier = liveParams.brightness;
        updateBrightness();
    }

    // ★ 应用透明度到模型
    function applyOpacity(value) {
        if (!model) return;
        model.traverse((child) => {
            if (child.isMesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(m => {
                    m.opacity = value;
                    m.transparent = value < 1.0 || (m.userData.originalTransparent === true);
                    m.needsUpdate = true;
                });
            }
        });
    }

    // ★ 监听来自控制台的实时配置更新
    if (api) {
        api.onUpdateConfig((newConfig) => {
            console.log('[AnimoNote] Config update received:', newConfig);
            if (newConfig.brightness !== undefined) {
                liveParams.brightness = newConfig.brightness;
                brightnessState.multiplier = newConfig.brightness;
                updateBrightness();
                showBrightnessHint();
            }
            if (newConfig.scale !== undefined) {
                liveParams.scale = newConfig.scale;
                if (model) model.scale.set(newConfig.scale, newConfig.scale, newConfig.scale);
            }
            if (newConfig.opacity !== undefined) {
                liveParams.opacity = newConfig.opacity;
                applyOpacity(newConfig.opacity);
            }
        });
    }

    // ★ 键盘快捷键：[/] 降低/增加亮度，Ctrl+0 重置
    document.addEventListener('keydown', (e) => {
        if (e.key === ']' && !e.repeat) {
            brightnessState.multiplier = Math.min(brightnessState.multiplier + 0.2, 3.0);
            updateBrightness();
            showBrightnessHint();
            liveParams.brightness = brightnessState.multiplier;
        } else if (e.key === '[' && !e.repeat) {
            brightnessState.multiplier = Math.max(brightnessState.multiplier - 0.2, 0.2);
            updateBrightness();
            showBrightnessHint();
            liveParams.brightness = brightnessState.multiplier;
        } else if (e.key === '0' && !e.repeat && (e.ctrlKey || e.metaKey)) {
            brightnessState.multiplier = 1.0;
            updateBrightness();
            showBrightnessHint();
            liveParams.brightness = brightnessState.multiplier;
        }
    });

    // ============================================================
    // MMD 模型加载
    // ============================================================

    let model = null;
    let helper = null;
    let blinkController = null;

    if (config && config.model?.pmx_path && api?.existsSync(config.model.pmx_path)) {
        try {
            const loader = new MMDLoader();

            // ★ 设置正确的 resourcePath，确保纹理能正确加载
            //   extractUrlBase() 使用 '/' 分割路径，Windows 路径使用 '\' 会导致 resourcePath 错误
            const lastSlash = Math.max(
                config.model.pmx_path.lastIndexOf('/'),
                config.model.pmx_path.lastIndexOf('\\')
            );
            const modelDir = lastSlash >= 0 ? config.model.pmx_path.substring(0, lastSlash + 1) : '';
            // ★ 修复 resourcePath：确保在 Windows 下也使用 file:// 协议，避免加载失败
            let resourcePath = modelDir;
            if (resourcePath && !resourcePath.startsWith('http') && !resourcePath.startsWith('file')) {
                // 将反斜杠转为正斜杠，并加上 file:///
                resourcePath = 'file:///' + resourcePath.replace(/\\/g, '/');
            }
            loader.setResourcePath(resourcePath);
            // ★ 清除 crossOrigin，避免 file:// 协议下的 CORS 问题
            loader.setCrossOrigin(undefined);

            console.log(`[MMD] Loading model from: ${config.model.pmx_path}`);
            console.log(`[MMD] Resource path: ${resourcePath}`);

            model = await new Promise((resolve, reject) => {
                loader.load(config.model.pmx_path, (m) => resolve(m), null, (err) => reject(err));
            });

            // ★ 优化材质处理：不再盲目替换为 MeshPhongMaterial
            // MMDToonMaterial 包含了 MMD 特有的 Sphere Map 和 Toon Texture，这是角色质感的关键
            model.traverse((child) => {
                if (child.isMesh) {
                    child.frustumCulled = false;
                    child.castShadow = true;
                    child.receiveShadow = true;

                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach((m) => {
                        if (!m) return;
                        
                        // 记录原始透明状态供后续调节使用
                        m.userData.originalTransparent = m.transparent;
                        
                        // ★ 关键修复：MMD 头发和附件通常需要双面渲染才能正常显示
                        m.side = THREE.DoubleSide;

                        // 修复可能存在的贴图亮度问题
                        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;

                        // 如果初始配置有透明度要求
                        if (liveParams.opacity < 1.0) {
                            m.transparent = true;
                            m.opacity = liveParams.opacity;
                        }
                    });
                }
            });

            // ★ 应用实时参数（可能在加载过程中已通过 IPC 更新）
            model.scale.set(liveParams.scale, liveParams.scale, liveParams.scale);
            applyOpacity(liveParams.opacity);

            const pos = config.model?.position || {};
            model.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
            const rot = config.model?.rotation || {};
            model.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
            scene.add(model);
            console.log(`[MMD] Model loaded and params applied: ${config.model.pmx_path}`);

            // ★ 先尝试禁用物理创建 helper，如果 ammo.js 不可用则回退到无物理模式
            try {
                helper = new MMDAnimationHelper({ physics: config.physics?.enabled !== false });
            } catch (e) {
                console.warn('[MMD] Physics unavailable, falling back to no physics:', e.message);
                helper = new MMDAnimationHelper({ physics: false });
            }

            if (config.idle?.vmd_path) {
                loader.loadAnimation(config.idle.vmd_path, model, (vmd) => {
                    try {
                        helper.add(model, vmd, {
                            loop: config.idle?.loop !== false,
                            animationBlend: true,
                            blendTime: config.idle?.blend_time || 0.3,
                        });
                        console.log(`[MMD] Idle: ${config.idle.vmd_path}`);
                    } catch (e) {
                        console.warn(`[MMD] Idle animation add failed (continuing without idle): ${e.message}`);
                    }
                }, null, (err) => console.warn(`[MMD] Idle load fail (continuing without idle): ${err.message}`));
            }

            // 眨眼
            try {
                // ★ 使用 preload API 获取项目根目录（preload.js 所在目录 = 项目根目录）
                const projectRoot = api.getProjectRoot();
                const blinkPath = api.resolvePath(projectRoot, 'src/blink-controller.js');
                console.log('[Blink] Loading from:', blinkPath);
                const { BlinkController } = await import(blinkPath);
                blinkController = new BlinkController(model, {
                    enabled: config.blink?.enabled !== false,
                    minInterval: config.blink?.min_interval || 2000,
                    maxInterval: config.blink?.max_interval || 6000,
                    blinkDuration: config.blink?.duration || 120,
                });
                blinkController.start();
                console.log('[Blink] Started');
            } catch (e) {
                console.warn('[Blink] Init fail:', e.message);
            }

            // ★ 调整相机：MMD 模型通常较高，需要更远的距离和更高的视角
            //   使用模型包围盒计算合适距离
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const dist = maxDim * 2.5;
            camera.position.set(0, center.y + size.y * 0.3, dist);
            camera.lookAt(center.x, center.y + size.y * 0.2, center.z);

        } catch (err) {
            console.error(`[MMD] Model load failed:`, err);
            showFallbackScene(THREE, scene);
        }
    } else {
        console.warn('[MMD] No valid model config, showing fallback');
        showFallbackScene(THREE, scene);
    }

    function showFallbackScene(THREE, scene) {
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(2, 32, 32),
            new THREE.MeshStandardMaterial({ color: 0x4fc3f7, metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0.9 })
        );
        sphere.position.y = 3; sphere.castShadow = true; scene.add(sphere);
        const grid = new THREE.GridHelper(10, 10, 0x4fc3f7, 0x2a2a4a);
        grid.position.y = -0.5; scene.add(grid);
        window.__fallbackSphere = sphere;
    }

    // ============================================================
    // 鼠标穿透与拖拽
    // ============================================================

    // ============================================================
    // 移动控制逻辑 (由控制中心触发全屏移动模式)
    // ============================================================

    const moveOverlay = document.getElementById('move-overlay');
    const moveDone = document.getElementById('move-done');

    // 监听来自控制中心的指令
    if (api) {
        api.onUpdateConfig((newConfig) => {
            if (newConfig.type === 'show-move-dialog') {
                // 进入移动模式
                moveOverlay.classList.remove('hidden');
                api.setDraggable(true); // 解除穿透，激活 -webkit-app-region: drag
            }
        });
    }

    moveDone.addEventListener('click', () => {
        // 退出移动模式
        moveOverlay.classList.add('hidden');
        if (api) {
            api.saveWindowPosition(); // 保存最终坐标
            api.setDraggable(false);   // 恢复穿透
        }
    });

    // 依然保留 Alt 键作为紧急移动手段
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Alt' && !e.repeat) {
            if (api) api.setDraggable(true);
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Alt') {
            if (api && moveOverlay.classList.contains('hidden')) {
                api.setDraggable(false);
            }
        }
    });

    // 依然保留 Alt 键作为紧急移动手段（如果不穿透的话）
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Alt' && !e.repeat) {
            if (api) api.setDraggable(true);
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Alt') {
            if (api && !isMoveActive) api.setDraggable(false);
        }
    });

    // ============================================================
    // 窗口自适应
    // ============================================================

    window.addEventListener('resize', () => {
        const w = window.innerWidth, h = window.innerHeight;
        camera.aspect = w / h; camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });

    // ============================================================
    // 调试信息
    // ============================================================

    const debugEl = document.getElementById('debug-info');
    const debugInstance = document.getElementById('debug-instance');
    const debugChannel = document.getElementById('debug-channel');
    const debugNote = document.getElementById('debug-note');
    const debugFps = document.getElementById('debug-fps');
    if (debugInstance) debugInstance.textContent = `Instance: ${INSTANCE_ID}`;
    if (debugChannel) debugChannel.textContent = `Channel: ${MIDI_CHANNEL}`;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F3' && debugEl) debugEl.classList.toggle('hidden');
    });

    // ============================================================
    // 状态上报
    // ============================================================

    let frameCount = 0, lastFpsUpdate = performance.now();
    let lastNote = null, lastAction = null, lastFallback = false;

    function reportStatus(note, action, isFallback = false) {
        if (api) {
            if (note === lastNote && action === lastAction && isFallback === lastFallback) return;
            lastNote = note; lastAction = action; lastFallback = isFallback;
            api.reportStatus({
                instanceId: INSTANCE_ID, currentNote: note || null,
                currentAction: action || null, isFallback,
                fps: debugFps ? debugFps.textContent.replace('FPS: ', '') : '0',
            });
        }
    }

    // ============================================================
    // 渲染循环
    // ============================================================

    function animate() {
        requestAnimationFrame(animate);
        if (window.__fallbackSphere) {
            window.__fallbackSphere.rotation.x += 0.005;
            window.__fallbackSphere.rotation.y += 0.01;
        }
        if (helper) {
            try {
                helper.update(performance.now() / 1000);
            } catch (e) {
                // 静默忽略 helper 更新错误（如 ammo.js 缺失）
            }
        }
        renderer.render(scene, camera);
        frameCount++;
        const now = performance.now();
        if (now - lastFpsUpdate >= 1000) {
            const currentFps = frameCount;
            if (debugFps) debugFps.textContent = `FPS: ${currentFps}`;
            frameCount = 0; lastFpsUpdate = now;
            
            // 实时上报 FPS
            if (api) {
                api.reportStatus({
                    instanceId: INSTANCE_ID,
                    currentNote: lastNote || null,
                    currentAction: lastAction || null,
                    isFallback: lastFallback,
                    fps: String(currentFps),
                });
            }
        }
    }
    animate();

    console.log(`[AnimoNote] Ready: ${INSTANCE_ID}`);
    reportStatus(null);
}

main().catch(err => {
    console.error('[AnimoNote] Fatal:', err);
});
