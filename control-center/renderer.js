/**
 * AnimoNote - 中央控制台渲染进程逻辑
 * 
 * 包含：实例管理 + 角色配置编辑器 + 映射编辑器
 */

// ============================================================
// 常量
// ============================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ALL_NOTES = [];
for (let octave = 0; octave <= 8; octave++) {
    for (const name of NOTE_NAMES) {
        ALL_NOTES.push(`${name}${octave}`);
    }
}

// ============================================================
// 状态管理
// ============================================================

const state = {
    availableModels: [],
    runningInstances: new Map(),
    logEntries: [],
    maxLogEntries: 200,

    // 映射编辑器
    selectedModelId: null,
    currentMappings: {},
    currentVmdFiles: [],
    hasUnsavedMapping: false,

    // 配置编辑器
    currentConfig: null,
    currentPmxFiles: [],
    hasUnsavedConfig: false,
};

// ============================================================
// DOM 引用
// ============================================================

const $ = (id) => document.getElementById(id);
const tbody = $('instances-tbody');
const logContainer = $('log-container');
const modelList = $('model-list');
const mappingContainer = $('mapping-table-container');
const mappingModelName = $('mapping-model-name');
const quickNoteSelect = $('quick-note-select');
const quickVmdSelect = $('quick-vmd-select');
const configEditorBody = $('config-editor-body');
const configModelName = $('config-model-name');

// ============================================================
// 日志
// ============================================================

function addLog(type, message) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    state.logEntries.push({ type, message, time });
    if (state.logEntries.length > state.maxLogEntries) state.logEntries.shift();
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// ============================================================
// 选项卡
// ============================================================

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    document.querySelectorAll('.tab-content').forEach(el => el.classList.toggle('active', el.id === `tab-${tabName}`));
}

// ============================================================
// 扫描模型
// ============================================================

async function scanModels() {
    addLog('info', '扫描 models/ 目录...');
    try {
        state.availableModels = await window.electronAPI.scanModels();
        renderModelList();
        renderInstances();
        updateInfo();
        addLog('info', `发现 ${state.availableModels.length} 个角色`);
    } catch (err) {
        addLog('error', `扫描失败: ${err.message}`);
    }
}

// ============================================================
// 角色列表
// ============================================================

function renderModelList() {
    if (state.availableModels.length === 0) {
        modelList.innerHTML = `<div class="model-list-empty">📂 未发现角色</div>`;
        return;
    }
    let html = '';
    for (const model of state.availableModels) {
        const sel = model.id === state.selectedModelId ? 'selected' : '';
        const run = state.runningInstances.has(model.id);
        const inst = state.runningInstances.get(model.id);
        html += `
            <div class="model-list-item ${sel}" onclick="selectModel('${model.id}')">
                <div class="model-icon">🎤</div>
                <div class="model-info">
                    <div class="model-name">${model.displayName}</div>
                    <div class="model-id">${model.id} · CH ${String(model.midiChannel).padStart(2,'0')}</div>
                </div>
                <span class="model-badge">${model.noteCount}</span>
                ${run ? '<span class="status-dot running" style="width:8px;height:8px;flex-shrink:0"></span>' : ''}
            </div>
            ${run ? `
            <div class="model-lcd ${inst?.isFallback ? 'lcd-fallback' : ''}">
                <div class="lcd-row">
                    <span class="lcd-label">NOTE</span>
                    <span class="lcd-value lcd-note ${inst?.currentNote ? 'lcd-active' : ''}">${inst?.currentNote || '--'}</span>
                </div>
                <div class="lcd-row">
                    <span class="lcd-label">${inst?.isFallback ? 'FALLBACK' : 'ACTION'}</span>
                    <span class="lcd-value lcd-action ${inst?.currentAction ? 'lcd-active' : ''}">${inst?.currentAction ? inst.currentAction.replace('./actions/','').replace('.vmd','') : 'idle'}</span>
                </div>
                <div class="lcd-row" style="margin-top:2px;padding-top:2px;border-top:1px solid rgba(255,255,255,0.05)">
                    <span class="lcd-label">FPS</span>
                    <span class="lcd-value" style="font-size:11px;color:${inst?.fps ? (inst.fps >= 30 ? 'var(--accent-green)' : 'var(--accent-yellow)') : 'rgba(255,255,255,0.15)'}">${inst?.fps || '--'} fps</span>
                </div>
            </div>` : ''}
        `;
    }
    modelList.innerHTML = html;
}

