// JSON messages over a WebSocket to the LAN server (server.mjs, path /ws). Messages that arrive between
// frames are queued and read with `drain()`, so game code handles them at a known point in the frame.

export type Msg = { t: string } & Record<string, unknown>;

export class Socket {
  private readonly ws: WebSocket;
  private readonly inbox: Msg[] = [];
  state: 'connecting' | 'open' | 'closed' = 'connecting';

  constructor(first: Msg) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.state = 'open';
      this.send(first);
    };
    this.ws.onmessage = (e) => {
      try {
        this.inbox.push(JSON.parse(String(e.data)) as Msg);
      } catch {
        // ignore malformed messages
      }
    };
    this.ws.onclose = () => (this.state = 'closed');
    this.ws.onerror = () => (this.state = 'closed');
  }

  send(msg: Msg) {
    if (this.state === 'open') this.ws.send(JSON.stringify(msg));
  }

  drain() {
    return this.inbox.splice(0, this.inbox.length);
  }

  close() {
    this.state = 'closed';
    this.ws.close();
  }
}
