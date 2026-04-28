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
const child_process_1 = require("child_process");
const SERVER_URL = 'http://localhost:8765';
function httpPost(url, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: parseInt(urlObj.port),
            path: urlObj.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        };
        const req = http.request(options, (res) => {
            let d = '';
            res.on('data', chunk => d += chunk);
            res.on('end', () => { try {
                resolve(JSON.parse(d));
            }
            catch {
                reject(new Error('Parse error'));
            } });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let d = '';
            res.on('data', chunk => d += chunk);
            res.on('end', () => { try {
                resolve(JSON.parse(d));
            }
            catch {
                reject(new Error('Parse error'));
            } });
        }).on('error', reject);
    });
}
function checkServer() {
    return httpGet(`${SERVER_URL}/health`).then(() => true).catch(() => false);
}
function runGitCommand(command, cwd) {
    return new Promise((resolve) => {
        (0, child_process_1.exec)(`git ${command}`, { cwd }, (err, stdout, stderr) => {
            resolve(stdout || stderr || err?.message || '');
        });
    });
}
function activate(context) {
    const provider = new WildArtAgentPanel(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('wildartAgent', provider));
    context.subscriptions.push(vscode.commands.registerCommand('wildartAgent.clearChat', () => provider.clearChat()));
    context.subscriptions.push(vscode.commands.registerCommand('wildartAgent.gitCommit', () => provider.quickGitCommit()));
    context.subscriptions.push(vscode.commands.registerCommand('wildartAgent.selectLanguage', () => provider.selectLanguage()));
}
class WildArtAgentPanel {
    _context;
    _view;
    _settings;
    _sessionId;
    constructor(_context) {
        this._context = _context;
        const saved = _context.globalState.get('wildartSettings');
        this._settings = saved || { language: 'ro', model: 'qwen2.5-coder:7b' };
        this._sessionId = 'vscode_' + Date.now();
    }
    clearChat() {
        const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        httpPost(`${SERVER_URL}/reset`, { project_path: root, session_id: this._sessionId }).catch(() => { });
        this._view?.webview.postMessage({ type: 'clear' });
    }
    async selectLanguage() {
        const options = ['🇷🇴 Română', '🇬🇧 English'];
        const selected = await vscode.window.showQuickPick(options, { title: 'Selectează limba' });
        if (selected) {
            this._settings.language = selected.includes('English') ? 'en' : 'ro';
            this._context.globalState.update('wildartSettings', this._settings);
            this._view?.webview.postMessage({ type: 'settingsUpdate', language: this._settings.language });
            vscode.window.showInformationMessage(this._settings.language === 'en' ? '✅ English' : '✅ Română');
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
            vscode.window.showWarningMessage('Nu există fișiere staged.');
            return;
        }
        const result = await httpPost(`${SERVER_URL}/chat`, {
            message: `Generează DOAR un mesaj de commit scurt (max 72 chars) pentru acest diff:\n${diff.slice(0, 800)}`,
            project_path: root,
            session_id: this._sessionId + '_commit'
        });
        const confirmed = await vscode.window.showInputBox({
            prompt: 'Mesaj commit generat de AI',
            value: result.response?.trim() || ''
        });
        if (confirmed) {
            await runGitCommand('add -A', root);
            await runGitCommand(`commit -m "${confirmed}"`, root);
            vscode.window.showInformationMessage(`✅ Commit: ${confirmed}`);
        }
    }
    async resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtml();
        const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        // Verifică serverul și setează proiectul
        setTimeout(async () => {
            const serverOk = await checkServer();
            if (serverOk && root) {
                await httpPost(`${SERVER_URL}/set_project`, {
                    project_path: root,
                    session_id: this._sessionId
                }).catch(() => { });
            }
            webviewView.webview.postMessage({
                type: 'serverStatus',
                online: serverOk,
                language: this._settings.language
            });
        }, 500);
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === 'message') {
                try {
                    webviewView.webview.postMessage({ type: 'thinking' });
                    const serverOk = await checkServer();
                    if (!serverOk) {
                        webviewView.webview.postMessage({
                            type: 'response',
                            text: '❌ Serverul nu rulează!\n\nDeschide un terminal și rulează:\ncd ~/executive-agent && python3 server.py'
                        });
                        return;
                    }
                    const response = await httpPost(`${SERVER_URL}/chat`, {
                        message: data.text,
                        project_path: root,
                        session_id: this._sessionId
                    });
                    webviewView.webview.postMessage({ type: 'response', text: response.response });
                }
                catch {
                    webviewView.webview.postMessage({
                        type: 'response',
                        text: '❌ Eroare conexiune server. Verifică că rulează:\npython3 ~/executive-agent/server.py'
                    });
                }
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
  #server-status {
    font-size: 10px; padding: 2px 8px; border-radius: 10px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  #header-actions { display: flex; gap: 4px; }
  .icon-btn {
    background: transparent; border: none; color: var(--vscode-foreground);
    cursor: pointer; font-size: 13px; padding: 3px 6px; border-radius: 4px; opacity: 0.7;
  }
  .icon-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
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
  .error { color: var(--vscode-errorForeground); font-size: 11px; }
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
    <span id="server-status">⏳ conectare...</span>
  </div>
  <div id="header-actions">
    <button class="icon-btn" onclick="selectLanguage()" title="Limbă">🌐</button>
    <button class="icon-btn" onclick="gitCommit()" title="Git commit">📦</button>
    <button class="icon-btn" onclick="clearChat()" title="Reset">🗑️</button>
  </div>
</div>
<div id="chat">
  <div class="msg agent">Salut! Sunt WildArt Agent 🤖\nMă conectez la server...</div>
</div>
<div id="input-area">
  <textarea id="input" rows="2" placeholder="Scrie o comandă..."></textarea>
  <button id="send">▶</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const chat = document.getElementById('chat');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const serverStatus = document.getElementById('server-status');

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
      addMsg('⏳ Gândesc...', 'thinking');
    } else if (msg.type === 'response') {
      document.querySelector('.thinking')?.remove();
      addMsg(msg.text, 'agent');
      send.disabled = false;
      input.focus();
    } else if (msg.type === 'clear') {
      chat.innerHTML = '<div class="msg agent">Chat resetat.</div>';
    } else if (msg.type === 'serverStatus') {
      if (msg.online) {
        serverStatus.textContent = '🟢 online';
        serverStatus.style.background = 'rgba(0,200,0,0.2)';
        chat.innerHTML = '<div class="msg agent">✅ Server conectat! Cu ce te ajut?</div>';
      } else {
        serverStatus.textContent = '🔴 offline';
        serverStatus.style.background = 'rgba(200,0,0,0.2)';
        chat.innerHTML = '<div class="msg error">❌ Serverul nu rulează!\n\nDeschide terminal și rulează:\ncd ~/executive-agent\npython3 server.py</div>';
      }
    } else if (msg.type === 'settingsUpdate') {
      // update language display
    }
  });
</script>
</body>
</html>`;
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map