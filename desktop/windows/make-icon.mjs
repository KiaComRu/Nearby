import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Code-native brand mark: an arrow on a green square, packed as a 32-bit DIB.
const size = 64, scale = 4;
const dib = Buffer.alloc(40 + size * size * 4 + size * (size / 8));
dib.writeUInt32LE(40, 0); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8);
dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(size * size * 4, 20);
const segments = [[19, 45, 45, 19], [24, 19, 45, 19], [45, 19, 45, 40]];
function distance(x, y, [x1, y1, x2, y2]) {
  const t = Math.max(0, Math.min(1, ((x-x1)*(x2-x1)+(y-y1)*(y2-y1))/((x2-x1)**2+(y2-y1)**2)));
  return Math.hypot(x-x1-t*(x2-x1), y-y1-t*(y2-y1));
}
for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
  let coverage=0;
  for (let dy=0; dy<scale; dy++) for (let dx=0; dx<scale; dx++) {
    if (segments.some(segment => distance(x+(dx+.5)/scale, y+(dy+.5)/scale, segment) < 3)) coverage++;
  }
  const a=coverage/(scale*scale), index=40+((size-1-y)*size+x)*4;
  dib[index]=Math.round(74*(1-a)+191*a); dib[index+1]=Math.round(100*(1-a)+244*a);
  dib[index+2]=Math.round(40*(1-a)+217*a); dib[index+3]=255;
}
const header=Buffer.alloc(22); header.writeUInt16LE(1,2); header.writeUInt16LE(1,4);
header[6]=size; header[7]=size; header.writeUInt16LE(1,10); header.writeUInt16LE(32,12);
header.writeUInt32LE(dib.length,14); header.writeUInt32LE(header.length,18);
const target=path.resolve(process.argv[2]); await mkdir(path.dirname(target),{recursive:true});
await writeFile(target,Buffer.concat([header,dib]));