async function selectModel(modelId) {
    state.selectedModelId = modelId;
    renderModelList();
    const model = state.availableModels.find(m => m.id === modelId);
    if (!model) return;

    // 加载映射
    try {
        const md = await window.electronAPI.readMapping({ modelDir: model.modelDir });
        state.currentMappings = md.note_mappings || {};
        state.currentVmdFiles = await window.electronAPI.scanVmdFiles({ modelDir: model.modelDir });
    } catch (e) { state.currentMappings = {}; state.currentVmdFiles = []; }
    state.hasUnsavedMapping = false;
    mappingModelName.textContent = `${model.displayName} (${model.id})`;
    renderMappingEditor();
    populateQuickSelects();

    // 加载配置
    try {
        state.currentConfig = await window.electronAPI.readConfig({ modelDir: model.modelDir });
        state.currentPmxFiles = await window.electronAPI.scanPmxFiles({ modelDir: model.modelDir });
    } catch (e) { state.currentConfig = null; state.currentPmxFiles = []; }
    state.hasUnsavedConfig = false;
    configModelName.textContent = `${model.displayName} (${model.id})`;
    renderConfigEditor();

    switchTab('instances');
}

// ============================================================
// 新建角色
// ============================================================

function showNewModelDialog() { $('new-model-modal').classList.remove('hidden'); }
function closeNewModelDialog() { $('new-model-modal').classList.add('hidden'); }

async function createNewModel() {
    const id = $('new-model-id').value.trim();
    const name = $('new-model-name').value.trim();
    if (!id) { addLog('error', '请输入角色 ID'); return; }
    const result = await window.electronAPI.createModel({ modelId: id, displayName: name || id });
    if (result.success) {
        addLog('info', `角色 ${id} 已创建`);
        closeNewModelDialog();
        $('new-model-id').value = '';
        $('new-model-name').value = '';
        await scanModels();
        await selectModel(id);
    } else {
        addLog('error', `创建失败: ${result.error}`);
    }
}

// ============================================================
// 配置编辑器
// ============================================================

