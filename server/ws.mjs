/**
 * WebSockets, from Node's standard library and nothing else.
 *
 * The server is meant to be started with `node server/server.mjs` on whatever
 * machine somebody has — a laptop, a Raspberry Pi, a free cloud box — and the
 * whole of the game's "no install" promise rests on that being true for the
 * server as well as the page. `npm install ws` is one command, but it is one
 * command on a machine that may not have npm, behind a proxy that may not
 * reach the registry, and it is the difference between a server that is a
 * folder and a server that is a folder plus a dependency tree.
 *
 * So this is RFC 6455 for one kind of peer — browsers, and Node's own client
 * in the tests — and it does the parts of the protocol that peer actually
 * sends: masked frames, text and binary, fragmentation, ping/pong and the
 * closing handshake. No extensions are negotiated, so a frame with a reserved
 * bit set is a protocol error rather than something to decompress.
 *
 * Every message is limited in size before it is buffered, and a client that
 * stops reading is cut loose rather than allowed to queue the server's memory
 * away behind it.
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

/** The fixed string every handshake hashes against. RFC 6455 section 1.3. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * The biggest message a client may send, in bytes.
 *
 * Nothing a player sends is large: a position is a hundred bytes and a chat
 * line is capped at a few hundred. The largest legitimate thing is a voice
 * offer — a WebRTC session description is a few kilobytes, ten at the outside
 * with every candidate inlined — so this is several times that, and a client
 * sending more is not a client this server was written for.
 */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/**
 * How much may be waiting to go out to one client before it is dropped.
 *
 * A browser tab that is backgrounded, or a phone that walked out of wifi
 * range, stops reading while the server keeps writing positions to it. Without
 * a ceiling those writes pile up in the socket's buffer for as long as the TCP
 * connection takes to notice — minutes — and one stalled player becomes the
 * server's whole heap. Two megabytes is a few seconds of everything at once.
 */
export const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

const OPCODES = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa };

/** The answer a server has to give for a client's handshake key. */
export function acceptKey(key) {
  return createHash('sha1').update(String(key) + GUID).digest('base64');
}

/**
 * Turn an HTTP upgrade request into a WebSocket, or refuse it.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:stream').Duplex} socket
 * @param {Buffer} head bytes that arrived after the request headers
 * @returns {WebSocket|null}
 */
