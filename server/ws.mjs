// SPDX-License-Identifier: AGPL-3.0-or-later
// A minimal WebSocket server (RFC 6455) on top of node:http, so the LAN server keeps zero dependencies.
// Text messages carry JSON. No extensions (permessage-deflate is never negotiated).
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 1 << 20;

/** Builds one unmasked server frame. */
export function encodeFrame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/**
 * Incremental frame parser: feed it TCP chunks, it calls `onFrame(fin, opcode, payload)` for every
 * complete frame. Throws on protocol errors (unmasked client frame, oversized message).
 */
export function frameParser(onFrame, { requireMask = true } = {}) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) throw new Error('frame too large');
        len = Number(big);
        off = 10;
      }
      if (len > MAX_MESSAGE) throw new Error('frame too large');
      if (requireMask && !masked) throw new Error('client frames must be masked');
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const key = buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
      }
      buf = buf.subarray(need);
      onFrame(fin, opcode, payload);
    }
  };
}

/**
 * Completes the handshake for an HTTP 'upgrade' request and returns a connection:
 * `{ send(obj), close(), onMessage, onClose }`, or null if the request isn't a WebSocket upgrade.
 */
export function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1')
    .update(key + GUID)
    .digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  let open = true;
  let parts = [];
  const conn = {
    onMessage: (_msg) => {},
    onClose: () => {},
    send(obj) {
      if (!open) return;
      // Drop the update rather than queueing up behind a slow client.
      if (socket.writableLength > 4 * MAX_MESSAGE) return;
      socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(obj))));
    },
    close() {
      if (!open) return;
      open = false;
      socket.end(encodeFrame(0x8, Buffer.alloc(0)));
      conn.onClose();
    },
  };
  const parse = frameParser((fin, opcode, payload) => {
    if (opcode === 0x8) return conn.close();
    if (opcode === 0x9) return socket.write(encodeFrame(0xa, payload));
    if (opcode === 0xa) return;
    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      parts.push(payload);
      if (!fin) return;
      const text = Buffer.concat(parts).toString('utf8');
      parts = [];
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      conn.onMessage(msg);
    }
  });
  socket.on('data', (chunk) => {
    try {
      parse(chunk);
    } catch {
      socket.destroy();
    }
  });
  const gone = () => {
    if (!open) return;
    open = false;
    conn.onClose();
  };
  socket.on('close', gone);
  socket.on('error', gone);
  // Detect dead peers (browsers answer pings automatically).
  const ping = setInterval(() => open && socket.write(encodeFrame(0x9, Buffer.alloc(0))), 15000);
  socket.on('close', () => clearInterval(ping));
  return conn;
}