function renderConfigEditor() {
    const cfg = state.currentConfig;
    if (!cfg) {
        configEditorBody.innerHTML = `<div class="config-empty">👈 选择角色开始编辑</div>`;
        return;
    }

    const pmxOpts = state.currentPmxFiles.map(f =>
        `<option value="./${f.name}" ${cfg.model?.pmx_path === `./${f.name}` ? 'selected' : ''}>${f.name}</option>`
    ).join('');

    // 获取 MIDI 设备列表（从渲染进程的 Web MIDI API）
    const midiDevices = getMidiDeviceList();

    configEditorBody.innerHTML = `
        <div class="config-form">
            <!-- 基本信息 -->
            <div class="config-section">
                <div class="config-section-title">📋 基本信息</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>角色 ID</label>
                        <input class="form-input" value="${cfg.instance_id || ''}" disabled style="opacity:0.5">
                        <div class="form-hint">目录名，不可修改</div>
                    </div>
                    <div class="form-group">
                        <label>显示名称</label>
                        <input class="form-input" id="cfg-display-name" value="${cfg.display_name || ''}" onchange="updateConfigField('display_name', this.value)">
                    </div>
                </div>
            </div>

            <!-- MIDI 配置 -->
            <div class="config-section">
                <div class="config-section-title">🎹 MIDI 配置</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>MIDI 输入设备</label>
                        <select class="form-select" id="cfg-midi-device" onchange="updateConfigNested('midi','device_name',this.value)">
                            <option value="">— 所有设备 —</option>
                            ${midiDevices.map(d =>
                                `<option value="${d.name}" ${(cfg.midi?.device_name === d.name) ? 'selected' : ''}>${d.name}</option>`
                            ).join('')}
                            <option value="*" ${cfg.midi?.device_name === '*' ? 'selected' : ''}>任意设备</option>
                        </select>
                        <div class="form-hint">留空=监听所有设备，指定设备名=只监听该设备</div>
                    </div>
                    <div class="form-group">
                        <label>MIDI 通道 (1-16)</label>
                        <select class="form-select" id="cfg-midi-channel" onchange="updateConfigNested('midi','channel',parseInt(this.value))">
                            ${Array.from({length:16}, (_,i) =>
                                `<option value="${i+1}" ${(cfg.midi?.channel === i+1 || (!cfg.midi && cfg.midi_channel === i+1)) ? 'selected' : ''}>CH ${String(i+1).padStart(2,'0')}</option>`
                            ).join('')}
                        </select>
                        <div class="form-hint">每个角色独立通道，实现多角色分流</div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>设备过滤模式</label>
                        <select class="form-select" id="cfg-midi-mode" onchange="updateConfigNested('midi','mode',this.value)">
                            <option value="single" ${cfg.midi?.mode === 'single' || !cfg.midi?.mode ? 'selected' : ''}>单设备 + 指定通道</option>
                            <option value="all" ${cfg.midi?.mode === 'all' ? 'selected' : ''}>所有设备 + 指定通道</option>
                            <option value="omni" ${cfg.midi?.mode === 'omni' ? 'selected' : ''}>所有设备 + 所有通道 (Omni)</option>
                        </select>
                        <div class="form-hint">single=只监听指定设备的指定通道; all=监听所有设备的指定通道; omni=监听所有</div>
                    </div>
                    <div class="form-group"></div>
                </div>
            </div>

            <!-- 模型 -->
            <div class="config-section">
                <div class="config-section-title">🧊 模型</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>PMX 模型文件</label>
                        <select class="form-select" id="cfg-pmx" onchange="updateConfigPath('model.pmx_path', this.value)">
                            <option value="">— 选择模型 —</option>
                            ${pmxOpts}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>待机 VMD</label>
                        <input class="form-input" id="cfg-idle-vmd" value="${cfg.model?.vmd_path || ''}" placeholder="./idle.vmd" onchange="updateConfigPath('model.vmd_path', this.value)">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>缩放</label>
                        <input class="form-input" id="cfg-scale" type="number" step="0.1" value="${cfg.model?.scale || 1.0}" onchange="updateConfigNested('model', 'scale', parseFloat(this.value) || 1.0)">
                    </div>
                    <div class="form-group">
                        <label>位置 Y</label>
                        <input class="form-input" id="cfg-pos-y" type="number" step="0.5" value="${cfg.model?.position?.y || 0}" onchange="updateConfigNested('model', 'position', { ...cfg.model.position, y: parseFloat(this.value) || 0 })">
                    </div>
                </div>
            </div>

            <!-- 窗口 -->
            <div class="config-section">
                <div class="config-section-title">🪟 窗口</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>宽度</label>
                        <input class="form-input" id="cfg-win-w" type="number" value="${cfg.window?.width || 600}" onchange="updateConfigNested('window', 'width', parseInt(this.value) || 600)">
                    </div>
                    <div class="form-group">
                        <label>高度</label>
                        <input class="form-input" id="cfg-win-h" type="number" value="${cfg.window?.height || 800}" onchange="updateConfigNested('window', 'height', parseInt(this.value) || 800)">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-checkbox">
                        <input type="checkbox" id="cfg-always-top" ${cfg.window?.always_on_top !== false ? 'checked' : ''} onchange="updateConfigNested('window', 'always_on_top', this.checked)">
                        <label for="cfg-always-top">置顶显示</label>
                    </div>
                    <div class="form-checkbox">
                        <input type="checkbox" id="cfg-mouse-through" ${cfg.window?.mouse_through_default !== false ? 'checked' : ''} onchange="updateConfigNested('window', 'mouse_through_default', this.checked)">
                        <label for="cfg-mouse-through">默认鼠标穿透</label>
                    </div>
                </div>
            </div>

            <!-- 待机动作 -->
            <div class="config-section">
                <div class="config-section-title">🔄 待机动作</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Idle VMD 路径</label>
                        <input class="form-input" id="cfg-idle-path" value="${cfg.idle?.vmd_path || ''}" placeholder="./idle.vmd" onchange="updateConfigNested('idle', 'vmd_path', this.value)">
                    </div>
                    <div class="form-group">
                        <label>混合时间 (秒)</label>
                        <input class="form-input" id="cfg-idle-blend" type="number" step="0.05" value="${cfg.idle?.blend_time || 0.3}" onchange="updateConfigNested('idle', 'blend_time', parseFloat(this.value) || 0.3)">
                    </div>
                </div>
                <div class="form-checkbox">
                    <input type="checkbox" id="cfg-idle-loop" ${cfg.idle?.loop !== false ? 'checked' : ''} onchange="updateConfigNested('idle', 'loop', this.checked)">
                    <label for="cfg-idle-loop">循环播放</label>
                </div>
            </div>

            <!-- 眨眼 -->
            <div class="config-section">
                <div class="config-section-title">👁️ 随机眨眼</div>
                <div class="form-checkbox">
                    <input type="checkbox" id="cfg-blink" ${cfg.blink?.enabled !== false ? 'checked' : ''} onchange="updateConfigNested('blink', 'enabled', this.checked)">
                    <label for="cfg-blink">启用随机眨眼</label>
                </div>
                <div class="form-row" style="margin-top:8px">
                    <div class="form-group">
                        <label>最小间隔 (ms)</label>
                        <input class="form-input" id="cfg-blink-min" type="number" step="500" min="500" value="${cfg.blink?.min_interval || 2000}" onchange="updateConfigNested('blink', 'min_interval', parseInt(this.value) || 2000)">
                    </div>
                    <div class="form-group">
                        <label>最大间隔 (ms)</label>
                        <input class="form-input" id="cfg-blink-max" type="number" step="500" min="1000" value="${cfg.blink?.max_interval || 6000}" onchange="updateConfigNested('blink', 'max_interval', parseInt(this.value) || 6000)">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>眨眼持续时间 (ms)</label>
                        <input class="form-input" id="cfg-blink-dur" type="number" step="10" min="30" max="500" value="${cfg.blink?.duration || 120}" onchange="updateConfigNested('blink', 'duration', parseInt(this.value) || 120)">
                        <div class="form-hint">建议 80-150ms，太短看不清，太长不自然</div>
                    </div>
                    <div class="form-group"></div>
                </div>
            </div>

            <!-- 物理 -->
            <div class="config-section">
                <div class="config-section-title">⚡ 物理</div>
                <div class="form-checkbox">
                    <input type="checkbox" id="cfg-physics" ${cfg.physics?.enabled !== false ? 'checked' : ''} onchange="updateConfigNested('physics', 'enabled', this.checked)">
                    <label for="cfg-physics">启用刚体物理 (ammo.js)</label>
                </div>
            </div>
        </div>
    `;
}

