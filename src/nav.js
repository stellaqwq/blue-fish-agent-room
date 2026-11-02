import {ROOM_BOUNDS} from './room-layout.js';

export class Navigation {
  constructor(obstacles, radius = .87, step = .045) {
    this.obstacles = obstacles;
    this.radius = radius;
    this.step = step;
    const margin=radius+.02;
    this.bounds = {minX:ROOM_BOUNDS.minX+margin,maxX:ROOM_BOUNDS.maxX-margin,minZ:ROOM_BOUNDS.minZ+margin,maxZ:ROOM_BOUNDS.maxZ-margin};
  }
  free(p) {
    const b=this.bounds,r=this.radius;
    return p.x>=b.minX && p.x<=b.maxX && p.z>=b.minZ && p.z<=b.maxZ &&
      !this.obstacles.some(o=>p.x>o.minX-r && p.x<o.maxX+r && p.z>o.minZ-r && p.z<o.maxZ+r);
  }
  clear(a,b) {
    const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.018));
    for(let i=0;i<=n;i++) if(!this.free({x:a.x+(b.x-a.x)*i/n,z:a.z+(b.z-a.z)*i/n}))return false;
    return true;
  }
  route(start,end) {
    if(!this.free(start)||!this.free(end))throw new Error('目标位置没有足够的通行空间。');
    if(this.clear(start,end))return [{x:end.x,z:end.z}];
    const s=this.step,b=this.bounds;
    const pt=(x,z)=>({x:b.minX+x*s,z:b.minZ+z*s});
    const cell=p=>[Math.round((p.x-b.minX)/s),Math.round((p.z-b.minZ)/s)];
    const key=(x,z)=>x+','+z;
    const nearby=p=>{
      const [x,z]=cell(p),out=[];
      for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
        const q=pt(x+dx,z+dz);
        if(this.clear(p,q))out.push({x:x+dx,z:z+dz,d:Math.hypot(q.x-p.x,q.z-p.z)});
      }
      out.sort((a,b)=>a.d-b.d);
      return out[0];
    };
    const a=nearby(start),e=nearby(end);
    if(!a||!e)throw new Error('无法连接到可行走区域。');
    const goal=key(e.x,e.z),first=key(a.x,a.z);
    const open=[{...a,g:0,f:0,k:first}],cost=new Map([[first,0]]),prev=new Map(),closed=new Set();
    let found=false;
    for(let iter=0;open.length&&iter<14000;iter++){
      let best=0;for(let i=1;i<open.length;i++)if(open[i].f<open[best].f)best=i;
      const n=open.splice(best,1)[0];
      if(closed.has(n.k))continue;
      if(n.k===goal){found=true;break;}
      closed.add(n.k);
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
        if(!dx&&!dz)continue;
        const x=n.x+dx,z=n.z+dz,k=key(x,z),p=pt(x,z);
        if(closed.has(k)||!this.clear(pt(n.x,n.z),p))continue;
        const g=n.g+Math.hypot(dx,dz);
        if(g>=(cost.get(k)??Infinity))continue;
        cost.set(k,g);prev.set(k,n.k);
        open.push({x,z,k,g,f:g+Math.hypot(x-e.x,z-e.z)});
      }
    }
    if(!found)throw new Error('家具挡住了路线，请换个位置。');
    const path=[{x:end.x,z:end.z}];
    for(let k=goal;k;k=prev.get(k)){const [x,z]=k.split(',').map(Number);path.unshift(pt(x,z));if(k===first)break;}
    const simple=[];let anchor=start;
    for(let i=0;i<path.length;){let next=i;for(let j=i+1;j<path.length;j++){if(!this.clear(anchor,path[j]))break;next=j;}simple.push(path[next]);anchor=path[next];i=next+1;}
    return simple;
  }
}
