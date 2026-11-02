import {build} from 'esbuild';
import {mkdir,cp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {brotliCompressSync,constants} from 'node:zlib';
await mkdir('dist',{recursive:true});
const debug=process.argv.includes('--debug');
if(!debug)for(const file of ['dist/main.js.map','dist/main.css.map'])await rm(file,{force:true});
await build({entryPoints:['src/main.js'],bundle:true,format:'esm',target:'es2022',outdir:'dist',minify:true,sourcemap:debug,loader:{'.css':'css'}});
await cp('public','dist',{recursive:true});
await writeFile('dist/index.html',await readFile('src/index.html'));
async function compress(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=dir+'/'+entry.name;if(entry.isDirectory())await compress(file);else if(/\.(?:js|css|html|glb|json|svg)$/.test(file)){const source=await readFile(file);if(source.length>1024)await writeFile(file+'.br',brotliCompressSync(source,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}));}}}
await compress('dist');
console.log('Built dist/');