function updateConfigField(field, value) {
    if (!state.currentConfig) return;
    state.currentConfig[field] = value;
    state.hasUnsavedConfig = true;
}

function updateConfigPath(field, value) {
    if (!state.currentConfig) return;
    const parts = field.split('.');
    if (parts.length === 2) {
        if (!state.currentConfig[parts[0]]) state.currentConfig[parts[0]] = {};
        state.currentConfig[parts[0]][parts[1]] = value;
    }
    state.hasUnsavedConfig = true;
}

function updateConfigNested(section, field, value) {
    if (!state.currentConfig) return;
    if (!state.currentConfig[section]) state.currentConfig[section] = {};
    state.currentConfig[section][field] = value;
    state.hasUnsavedConfig = true;
}

async function saveConfig() {
    if (!state.selectedModelId || !state.currentConfig) return;
    const model = state.availableModels.find(m => m.id === state.selectedModelId);
    if (!model) return;

    const result = await window.electronAPI.saveConfig({
        modelDir: model.modelDir,
        config: state.currentConfig,
    });

    if (result.success) {
        state.hasUnsavedConfig = false;
        addLog('info', `✅ 配置已保存到 ${model.id}/config.json`);
        // 刷新角色列表
        await scanModels();
    } else {
        addLog('error', `保存失败: ${result.error}`);
    }
}

