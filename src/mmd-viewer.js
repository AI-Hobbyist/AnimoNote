/**
 * AnimoNote - MMD 场景管理器
 * 
 * 管理 Three.js 场景中的 MMD 模型、灯光、相机和渲染循环。
 * 提供模型加载、待机动画播放、场景控制等功能。
 */

class MMDViewer {
    /**
     * @param {THREE.Scene} scene - Three.js 场景
     * @param {THREE.PerspectiveCamera} camera - 相机
     * @param {THREE.WebGLRenderer} renderer - 渲染器
     */
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        this.model = null;
        this.helper = null;
        this.mmdLoader = new THREE.MMDLoader();
        this.isLoaded = false;

        // 默认相机位置（适合显示站立角色）
        this.defaultCameraPosition = new THREE.Vector3(0, 8, 18);
        this.defaultCameraTarget = new THREE.Vector3(0, 5, 0);
    }

    /**
     * 加载 PMX 模型
     * @param {string} pmxPath - PMX 文件路径
     * @param {Object} [options] - 加载选项
     * @param {number} [options.scale=1.0] - 模型缩放
     * @param {Object} [options.position] - 模型位置 { x, y, z }
     * @param {Object} [options.rotation] - 模型旋转 { x, y, z }
     * @returns {Promise<THREE.SkinnedMesh>}
     */
    loadModel(pmxPath, options = {}) {
        return new Promise((resolve, reject) => {
            this.mmdLoader.load(
                pmxPath,
                (model) => {
                    this._onModelLoaded(model, options);
                    resolve(model);
                },
                null,
                (error) => {
                    console.error(`[MMDViewer] Failed to load model: ${pmxPath}`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * 模型加载完成后的处理
     */
    _onModelLoaded(model, options) {
        this.model = model;

        // 缩放
        const scale = options.scale || 1.0;
        model.scale.set(scale, scale, scale);

        // 位置
        if (options.position) {
            model.position.set(
                options.position.x || 0,
                options.position.y || 0,
                options.position.z || 0
            );
        } else {
            model.position.set(0, 0, 0);
        }

        // 旋转
        if (options.rotation) {
            model.rotation.set(
                options.rotation.x || 0,
                options.rotation.y || 0,
                options.rotation.z || 0
            );
        }

        // 添加到场景
        this.scene.add(model);

        // 设置相机对准模型
        this._resetCamera();

        this.isLoaded = true;
        console.log('[MMDViewer] Model added to scene');
    }

    /**
     * 初始化 MMDAnimationHelper
     */
    _initHelper() {
        if (!this.helper) {
            this.helper = new THREE.MMDAnimationHelper({
                physics: false,  // 阶段 3 先禁用物理，阶段 5 启用
            });
        }
    }

    /**
     * 播放待机动画
     * @param {string} vmdPath - VMD 动作文件路径
     * @param {Object} [options] - 播放选项
     * @param {boolean} [options.loop=true] - 是否循环
     * @param {number} [options.blendTime=0.3] - 混合时间
     * @returns {Promise<Object>} VMD 动画数据
     */
    playIdle(vmdPath, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.model) {
                reject(new Error('Model not loaded yet'));
                return;
            }

            this._initHelper();

            const loop = options.loop !== undefined ? options.loop : true;
            const blendTime = options.blendTime || 0.3;

            this.mmdLoader.loadAnimation(
                vmdPath,
                this.model,
                (vmd) => {
                    this.helper.add(this.model, vmd, {
                        loop,
                        animationBlend: true,
                        blendTime,
                    });
                    console.log(`[MMDViewer] Idle animation started: ${vmdPath} (loop: ${loop})`);
                    resolve(vmd);
                },
                null,
                (error) => {
                    console.error(`[MMDViewer] Failed to load idle animation: ${vmdPath}`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * 重置相机到默认位置
     */
    _resetCamera() {
        this.camera.position.copy(this.defaultCameraPosition);
        this.camera.lookAt(this.defaultCameraTarget);
    }

    /**
     * 设置相机位置
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    setCameraPosition(x, y, z) {
        this.camera.position.set(x, y, z);
        this.camera.lookAt(this.defaultCameraTarget);
    }

    /**
     * 获取 MMDAnimationHelper 实例
     * @returns {THREE.MMDAnimationHelper|null}
     */
    getHelper() {
        return this.helper;
    }

    /**
     * 获取加载的模型
     * @returns {THREE.SkinnedMesh|null}
     */
    getModel() {
        return this.model;
    }

    /**
     * 销毁场景中的 MMD 资源
     */
    dispose() {
        if (this.helper) {
            // 清理动画
            if (this.model) {
                this.helper.remove(this.model);
            }
        }

        if (this.model) {
            this.scene.remove(this.model);
            // 释放几何体和材质
            this.model.traverse((child) => {
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

        this.model = null;
        this.helper = null;
        this.isLoaded = false;
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MMDViewer };
}
