/**
 * AnimoNote - 配置加载器
 * 
 * 从模型目录加载 config.json 和 mapping.json，
 * 将两者合并为统一的配置对象。
 * 
 * 目录结构:
 *   models/<instance_id>/
 *     ├── config.json       ← 角色配置（不含映射）
 *     ├── mapping.json      ← 独立的音符映射文件
 *     ├── *.pmx             ← MMD 模型
 *     ├── *.vmd             ← 动作文件
 *     └── actions/          ← 动作 VMD 文件夹
 */

class ConfigLoader {
    /**
     * 从模型目录加载完整配置
     * 
     * @param {string} modelDir - 模型目录的绝对路径
     * @returns {Object} 合并后的完整配置对象
     * @throws {Error} 如果 config.json 不存在或格式无效
     * 
     * @example
     * const config = ConfigLoader.load('./models/miku');
     * // config.note_mappings 已包含 mapping.json 的内容
     * // config.model.pmx_path 已解析为绝对路径
     */
    static load(modelDir) {
        const path = require('path');
        const fs = require('fs');

        // 1. 加载 config.json
        const configPath = path.join(modelDir, 'config.json');
        if (!fs.existsSync(configPath)) {
            throw new Error(`Config file not found: ${configPath}`);
        }

        let config;
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch (err) {
            throw new Error(`Failed to parse config.json: ${err.message}`);
        }

        // 2. 加载 mapping.json（独立文件，可选）
        const mappingPath = path.join(modelDir, 'mapping.json');
        let mappings = {};
        if (fs.existsSync(mappingPath)) {
            try {
                const mappingData = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
                mappings = mappingData.note_mappings || {};
            } catch (err) {
                console.warn(`[ConfigLoader] Warning: Failed to parse mapping.json: ${err.message}`);
            }
        }

        // 3. 合并：将 mappings 注入 config
        config.note_mappings = mappings;

        // 4. 解析相对路径为绝对路径（相对于模型目录）
        if (config.model) {
            if (config.model.pmx_path) {
                config.model.pmx_path = path.resolve(modelDir, config.model.pmx_path);
            }
            if (config.model.vmd_path) {
                config.model.vmd_path = path.resolve(modelDir, config.model.vmd_path);
            }
        }

        if (config.idle && config.idle.vmd_path) {
            config.idle.vmd_path = path.resolve(modelDir, config.idle.vmd_path);
        }

        // 5. 解析 note_mappings 中的 vmd_path
        for (const [note, mapping] of Object.entries(config.note_mappings)) {
            if (mapping.vmd_path) {
                mapping.vmd_path = path.resolve(modelDir, mapping.vmd_path);
            }
        }

        // 6. 设置默认值
        config.midi_channel = config.midi_channel || 1;
        config.instance_id = config.instance_id || path.basename(modelDir);

        return config;
    }

    /**
     * 仅加载 mapping.json（不依赖 config.json）
     * 
     * @param {string} modelDir - 模型目录路径
     * @returns {Object} note_mappings 对象
     */
    static loadMappingsOnly(modelDir) {
        const path = require('path');
        const fs = require('fs');

        const mappingPath = path.join(modelDir, 'mapping.json');
        if (!fs.existsSync(mappingPath)) {
            return {};
        }

        try {
            const data = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
            return data.note_mappings || {};
        } catch {
            return {};
        }
    }

    /**
     * 验证配置是否完整有效
     * 
     * @param {Object} config - 配置对象
     * @returns {{ valid: boolean, errors: string[] }}
     */
    static validate(config) {
        const errors = [];

        if (!config.instance_id) {
            errors.push('Missing instance_id');
        }

        if (!config.model || !config.model.pmx_path) {
            errors.push('Missing model.pmx_path');
        }

        if (!config.idle || !config.idle.vmd_path) {
            errors.push('Missing idle.vmd_path');
        }

        if (config.midi_channel < 1 || config.midi_channel > 16) {
            errors.push('midi_channel must be between 1 and 16');
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ConfigLoader };
}