// ============================================================
// 映射编辑器
// ============================================================

function renderMappingEditor() {
    const entries = Object.entries(state.currentMappings);
    if (entries.length === 0) {
        mappingContainer.innerHTML = `<div class="mapping-empty">🎼 暂无映射<br><span style="font-size:12px;color:var(--text-secondary)">使用下方工具条快速添加</span></div>`;
        return;
    }
    let html = `<table class="mapping-table"><thead><tr><th style="width:80px">音符</th><th>VMD</th><th style="width:70px">混合</th><th style="width:90px">重触发</th><th>描述</th><th style="width:40px"></th></tr></thead><tbody>`;
    for (const [note, mapping] of entries) {
        const vopts = state.currentVmdFiles.map(v =>
            `<option value="${v.relativePath}" ${(v.relativePath === mapping.vmd_path || v.name === mapping.vmd_path) ? 'selected' : ''}>${v.relativePath}</option>`
        ).join('');
        html += `<tr>
            <td class="note-cell">${note}</td>
            <td class="vmd-cell"><select class="vmd-select" data-note="${note}" onchange="updateMappingField('${note}','vmd_path',this.value)"><option value="">—</option>${vopts}</select></td>
            <td><input class="blend-input" value="${mapping.blend_time||0.1}" onchange="updateMappingField('${note}','blend_time',parseFloat(this.value)||0.1)"></td>
            <td><select class="retrigger-select" data-note="${note}" onchange="updateMappingField('${note}','retrigger_mode',this.value)">
                <option value="reset" ${mapping.retrigger_mode==='reset'?'selected':''}>reset</option>
                <option value="smooth" ${mapping.retrigger_mode==='smooth'?'selected':''}>smooth</option>
            </select></td>
            <td><input class="desc-input" value="${mapping.description||''}" placeholder="描述" onchange="updateMappingField('${note}','description',this.value)"></td>
            <td><button class="btn-icon" onclick="deleteMapping('${note}')">✕</button></td>
        </tr>`;
    }
    html += `</tbody></table>`;
    mappingContainer.innerHTML = html;
}

function updateMappingField(note, field, value) {
    if (!state.currentMappings[note]) state.currentMappings[note] = {};
    state.currentMappings[note][field] = value;
    state.hasUnsavedMapping = true;
}

function addMappingRow() {
    if (!state.selectedModelId) { addLog('error', '请先选择角色'); return; }
    const used = new Set(Object.keys(state.currentMappings));
    let nn = 'C4';
    for (const n of ALL_NOTES) { if (!used.has(n)) { nn = n; break; } }
    state.currentMappings[nn] = { vmd_path: '', blend_time: 0.1, retrigger_mode: 'reset', description: '' };
    state.hasUnsavedMapping = true;
    renderMappingEditor();
    addLog('info', `添加映射: ${nn}`);
}

function deleteMapping(note) {
    if (!confirm(`删除 ${note}？`)) return;
    delete state.currentMappings[note];
    state.hasUnsavedMapping = true;
    renderMappingEditor();
    populateQuickSelects();
}

function quickAddMapping() {
    const n = quickNoteSelect.value, v = quickVmdSelect.value;
    if (!n || !v) { addLog('error', '请选择音符和 VMD'); return; }
    state.currentMappings[n] = { vmd_path: v, blend_time: 0.1, retrigger_mode: 'reset', description: '' };
    state.hasUnsavedMapping = true;
    renderMappingEditor();
    populateQuickSelects();
    addLog('info', `快速添加: ${n} → ${v}`);
}

function populateQuickSelects() {
    const used = new Set(Object.keys(state.currentMappings));
    quickNoteSelect.innerHTML = '<option value="">选择音符...</option>';
    for (const n of ALL_NOTES) { if (!used.has(n)) quickNoteSelect.innerHTML += `<option value="${n}">${n}</option>`; }
    quickVmdSelect.innerHTML = '<option value="">选择 VMD...</option>';
    for (const v of state.currentVmdFiles) quickVmdSelect.innerHTML += `<option value="${v.relativePath}">${v.relativePath}</option>`;
}

