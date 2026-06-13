/**
 * AnimoNote - MMD 模型加载器
 * 
 * 封装 Three.js 的 MMDLoader，提供 Promise 化的加载接口。
 * 支持加载 PMX 模型和 VMD 动作文件。
 */

class MMDLoaderWrapper {
    constructor() {
        this.loader = new THREE.MMDLoader();
    }

    /**
     * 加载 PMX 模型
     * @param {string} pmxPath - PMX 文件路径
     * @returns {Promise<THREE.SkinnedMesh>} 加载完成的模型
     */
    loadModel(pmxPath) {
        return new Promise((resolve, reject) => {
            this.loader.load(
                pmxPath,
                (model) => {
                    console.log(`[MMDLoader] Model loaded: ${pmxPath}`);
                    resolve(model);
                },
                (progress) => {
                    // 加载进度（可选）
                    if (progress.total > 0) {
                        const percent = Math.round((progress.loaded / progress.total) * 100);
                        console.log(`[MMDLoader] Loading model: ${percent}%`);
                    }
                },
                (error) => {
                    console.error(`[MMDLoader] Failed to load model: ${pmxPath}`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * 加载 VMD 动作文件
     * @param {string} vmdPath - VMD 文件路径
     * @returns {Promise<Object>} VMD 动画数据
     */
    loadVmd(vmdPath) {
        return new Promise((resolve, reject) => {
            this.loader.loadAnimation(
                vmdPath,
                null,  // 不需要传入 model，只加载动画数据
                (vmd) => {
                    console.log(`[MMDLoader] VMD loaded: ${vmdPath} (${vmd.boneFrames?.length || 0} bone frames)`);
                    resolve(vmd);
                },
                (progress) => {
                    if (progress.total > 0) {
                        const percent = Math.round((progress.loaded / progress.total) * 100);
                        console.log(`[MMDLoader] Loading VMD: ${percent}%`);
                    }
                },
                (error) => {
                    console.error(`[MMDLoader] Failed to load VMD: ${vmdPath}`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * 加载 PMX 模型和 VMD 动作（并行）
     * @param {string} pmxPath - PMX 文件路径
     * @param {string} vmdPath - VMD 文件路径
     * @returns {Promise<{ model: THREE.SkinnedMesh, vmd: Object }>}
     */
    loadModelWithVmd(pmxPath, vmdPath) {
        return Promise.all([
            this.loadModel(pmxPath),
            this.loadVmd(vmdPath),
        ]).then(([model, vmd]) => ({ model, vmd }));
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MMDLoaderWrapper };
}