export function upgrade(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  const upgradeHeader = String(req.headers.upgrade ?? '').toLowerCase();
  if (req.method !== 'GET' || upgradeHeader !== 'websocket' || !key || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
    refuse(socket, 400, 'Bad Request');
    return null;
  }
  if (version !== '13') {
    // The one version every browser has spoken since 2011. Saying which we
    // want is part of the protocol, not politeness.
    socket.end('HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n');
    return null;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  const ws = new WebSocket(socket);
  if (head && head.length) ws.receive(head);
  return ws;
}

/** Answer an upgrade we will not take with an ordinary HTTP status. */
export function refuse(socket, status, text) {
  try {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    /* already gone */
  }
}

/** One open connection, server side. */
export class WebSocket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    /** OPEN until a close frame has been sent or received, then CLOSING, then CLOSED. */
    this.state = 'OPEN';
    this.pending = Buffer.alloc(0);
    /** A fragmented message being put back together: its opcode and parts. */
    this.fragments = null;
    this.fragmentBytes = 0;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.closeCode = 1006;
    this.closeReason = '';
    this.lastSeen = Date.now();

    socket.setNoDelay?.(true);
    socket.on('data', (chunk) => this.receive(chunk));
    socket.on('error', () => this.finish());
    socket.on('close', () => this.finish());
    socket.on('end', () => this.finish());
  }


  /** Bytes queued for this client that the network has not taken yet. */
  get bufferedAmount() {
    return this.socket.writableLength ?? 0;
  }

  get open() {
    return this.state === 'OPEN';
  }

  /** Feed raw bytes from the socket through the frame parser. */
  receive(chunk) {
    if (this.state === 'CLOSED') return;
    this.lastSeen = Date.now();
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    try {
      while (this.state !== 'CLOSED' && this.parseFrame()) {
        /* one frame per pass */
      }
    } catch (error) {
      if (typeof error.code === 'number') {
        this.fail(error.code, error.message);
      } else {
        // Not the client's fault: something listening to 'message' threw. The
        // connection is closed as a server error so the client reconnects,
        // rather than left half-processed.
        console.error('[ws] message handler threw', error);
        this.fail(1011, 'server error');
      }
    }
  }

  /**
   * Take one whole frame off the front of the buffer, if there is one.
   * Returns false when what is buffered is not yet a complete frame.
   */
  parseFrame() {
    const buf = this.pending;
    if (buf.length < 2) return false;
    const fin = (buf[0] & 0x80) !== 0;
    const rsv = buf[0] & 0x70;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;

    if (rsv !== 0) throw protocolError(1002, 'reserved bits set without an extension');
    // RFC 6455 5.1: a client MUST mask what it sends, and a server MUST close
    // the connection on an unmasked frame. It is what stops a page from
    // writing chosen bytes onto the wire past a confused proxy.
    if (!masked) throw protocolError(1002, 'client frames must be masked');

    if (length === 126) {
      if (buf.length < offset + 2) return false;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return false;
      const high = buf.readUInt32BE(offset);
      const low = buf.readUInt32BE(offset + 4);
      // Anything with the high word set is past every limit this server has,
      // so it never needs the full 64-bit arithmetic.
      if (high !== 0) throw protocolError(1009, 'message too big');
      length = low;
      offset += 8;
    }

    const control = opcode >= 0x8;
    if (control && (length > 125 || !fin)) throw protocolError(1002, 'malformed control frame');
    if (!control && length + this.fragmentBytes > MAX_MESSAGE_BYTES) {
      throw protocolError(1009, 'message too big');
    }

    if (buf.length < offset + 4 + length) return false;
    const mask = buf.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(buf.subarray(offset, offset + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.pending = buf.subarray(offset + length);

    switch (opcode) {
      case OPCODES.text:
      case OPCODES.binary:
        if (this.fragments) throw protocolError(1002, 'new message inside a fragmented one');
        if (fin) this.deliver(opcode, payload);
        else {
          this.fragments = { opcode, parts: [payload] };
          this.fragmentBytes = payload.length;
        }
        break;
      case OPCODES.continuation:
        if (!this.fragments) throw protocolError(1002, 'continuation with nothing to continue');
        this.fragments.parts.push(payload);
        this.fragmentBytes += payload.length;
        if (fin) {
          const { opcode: first, parts } = this.fragments;
          this.fragments = null;
          this.fragmentBytes = 0;
          this.deliver(first, Buffer.concat(parts));
        }
        break;
      case OPCODES.ping:
        this.writeFrame(OPCODES.pong, payload);
        break;
      case OPCODES.pong:
        this.emit('pong', payload);
        break;
      case OPCODES.close:
        this.onCloseFrame(payload);
        break;
      default:
        throw protocolError(1002, `unknown opcode ${opcode}`);
    }
    return true;
  }

  deliver(opcode, payload) {
    if (opcode === OPCODES.text) {
      let text;
      try {
        text = this.decoder.decode(payload);
      } catch {
        throw protocolError(1007, 'text frame is not UTF-8');
      }
      this.emit('message', text, false);
    } else {
      this.emit('message', payload, true);
    }
  }

  onCloseFrame(payload) {
    let code = 1005;
    let reason = '';
    if (payload.length === 1) throw protocolError(1002, 'one-byte close payload');
    if (payload.length >= 2) {
      code = payload.readUInt16BE(0);
      try {
        reason = this.decoder.decode(payload.subarray(2));
      } catch {
        throw protocolError(1007, 'close reason is not UTF-8');
      }
    }
    this.closeCode = code;
    this.closeReason = reason;
    if (this.state === 'OPEN') {
      // Answer in kind: echo the code, then hang up. The client is waiting
      // for exactly this before it calls the connection clean.
      this.state = 'CLOSING';
      const echo = Buffer.alloc(code === 1005 ? 0 : 2);
      if (echo.length) echo.writeUInt16BE(code, 0);
      this.writeFrame(OPCODES.close, echo);
    }
    this.socket.end();
  }

  /** Send a string (as text) or a Buffer (as binary). Returns false if dropped. */
  send(data) {
    if (this.state !== 'OPEN') return false;
    if (this.bufferedAmount > MAX_BUFFERED_BYTES) {
      // Not reading. Better to lose this one client than everybody's memory.
      this.terminate();
      return false;
    }
    const binary = Buffer.isBuffer(data) || data instanceof Uint8Array;
    const payload = binary ? Buffer.from(data) : Buffer.from(String(data), 'utf8');
    return this.writeFrame(binary ? OPCODES.binary : OPCODES.text, payload);
  }

  ping(data = Buffer.alloc(0)) {
    if (this.state !== 'OPEN') return;
    this.writeFrame(OPCODES.ping, Buffer.from(data));
  }

  /** Start the closing handshake. */
  close(code = 1000, reason = '') {
    if (this.state !== 'OPEN') return;
    this.state = 'CLOSING';
    this.closeCode = code;
    this.closeReason = reason;
    const text = Buffer.from(String(reason).slice(0, 120), 'utf8');
    const payload = Buffer.alloc(2 + text.length);
    payload.writeUInt16BE(code, 0);
    text.copy(payload, 2);
    this.writeFrame(OPCODES.close, payload);
    // A client that never answers the close does not get to hold the socket.
    this.closeTimer = setTimeout(() => this.terminate(), 3000);
    this.closeTimer.unref?.();
  }

  /** Drop the connection without a handshake. */
  terminate() {
    try {
      this.socket.destroy();
    } catch {
      /* already gone */
    }
    this.finish();
  }

  fail(code, reason) {
    if (this.state === 'OPEN') this.close(code, reason);
    this.socket.end();
  }

  finish() {
    if (this.state === 'CLOSED') return;
    this.state = 'CLOSED';
    clearTimeout(this.closeTimer);
    this.emit('close', this.closeCode, this.closeReason);
  }

  writeFrame(opcode, payload) {
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeUInt32BE(Math.floor(length / 2 ** 32), 2);
      header.writeUInt32BE(length >>> 0, 6);
    }
    // Server frames are never masked (RFC 6455 5.1), and are always whole.
    header[0] = 0x80 | opcode;
    try {
      return this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.finish();
      return false;
    }
  }
}

function protocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}