async function saveMapping() {
    if (!state.selectedModelId) { addLog('error', '请先选择角色'); return; }
    const model = state.availableModels.find(m => m.id === state.selectedModelId);
    if (!model) return;
    for (const [n, m] of Object.entries(state.currentMappings)) { if (!m.vmd_path) delete state.currentMappings[n]; }
    const r = await window.electronAPI.saveMapping({ modelDir: model.modelDir, noteMappings: state.currentMappings });
    if (r.success) {
        state.hasUnsavedMapping = false;
        model.noteCount = Object.keys(state.currentMappings).length;
        addLog('info', `✅ 映射已保存 (${model.noteCount} 个)`);
        renderModelList();
        renderInstances();
    } else {
        addLog('error', `保存失败: ${r.error}`);
    }
}

// ============================================================
// 角色窗口管理（单进程多窗口）
// ============================================================

async function startCharacter(id, dir, ch) {
    // dir 可能被 encodeURIComponent 编码（来自 HTML onclick 中的 encodeURIComponent）
    // 也可能已经是原始路径（来自 startAll 直接传入）
    // 安全做法：尝试解码，如果解码后和原字符串不同则使用解码结果
    let decodedDir = dir;
    try {
        const testDecoded = decodeURIComponent(dir);
        if (testDecoded !== dir) {
            decodedDir = testDecoded;
        }
    } catch (e) {
        // 解码失败（如字符串包含 % 但不是合法编码），使用原值
        decodedDir = dir;
    }
    addLog('info', `打开角色窗口: ${id} (CH ${String(ch).padStart(2,'0')})`);
    addLog('info', `模型目录: ${decodedDir}`);
    const r = await window.electronAPI.startCharacter({ instanceId: id, modelDir: decodedDir, midiChannel: ch });
    if (r.success) {
        // ★ 注意：renderer 进程中无法访问 process.pid（contextIsolation），使用固定占位符
        state.runningInstances.set(id, { pid: 'same-process', midiChannel: ch, currentNote: null, currentAction: null, isFallback: false });
        addLog('info', `${id} 窗口已打开`);
    } else { addLog('error', `打开失败: ${r.error}`); }
    renderModelList(); renderInstances(); updateInfo();
}

async function stopCharacter(id) {
    addLog('info', `关闭角色窗口: ${id}`);
    await window.electronAPI.stopCharacter({ instanceId: id });
    state.runningInstances.delete(id);
    renderModelList(); renderInstances(); updateInfo();
}

async function startAll() {
    for (const m of state.availableModels) {
        if (!state.runningInstances.has(m.id)) await startCharacter(m.id, m.modelDir, m.midiChannel);
    }
}
async function stopAll() {
    for (const [id] of state.runningInstances) await stopCharacter(id);
}

// ============================================================
// 实例表格
// ============================================================

