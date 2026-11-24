import { EventEmitter } from 'node:events';
export function discoveryBus({ dropMulticast = false } = {}) {
  const sockets = new Set(), packets = [];
  return {
    sockets, packets,
    createSocket() {
      const socket = new EventEmitter(); socket.addressValue = '127.0.0.1';
      socket.bind = (port, address, callback) => { socket.port = port; socket.addressValue = address; sockets.add(socket); queueMicrotask(callback); };
      socket.addMembership = () => {}; socket.dropMembership = () => {};
      socket.setMulticastTTL = () => {}; socket.setMulticastLoopback = () => {};
      socket.setBroadcast = () => {}; socket.setTTL = () => {};
      socket.setMulticastInterface = address => { socket.addressValue = address; };
      socket.unref = () => {};
      socket.close = () => { sockets.delete(socket); };
      socket.send = (bytes, port, destination, callback) => {
        packets.push(bytes.toString());
        if (!dropMulticast || destination !== '239.255.53.17') {
          for (const recipient of sockets) if (recipient.port === port) recipient.emit('message', Buffer.from(bytes), { address: socket.addressValue });
        }
        callback();
      };
      return socket;
    },
  };
}
