import { EventEmitter } from 'node:events';
export function discoveryBus() {
  const sockets = new Set(), packets = [];
  return {
    sockets, packets,
    createSocket() {
      const socket = new EventEmitter(); socket.addressValue = '127.0.0.1';
      socket.bind = (_port, _address, callback) => { sockets.add(socket); queueMicrotask(callback); };
      socket.addMembership = () => {}; socket.dropMembership = () => {};
      socket.setMulticastTTL = () => {}; socket.setMulticastLoopback = () => {};
      socket.setMulticastInterface = address => { socket.addressValue = address; };
      socket.unref = () => {};
      socket.close = () => { sockets.delete(socket); };
      socket.send = (bytes, _port, _group, callback) => {
        packets.push(bytes.toString());
        for (const recipient of sockets) recipient.emit('message', Buffer.from(bytes), { address: socket.addressValue });
        callback();
      };
      return socket;
    },
  };
}
