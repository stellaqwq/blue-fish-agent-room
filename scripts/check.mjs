import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for(const dir of ['.','src','scripts','tests','adapters'])for(const entry of await readdir(dir,{withFileTypes:true})){
  if(!entry.isFile()||! /\.(?:js|mjs)$/.test(entry.name))continue;
  const result=spawnSync(process.execPath,['--check',dir+'/'+entry.name],{encoding:'utf8',windowsHide:true});
  if(result.status){process.stderr.write(result.stderr);process.exit(result.status);}
}
console.log('JavaScript syntax checks passed.');
