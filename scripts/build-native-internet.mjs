import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
await build({entryPoints:[fileURLToPath(new URL('desktop/internet-client.mjs',root))],outfile:fileURLToPath(new URL('public/native-internet.js',root)),bundle:true,format:'iife',globalName:'NearbyInternet',platform:'browser',target:'es2022',minify:true,legalComments:'inline'});
