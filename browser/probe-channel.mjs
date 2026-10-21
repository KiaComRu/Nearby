// Hold the peer's initial protocol hello until both endpoints agree on a transport.
// A data channel can open before the other browser receives its next HTTP poll.
export class ProbeChannel extends EventTarget {
  constructor(channel) {
    super(); this.channel = channel; this.pending = []; this.bytes = 0; this.active = false;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('message', event => {
      if (this.active) { this.dispatchEvent(new MessageEvent('message', { data: event.data })); return; }
      this.bytes += typeof event.data === 'string' ? new TextEncoder().encode(event.data).length : event.data.byteLength;
      if (!Number.isFinite(this.bytes) || this.bytes > 65536 || this.pending.length >= 4) { channel.close(); return; }
      this.pending.push(event.data);
    });
    for (const type of ['open', 'close', 'error', 'bufferedamountlow']) channel.addEventListener(type, () => this.dispatchEvent(new Event(type)));
  }
  activate() {
    this.active = true;
    for (const data of this.pending.splice(0)) this.dispatchEvent(new MessageEvent('message', { data }));
    this.bytes = 0;
  }
  get readyState() { return this.channel.readyState; }
  get bufferedAmount() { return this.channel.bufferedAmount; }
  set binaryType(value) { this.channel.binaryType = value; }
  set bufferedAmountLowThreshold(value) { this.channel.bufferedAmountLowThreshold = value; }
  send(data) { this.channel.send(data); }
  close() { this.pending = []; this.channel.close(); }
}