function renderInstances() {
    if (state.availableModels.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">📂 未发现角色</td></tr>`;
        return;
    }
    let html = '';
    for (const model of state.availableModels) {
        const run = state.runningInstances.get(model.id);
        const ir = !!run;
        const cn = run?.currentNote || null;
        const ca = run?.currentAction || null;
        const fb = run?.isFallback || false;
        html += `<tr>
            <td><strong>${model.displayName}</strong><div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${model.id}</div></td>
            <td><span class="channel-badge">CH ${String(model.midiChannel).padStart(2,'0')}</span></td>
            <td><span class="status-badge ${ir?'running':'stopped'}"><span class="status-dot ${ir?'running':'stopped'}"></span> ${ir?'运行中':'已停止'}</span></td>
            <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)">${ir ? run.pid : '—'}</td>
            <td>${ir ? `
                <div class="table-lcd ${fb?'lcd-fallback':''}">
                    <div class="lcd-row"><span class="lcd-label">NOTE</span><span class="lcd-value lcd-note ${cn?'lcd-active':''}">${cn||'--'}</span></div>
                    <div class="lcd-row"><span class="lcd-label">${fb?'FALLBACK':'ACTION'}</span><span class="lcd-value lcd-action ${ca?'lcd-active':''}">${ca?ca.replace('./actions/','').replace('.vmd',''):'idle'}</span></div>
                    <div class="lcd-row" style="margin-top:1px;padding-top:1px;border-top:1px solid rgba(255,255,255,0.05)">
                        <span class="lcd-label">FPS</span>
                        <span class="lcd-value" style="font-size:10px;color:${run?.fps ? (run.fps >= 30 ? 'var(--accent-green)' : 'var(--accent-yellow)') : 'rgba(255,255,255,0.15)'}">${run?.fps || '--'} fps</span>
                    </div>
                </div>` : '<span style="color:var(--text-secondary);font-size:12px">—</span>'}
            </td>
            <td style="color:var(--text-secondary);font-size:12px">${model.noteCount}</td>
            <td>
                ${ir
                    ? `<button class="btn btn-small btn-stop" onclick="stopCharacter('${model.id}')">■ 关闭</button>`
                    : `<button class="btn btn-small btn-start" onclick="startCharacter('${model.id}','${encodeURIComponent(model.modelDir)}',${model.midiChannel})">▶ 打开</button>`
                }
                <button class="btn btn-small btn-secondary" style="margin-left:4px" onclick="selectModel('${model.id}');switchTab('config')">⚙️</button>
                <button class="btn btn-small btn-secondary" style="margin-left:2px" onclick="selectModel('${model.id}');switchTab('mapping')">🎼</button>
            </td>
        </tr>`;
    }
    tbody.innerHTML = html;
}

function updateInfo() {
    // 可选更新状态栏信息
}

// ============================================================
// MIDI 设备检测
// ============================================================

/** 缓存的 MIDI 设备列表，供配置编辑器使用 */
let _midiDeviceList = [];

async function detectMidiDevices() {
    try {
        const access = await navigator.requestMIDIAccess();
        const sel = $('midi-device');
        _midiDeviceList = [];
        for (const input of access.inputs.values()) {
            _midiDeviceList.push({ id: input.id, name: input.name || `MIDI ${input.id}`, manufacturer: input.manufacturer });
        }
        if (sel) {
            sel.innerHTML = '';
            if (_midiDeviceList.length === 0) {
                sel.innerHTML = '<option value="">— 无设备 —</option>';
            } else {
                for (const d of _midiDeviceList) sel.innerHTML += `<option value="${d.id}">${d.name}</option>`;
                sel.disabled = false;
            }
        }
    } catch (e) { /* ignore */ }
}

/** 获取 MIDI 设备列表（供配置编辑器表单使用） */
function getMidiDeviceList() {
    return _midiDeviceList;
}

// ============================================================
// 状态监听
// ============================================================

// 角色窗口关闭通知（从主进程接收）
window.electronAPI.onCharacterClosed((data) => {
    state.runningInstances.delete(data.instanceId);
    addLog('info', `角色窗口已关闭: ${data.instanceId}`);
    renderModelList(); renderInstances();
});

// 角色窗口状态更新（从主进程接收）
window.electronAPI.onCharacterStatus((data) => {
    const inst = state.runningInstances.get(data.instanceId);
    if (inst) {
        inst.currentNote = data.currentNote || null;
        inst.currentAction = data.currentAction || null;
        inst.isFallback = data.isFallback || false;
        inst.fps = data.fps || '--';
        renderModelList();
        renderInstances();
    }
});

// ============================================================
// 初始化
// ============================================================

async function init() {
    addLog('info', 'AnimoNote Control Center 已启动');
    await scanModels();
    await detectMidiDevices();

    // 定期同步角色窗口状态（单进程内直接查询）
    setInterval(async () => {
        try {
            const list = await window.electronAPI.getCharacters();
            // 同步运行状态：移除已关闭的窗口
            const activeIds = new Set(list.map(i => i.instanceId));
            for (const [id] of state.runningInstances) {
                if (!activeIds.has(id)) {
                    state.runningInstances.delete(id);
                }
            }
            renderModelList(); renderInstances();
        } catch (e) {}
    }, 2000);

    window.addEventListener('beforeunload', (e) => {
        if (state.hasUnsavedMapping || state.hasUnsavedConfig) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

document.addEventListener('DOMContentLoaded', init);
