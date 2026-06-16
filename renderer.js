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
    // 角色管理器
    // ============================================================

    const characters = new Map(); // instanceId -> { model, helper, blinkController, config, info }

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

            // 应用透明度和亮度
            const opacity = config.model?.opacity !== undefined ? config.model.opacity : 1.0;
            const brightness = config.model?.brightness !== undefined ? config.model.brightness : 1.0;
            model.traverse((child) => {
                if (child.isMesh) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(m => {
                        m.opacity = opacity;
                        m.transparent = opacity < 1.0 || m.userData.originalTransparent;
                        m.color.setRGB(brightness, brightness, brightness);
                        m.needsUpdate = true;
                    });
                }
            });

            scene.add(model);

            // 初始化动画帮助器
            let helper;
            try {
                helper = new MMDAnimationHelper({ physics: config.physics?.enabled !== false });
            } catch (e) {
                console.warn('[Scene] Physics unavailable:', e.message);
                helper = new MMDAnimationHelper({ physics: false });
            }

            // 加载待机动画
            if (config.idle?.vmd_path) {
                const idlePath = resolve(config.idle.vmd_path);
                loader.loadAnimation(idlePath, model, (vmd) => {
                    try {
                        helper.add(model, vmd, {
                            loop: config.idle?.loop !== false,
                            animationBlend: true,
                            blendTime: config.idle?.blend_time || 0.3,
                        });
                        console.log('[Scene] Idle animation for', instanceId);
                    } catch (e) {
                        console.warn('[Scene] Idle add failed:', e.message);
                    }
                }, null, (err) => console.warn('[Scene] Idle load fail:', err.message));
            }

            // 存储角色信息
            characters.set(instanceId, { model, helper, config, modelDir, midiChannel });

            // 加载摄像机视角 (仅在第一个角色加载时尝试恢复，或者如果有保存过)
            if (characters.size === 1) {
                await loadCameraView();
            }

            // 如果没加载到视角，则自动缩放
            const settings = await api.readSettings();
            if (!settings.camera) {
                fitCameraToScene(camera, scene, THREE);
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
        fitCameraToScene(camera, scene, THREE);
        console.log('[Scene] Character recalled:', instanceId);
    }

    function reportCharacterStatus(instanceId, note, action, isFallback = false) {
        if (api) {
            api.reportStatus({
                instanceId,
                currentNote: note || null,
                currentAction: action || null,
                isFallback,
            });
        }
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
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(m => {
                        m.opacity = 1.0;
                        m.transparent = m.userData.originalTransparent;
                        m.color.setRGB(1, 1, 1);
                        m.needsUpdate = true;
                    });
                }
            });
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
                char.model.traverse((child) => {
                    if (child.isMesh && child.material) {
                        const m = Array.isArray(child.material) ? child.material[0] : child.material;
                        opacity = m.opacity || 1;
                        brightness = m.color.r;
                    }
                });
                const scale = char.model.scale.x;

                await api.saveCharacterPosition({ 
                    instanceId, 
                    position: pos, 
                    rotation: rot,
                    scale: scale,
                    opacity: opacity,
                    brightness: brightness
                });
            }
        }
    }

    async function saveCameraView() {
        if (!api) return;
        const cameraInfo = {
            position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
            target: orbitControls ? { x: orbitControls.target.x, y: orbitControls.target.y, z: orbitControls.target.z } : null
        };
        await api.saveSettings({ camera: cameraInfo });
    }

    async function loadCameraView() {
        if (!api) return;
        const settings = await api.readSettings();
        if (settings && settings.camera) {
            const c = settings.camera;
            camera.position.set(c.position.x, c.position.y, c.position.z);
            if (c.rotation) camera.rotation.set(c.rotation.x, c.rotation.y, c.rotation.z);
            if (c.target && orbitControls) {
                orbitControls.target.set(c.target.x, c.target.y, c.target.z);
                orbitControls.update();
            }
        }
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

    if (api) {
        api.sceneReady();
        api.onSummonCharacter((data) => summonCharacter(data));
        api.onRecallCharacter((data) => recallCharacter(data));
        api.onRehearsalChange((data) => toggleRehearsal(data.active));
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
        });
    }

    window.addEventListener('resize', () => {
        const w = window.innerWidth, h = window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });

    function animate() {
        requestAnimationFrame(animate);
        if (orbitControls) orbitControls.update();
        for (const [, char] of characters) {
            if (char.helper) {
                try { char.helper.update(performance.now() / 1000); } catch (e) {}
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

    animate();
    console.log('[Scene] Ready');
}

main().catch(err => console.error('[Scene] Fatal:', err));