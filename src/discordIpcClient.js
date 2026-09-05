import net from "node:net";
import crypto from "node:crypto";
import process from "node:process";
import {
  candidateSocketPaths,
  windowsPipeCandidates,
} from "./ipcSocketPaths.js";

// Minimal reimplementation of Discord's local RPC (IPC) protocol — just
// enough to do a handshake and send SET_ACTIVITY. We avoid depending on any
// discord-rpc npm package so we have full control over socket discovery
// (see ipcSocketPaths.js) and no third-party code running against a live
// IPC socket.
//
// Wire format: every frame is `opcode:uint32LE, length:uint32LE, payload`.
// Opcodes: 0 = HANDSHAKE, 1 = FRAME (JSON command/dispatch), 2 = CLOSE.

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;

function encodeFrame(opcode, obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(opcode, 0);
  header.writeUInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

class FrameReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(4);
      if (this.buffer.length < 8 + length) break;
      const payload = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      let data = null;
      try {
        data = JSON.parse(payload.toString("utf8"));
      } catch {
        // ignore malformed frame
      }
      frames.push({ opcode, data });
    }
    return frames;
  }
}

async function tryConnect(socketPath, timeoutMs = 400) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timeout"));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Finds and connects to a live Discord RPC socket, trying every plausible
 * location (native, Flatpak, Snap, Vesktop, Canary/PTB) in order.
 */
async function connectToAnySocket() {
  const candidates =
    process.platform === "win32" ? windowsPipeCandidates() : candidateSocketPaths();

  for (const candidate of candidates) {
    try {
      const socket = await tryConnect(candidate);
      return { socket, path: candidate };
    } catch {
      // try next candidate
    }
  }
  throw new Error("No Discord IPC socket found");
}

export class DiscordIpcClient {
  /**
   * @param {string} clientId Discord application client ID.
   * @param {(state: "connected"|"disconnected", info?: any) => void} onStatus
   */
  constructor(clientId, onStatus = () => {}) {
    this.clientId = clientId;
    this.onStatus = onStatus;
    this.socket = null;
    this.reader = new FrameReader();
    this.ready = false;
    this.connecting = false;
  }

  async connect() {
    if (this.connecting || this.ready) return;
    this.connecting = true;
    try {
      const { socket, path } = await connectToAnySocket();
      this.socket = socket;
      this.reader = new FrameReader();

      socket.on("data", (chunk) => this._handleData(chunk));
      socket.on("close", () => this._handleClose());
      socket.on("error", () => this._handleClose());

      socket.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));

      await this._waitForReady();
      this.onStatus("connected", { socketPath: path });
    } finally {
      this.connecting = false;
    }
  }

  _waitForReady() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("handshake timeout")), 3000);
      this._readyResolver = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  _handleData(chunk) {
    const frames = this.reader.push(chunk);
    for (const frame of frames) {
      if (frame.opcode === OP_CLOSE) {
        this._handleClose();
        continue;
      }
      const evt = frame.data?.evt;
      if (evt === "READY") {
        this.ready = true;
        this._readyResolver?.();
      } else if (evt === "ERROR") {
        // Discord reported an error (e.g. invalid client id) — surface it.
        this.onStatus("error", frame.data);
      }
    }
  }

  _handleClose() {
    if (!this.ready && !this.socket) return;
    this.ready = false;
    this.socket = null;
    this.onStatus("disconnected");
  }

  setActivity(activity) {
    if (!this.ready || !this.socket) return;
    const payload = {
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity,
      },
      nonce: crypto.randomUUID(),
    };
    this.socket.write(encodeFrame(OP_FRAME, payload));
  }

  clearActivity() {
    if (!this.ready || !this.socket) return;
    const payload = {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity: null },
      nonce: crypto.randomUUID(),
    };
    this.socket.write(encodeFrame(OP_FRAME, payload));
  }

  disconnect() {
    try {
      this.socket?.end();
    } catch {
      // ignore
    }
    this.ready = false;
    this.socket = null;
  }
}
