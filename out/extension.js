"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
// ─── Ollama Helpers ─────────────────────────────────────────────────────────
function getAvailableModels() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost', port: 11434,
            path: '/api/tags', method: 'GET'
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const models = parsed.models?.map((m) => m.name) || [];
                    resolve(models);
                }
                catch {
                    resolve([]);
                }
            });
        });
        req.on('error', () => resolve([]));
        req.end();
    });
}
function askAgent(message, history, systemPrompt, model) {
    return new Promise((resolve, reject) => {
        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: message }
        ];
        const body = JSON.stringify({ model, messages, stream: false });
        const options = {
            hostname: 'localhost', port: 11434,
            path: '/api/chat', method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed.message?.content || 'Eroare la parsare răspuns');
                }
                catch {
                    reject(new Error('JSON parse error'));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
// ─── Context Helpers ─────────────────────────────────────────────────────────
function getProjectContext() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders)
        return '';
    const root = folders[0].uri.fsPath;
    const ignored = new Set(['node_modules', '.git', '__pycache__', '.next', 'dist', 'out']);
    function walk(dir, level = 0) {
        if (level > 2)
            return '';
        let result = '';
        try {
            for (const item of fs.readdirSync(dir)) {
                if (ignored.has(item) || item.startsWith('.'))
                    continue;
                const full = path.join(dir, item);
                const indent = '  '.repeat(level);
                if (fs.statSync(full).isDirectory()) {
                    result += `${indent}📁 ${item}/\n` + walk(full, level + 1);
                }
                else {
                    result += `${indent}📄 ${item}\n`;
                }
            }
        }
        catch { }
        return result;
    }
    const active = vscode.window.activeTextEditor?.document.fileName || '';
    const activeRel = active ? path.relative(root, active) : 'niciunul';
    return `Proiect: ${path.basename(root)}\nCale: ${root}\nFișier activ: ${activeRel}\n\nStructură:\n${walk(root)}`;
}
function getActiveFileContent() {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return '';
    const doc = editor.document;
    const lines = doc.getText().split('\n').slice(0, 200).join('\n');
    return `\n\nFișier activ (${path.basename(doc.fileName)}):\n\`\`\`\n${lines}\n\`\`\``;
}
function runGitCommand(command, cwd) {
    return new Promise((resolve) => {
        (0, child_process_1.exec)(`git ${command}`, { cwd }, (err, stdout, stderr) => {
            resolve(stdout || stderr || err?.message || '');
        });
    });
}
async function getGitContext(root) {
    try {
        const [status, branch] = await Promise.all([
            runGitCommand('status --short', root),
            runGitCommand('branch --show-current', root)
        ]);
        if (!status && !branch)
            return '';
        return `\nGit branch: ${branch.trim()}\nGit status:\n${status}`;
    }
    catch {
        return '';
    }
}
function readMemory(memPath) {
    try {
        if (fs.existsSync(memPath))
            return fs.readFileSync(memPath, 'utf8');
    }
    catch { }
    return '';
}
function writeMemory(memPath, content) {
    try {
        fs.writeFileSync(memPath, content, 'utf8');
    }
    catch { }
}
function buildSystemPrompt(language, projectCtx) {
    if (language === 'en') {
        return `You are WildArt Agent, a local AI assistant specialized in programming.
Always respond in ENGLISH. Be concise and direct.

${projectCtx}

You can help with: reading/writing files, git operations, code refactoring, finding functions, generating tests.
When asked to modify code, show changes clearly with code blocks.`;
    }
    return `Ești WildArt Agent, un agent AI local specializat în programare.
Răspunde ÎNTOTDEAUNA în ROMÂNĂ. Fii concis și direct.

${projectCtx}

Poți ajuta cu: citire/scriere fișiere, operații git, refactoring cod, găsire funcții, generare teste.
Când ți se cere să modifici cod, arată modificările clar cu blocuri de cod.`;
}
// ─── Extension ──────────────────────────────────────────────────────────────
function activate(context) {
    const provider = new WildArtAgentPanel(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('wildartAgent', provider));
    context.subscriptions.push(vscode.commands.registerCommand('wildartAgent.clearChat', () => provider.clearChat()));
    context.subscriptions.push(vscode.commands.registerCommand('wildartAgent.gitCommit', () => provider.quickGitCommit()));
    context.subscriptions.push(vscode.commands.registerCommand('wildartAgent.selectModel', () => provider.selectModel()));
    context.subscriptions.push(vscode.commands.registerCommand('wildartAgent.selectLanguage', () => provider.selectLanguage()));
}
// ─── Panel ──────────────────────────────────────────────────────────────────
class WildArtAgentPanel {
    _context;
    _view;
    _history = [];
    _settings = {
        language: 'ro',
        model: 'qwen2.5-coder:7b',
        availableModels: []
    };
    constructor(_context) {
        this._context = _context;
        // Încarcă setările salvate
        const saved = _context.globalState.get('wildartSettings');
        if (saved)
            this._settings = { ...this._settings, ...saved };
    }
    saveSettings() {
        this._context.globalState.update('wildartSettings', this._settings);
    }
    clearChat() {
        this._history = [];
        this._view?.webview.postMessage({ type: 'clear' });
    }
    async selectModel() {
        // Fetch modele disponibile din Ollama
        const models = await getAvailableModels();
        if (models.length === 0) {
            vscode.window.showErrorMessage('Nu pot contacta Ollama. Verifică că rulează pe localhost:11434');
            return;
        }
        this._settings.availableModels = models;
        const selected = await vscode.window.showQuickPick(models, {
            placeHolder: `Model curent: ${this._settings.model}`,
            title: 'Selectează modelul AI'
        });
        if (selected) {
            this._settings.model = selected;
            this.saveSettings();
            this._view?.webview.postMessage({
                type: 'settingsUpdate',
                model: selected,
                language: this._settings.language
            });
            vscode.window.showInformationMessage(`✅ Model schimbat: ${selected}`);
        }
    }
    async selectLanguage() {
        const options = [
            { label: '🇷🇴 Română', value: 'ro' },
            { label: '🇬🇧 English', value: 'en' }
        ];
        const selected = await vscode.window.showQuickPick(options.map(o => o.label), { title: 'Selectează limba agentului' });
        if (selected) {
            this._settings.language = selected.includes('English') ? 'en' : 'ro';
            this.saveSettings();
            this._view?.webview.postMessage({
                type: 'settingsUpdate',
                model: this._settings.model,
                language: this._settings.language
            });
            const msg = this._settings.language === 'en'
                ? '✅ Language changed to English'
                : '✅ Limbă schimbată în Română';
            vscode.window.showInformationMessage(msg);
        }
    }
    async quickGitCommit() {
        const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!root) {
            vscode.window.showErrorMessage('Niciun proiect deschis');
            return;
        }
        const diff = await runGitCommand('diff --staged', root);
        if (!diff) {
            vscode.window.showWarningMessage(this._settings.language === 'en'
                ? 'No staged files. Run git add first.'
                : 'Nu există fișiere staged. Rulează git add mai întâi.');
            return;
        }
        const prompt = this._settings.language === 'en'
            ? 'Generate a short commit message for this diff. Respond ONLY with the message, max 72 chars.'
            : 'Generează un mesaj de commit scurt pentru acest diff. Răspunde DOAR cu mesajul, max 72 caractere.';
        const commitMsg = await askAgent(`${prompt}\n\n${diff.slice(0, 1000)}`, [], prompt, this._settings.model);
        const confirmed = await vscode.window.showInputBox({
            prompt: this._settings.language === 'en' ? 'AI generated commit message' : 'Mesaj commit generat de AI',
            value: commitMsg.trim()
        });
        if (confirmed) {
            await runGitCommand('add -A', root);
            await runGitCommand(`commit -m "${confirmed}"`, root);
            vscode.window.showInformationMessage(`✅ Commit: ${confirmed}`);
            this._view?.webview.postMessage({ type: 'response', text: `✅ Commit: "${confirmed}"` });
        }
    }
    async resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtml();
        // Trimite setările curente la webview
        setTimeout(() => {
            webviewView.webview.postMessage({
                type: 'settingsUpdate',
                model: this._settings.model,
                language: this._settings.language
            });
        }, 500);
        const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        const memPath = root ? path.join(root, '.wildart-memory.json') : '';
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === 'message') {
                try {
                    webviewView.webview.postMessage({ type: 'thinking' });
                    const projectCtx = getProjectContext();
                    const fileContent = getActiveFileContent();
                    const gitCtx = root ? await getGitContext(root) : '';
                    const memory = memPath ? readMemory(memPath) : '';
                    const fullContext = `${memory ? `MEMORIE PROIECT:\n${memory}\n\n` : ''}CONTEXT:\n${projectCtx}${fileContent}${gitCtx}`;
                    const systemPrompt = buildSystemPrompt(this._settings.language, fullContext);
                    const response = await askAgent(data.text, this._history, systemPrompt, this._settings.model);
                    this._history.push({ role: 'user', content: data.text });
                    this._history.push({ role: 'assistant', content: response });
                    // Auto-save memorie
                    if (data.text.toLowerCase().includes('ține minte') ||
                        data.text.toLowerCase().includes('remember')) {
                        const entry = `[${new Date().toLocaleDateString()}] ${data.text}: ${response.slice(0, 200)}\n`;
                        if (memPath)
                            writeMemory(memPath, readMemory(memPath) + entry);
                    }
                    webviewView.webview.postMessage({ type: 'response', text: response });
                }
                catch {
                    const errMsg = this._settings.language === 'en'
                        ? '❌ Cannot contact Ollama. Check it runs on localhost:11434'
                        : '❌ Nu pot contacta Ollama. Verifică că rulează pe localhost:11434';
                    webviewView.webview.postMessage({ type: 'response', text: errMsg });
                }
            }
            else if (data.type === 'selectModel') {
                this.selectModel();
            }
            else if (data.type === 'selectLanguage') {
                this.selectLanguage();
            }
        });
    }
    _getHtml() {
        return `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    background: var(--vscode-sideBar-background);
    color: var(--vscode-foreground);
    display: flex; flex-direction: column; height: 100vh; padding: 8px;
  }
  #header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 8px;
  }
  #header h2 { font-size: 13px; font-weight: 600; }
  #header-actions { display: flex; gap: 4px; }
  .icon-btn {
    background: transparent; border: none; color: var(--vscode-foreground);
    cursor: pointer; font-size: 13px; padding: 3px 6px; border-radius: 4px; opacity: 0.7;
  }
  .icon-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
  #status-bar {
    display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap;
  }
  .status-chip {
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    border-radius: 10px; padding: 2px 8px; font-size: 10px; cursor: pointer;
  }
  .status-chip:hover { opacity: 0.8; }
  #chat {
    flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 0;
  }
  .msg {
    padding: 8px 10px; border-radius: 6px; font-size: 12px;
    line-height: 1.5; word-wrap: break-word; white-space: pre-wrap;
  }
  .user {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    align-self: flex-end; max-width: 85%;
  }
  .agent { background: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; max-width: 95%; }
  .thinking { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 11px; }
  #input-area {
    display: flex; gap: 6px; padding-top: 8px; border-top: 1px solid var(--vscode-panel-border);
  }
  #input {
    flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); border-radius: 4px;
    padding: 6px 8px; font-size: 12px; resize: none; font-family: var(--vscode-font-family); outline: none;
  }
  #input:focus { border-color: var(--vscode-focusBorder); }
  #send {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 14px; align-self: flex-end;
  }
  #send:hover { background: var(--vscode-button-hoverBackground); }
  #send:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
</head>
<body>
<div id="header">
  <div style="display:flex;align-items:center;gap:8px">
    <span>🤖</span><h2>WildArt Agent</h2>
  </div>
  <div id="header-actions">
    <button class="icon-btn" onclick="clearChat()" title="Reset chat">🗑️</button>
    <button class="icon-btn" onclick="gitCommit()" title="Git commit">📦</button>
  </div>
</div>
<div id="status-bar">
  <span class="status-chip" onclick="selectModel()" id="model-chip">⚙️ model</span>
  <span class="status-chip" onclick="selectLanguage()" id="lang-chip">🌐 lang</span>
</div>
<div id="chat">
  <div class="msg agent">Salut! Sunt WildArt Agent 🤖\nVăd proiectul tău și fișierul activ.\n\nClick pe ⚙️ pentru model și 🌐 pentru limbă.</div>
</div>
<div id="input-area">
  <textarea id="input" rows="2" placeholder="Scrie o comandă... (Enter = trimite, Shift+Enter = linie nouă)"></textarea>
  <button id="send">▶</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const chat = document.getElementById('chat');
  const input = document.getElementById('input');
  const send = document.getElementById('send');

  function addMsg(text, cls) {
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  function clearChat() { vscode.postMessage({ type: 'clearChat' }); }
  function gitCommit() { vscode.postMessage({ type: 'gitCommit' }); }
  function selectModel() { vscode.postMessage({ type: 'selectModel' }); }
  function selectLanguage() { vscode.postMessage({ type: 'selectLanguage' }); }

  send.addEventListener('click', sendMsg);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });

  function sendMsg() {
    const text = input.value.trim();
    if (!text || send.disabled) return;
    addMsg(text, 'user');
    input.value = '';
    send.disabled = true;
    vscode.postMessage({ type: 'message', text });
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'thinking') {
      addMsg('⏳ ...', 'thinking');
    } else if (msg.type === 'response') {
      document.querySelector('.thinking')?.remove();
      addMsg(msg.text, 'agent');
      send.disabled = false;
      input.focus();
    } else if (msg.type === 'clear') {
      chat.innerHTML = '<div class="msg agent">Chat resetat.</div>';
    } else if (msg.type === 'settingsUpdate') {
      document.getElementById('model-chip').textContent = '⚙️ ' + msg.model;
      document.getElementById('lang-chip').textContent = msg.language === 'en' ? '🇬🇧 English' : '🇷🇴 Română';
    }
  });
</script>
</body>
</html>`;
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map