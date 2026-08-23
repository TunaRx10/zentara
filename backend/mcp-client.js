// mcp-client.js — Client MCP stdio minimal (JSON-RPC newline-delimited).
// Permet à Node de piloter linkedin-mcp-server (FastMCP) : initialize →
// tools/list → tools/call (ex: search_people).
'use strict';

const { spawn } = require('node:child_process');
const readline = require('node:readline');

class McpStdioClient {
  constructor({ command, args = [], cwd, env, stderrMax = 8000 }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.stderrMax = stderrMax;
    this.child = null;
    this.rl = null;
    this.nextId = 0;
    this.pending = new Map();
    this.stderr = '';
    this.exited = false;
    this.exitCode = null;
  }

  /** Démarre le serveur MCP et fait le handshake initialize + initialized. */
  start(timeoutMs = 40000) {
    return new Promise((resolve, reject) => {
      this.child = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: { ...process.env, ...(this.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.rl = readline.createInterface({ input: this.child.stdout });
      this.rl.on('line', (line) => this._onLine(line));
      this.child.stderr.on('data', (d) => {
        this.stderr = (this.stderr + d.toString()).slice(-this.stderrMax);
      });
      this.child.on('error', (e) => reject(e));
      this.child.on('exit', (code) => {
        this.exited = true;
        this.exitCode = code;
        for (const [, p] of this.pending) p.reject(new Error(`MCP server exited (code ${code})`));
        this.pending.clear();
      });

      this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'zentara', version: '1.0.0' },
      }, timeoutMs)
        .then(() => {
          this.notify('notifications/initialized', {});
          resolve();
        })
        .catch(reject);
    });
  }

  _onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }

  _send(msg) {
    if (!this.child || this.exited) throw new Error('MCP client fermé');
    this.child.stdin.write(JSON.stringify(msg) + '\n');
  }

  request(method, params, timeoutMs = 30000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params });
  }

  /** Liste les outils exposés par le serveur. */
  async listTools(timeoutMs = 30000) {
    const r = await this.request('tools/list', {}, timeoutMs);
    return (r && r.tools) || [];
  }

  /** Appelle un outil (ex: search_people). */
  async callTool(name, args = {}, timeoutMs = 120000) {
    return this.request('tools/call', { name, arguments: args }, timeoutMs);
  }

  close() {
    try { this.child?.kill('SIGKILL'); } catch {}
    this.exited = true;
  }
}

module.exports = { McpStdioClient };
