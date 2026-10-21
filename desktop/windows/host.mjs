import path from 'node:path';
import { createInterface } from 'node:readline';
import { createApp } from '../../server.mjs';

// The launcher supplies paths outside the installation directory. Never write
// user files beside program binaries: updates/uninstall must leave them intact.
const storage = process.env.NEARBY_DATA_DIR;
const receivedDirectory = process.env.NEARBY_RECEIVE_DIR;
if (!storage || !receivedDirectory || !path.isAbsolute(storage) || !path.isAbsolute(receivedDirectory)) {
  throw new Error('Не заданы папки данных приложения. Запустите Nearby.exe.');
}
const app = await createApp({ port: 0, storage, receivedDirectory,
  statistics: process.env.NEARBY_DISABLE_STATISTICS === '1' ? false : { source: 'windows' } });
// One private handshake over stdout, consumed by the local launcher only.
console.log(JSON.stringify({ url: app.adminUrl, receivedDirectory: app.inbox }));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
}
process.stdin.resume();
createInterface({ input: process.stdin }).on('line', command => {
  if (command === 'prepare-update') console.log(JSON.stringify({ updateReady: app.prepareUpdate() }));
  else if (command === 'cancel-update') app.cancelUpdate();
  else stop().catch(() => { process.exitCode = 1; });
});
process.stdin.on('end', () => { stop().catch(() => { process.exitCode = 1; }); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
