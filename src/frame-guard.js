export class FrameGuard{
  constructor(){this.error=null;}
  reset(){this.error=null;}
  run(update,onError){
    if(this.error)return false;
    try{update();return true;}catch(error){this.error=error;onError(error);return false;}
  }
}
