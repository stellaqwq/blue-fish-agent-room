export const bedSkills=['lie','stand','phone','sit'];
// These contracts are sent to the planner as well as used by the executor.
export const SKILLS={
  move:{conditions:'可通行的地面目标；自动放手机、起身及下床。',completion:'实际到达目标且仍在可通行地面。',failures:['blocked','timeout','verification_failed'],interrupt:'停止行走并保存未完成目标。'},
  jump:{conditions:'支撑面明确；自动起身并接近床边。',completion:'物理碰撞确认目标支撑面并完成落地缓冲。',failures:['blocked','jump_failed'],interrupt:'取消后续动作，完成实际落地。'},
  lie:{conditions:'已在床上；可自动走近、跳上床，放回手机。',completion:'Director 侧躺稳定且实际根变换匹配床上躺姿，手机在床上。',failures:['director_unavailable','phone_unreachable','timeout','verification_failed'],interrupt:'保留当前过渡，放好手机后可起身。'},
  stand:{conditions:'角色未在空中；可自动放回手机。',completion:'实际恢复直立，Director 交还控制，手机在床上。',failures:['phone_unreachable','timeout','verification_failed'],interrupt:'安全结束当前过渡后接受下一个动作。'},
  phone:{conditions:'operation=pick/put；pick 自动上床侧躺，put 要求手机在手或已在床上。',completion:'pick：真实接触后手机归手且抬起完成；put：手机回到原位且脱离手。',failures:['phone_unavailable','phone_unreachable','timeout','verification_failed'],interrupt:'完成接触中的拿放，再按新目标安全放回。'},
  sit:{conditions:'target=computer；自动上床，先放手机。',completion:'在用户选定床角稳定坐姿，实际位置与朝向匹配电脑坐姿。',failures:['director_unavailable','phone_unreachable','timeout','verification_failed'],interrupt:'从当前姿势起身或转为新姿势。'},
  lamp:{conditions:'先到台灯附近的地面停靠点。',completion:'真实 lampOn 与 enabled 相等。',failures:['out_of_reach','preference_conflict','verification_failed'],interrupt:'即时状态操作；不回滚已生效的灯光。'},
  look:{conditions:'存在的观察目标；自动起身。',completion:'达到朝向并保持指定时长。',failures:['verification_failed'],interrupt:'停止保持朝向。'},
  wave:{conditions:'自动放手机并起身。',completion:'挥手动作执行指定时长。',failures:['verification_failed'],interrupt:'结束手势。'},
  point:{conditions:'存在的目标，自动放手机并起身。',completion:'指向动作执行指定时长。',failures:['verification_failed'],interrupt:'结束手势。'},
  wait:{conditions:'duration 0.5–6秒，可保留侧躺或手机姿势。',completion:'未暂停的模拟时间达到时长。',failures:['interrupted'],interrupt:'立即结束等待。'},
  remember:{conditions:'仅当前用户明确要求记住的白名单偏好；自主活动不可写。',completion:'本地偏好值已更新。',failures:['preference_not_requested','invalid_preference'],interrupt:'即时写入。'},
  resume:{conditions:'有挂起或失败的未完成任务。',completion:'选择最近未完成任务，依据当前观察重新规划。',failures:['no_unfinished_task'],interrupt:'与普通目标相同。'},
  finish:{conditions:'outcome=success/failed；先检查 goalStatus.met，有未解决动作失败时不能声称成功。',completion:'已知最终状态条件由真实状态满足，记录结果后恢复挂起目标。',failures:['goal_not_met','unresolved_failure'],interrupt:'即时记录。'}
};
export function verifySkill(action,agent){
  const d=agent.director,w=agent.world,p=agent.avatar.root.position,mode=d?.stable,stable=d&&!d.transition&&!d.phoneMotion;
  const upright=Math.abs(agent.avatar.root.rotation.x)<.02&&Math.abs(agent.avatar.root.rotation.z)<.02;
  const phone=w.phone,owner=phone?.owner,homeDistance=phone?.group?.position.distanceTo(phone.home)??Infinity;
  const evidence={support:agent.support,posture:d?.transition?'transition':mode||'stand',phone:owner||'unavailable',lampOn:w.lampOn};
  let ok=false;
  if(action.type==='lamp')ok=w.lampOn===action.enabled;
  else if(action.type==='move'){const target=action.point?{position:[action.point.x,0,action.point.z]}:w.targets[action.target];ok=agent.support==='floor'&&w.nav.free(p)&&Math.hypot(p.x-target.position[0],p.z-target.position[2])<.04;}
  else if(action.type==='jump'){evidence.grounded=action.motor?.grounded??true;ok=agent.support===action.target&&upright&&evidence.grounded;}
  else if(action.type==='stand')ok=upright&&!agent.presentation&&!d?.controlled&&(!phone||owner==='bed');
  else if(action.type==='lie'||action.type==='sit'){
    const expected=d?.poseFor(action.type);ok=Boolean(stable&&mode===action.type&&agent.support==='bed'&&owner==='bed'&&p.distanceTo(expected.position)<.025&&agent.avatar.root.quaternion.angleTo(expected.quaternion)<.04);
  }else if(action.type==='phone'){
    if(action.operation==='put')ok=Boolean(owner==='bed'&&!d?.held&&!d?.phoneMotion&&homeDistance<.035);
    else{const hand=agent.avatar.bones.rightHand?.getWorldPosition(p.clone());evidence.gripDistance=hand?phone?.group.position.distanceTo(hand):null;ok=Boolean(stable&&mode==='lie'&&d.held&&owner==='hand'&&evidence.gripDistance<.16);}
  }else if(action.type==='look'){const t=w.targets[action.target].look,yaw=Math.atan2(t[0]-p.x,t[2]-p.z);ok=action.elapsed>=action.duration&&Math.abs(Math.atan2(Math.sin(yaw-agent.avatar.root.rotation.y),Math.cos(yaw-agent.avatar.root.rotation.y)))<.15;}
  else if(['wave','point','wait'].includes(action.type)){evidence.elapsed=action.elapsed;ok=action.elapsed>=action.duration;}
  else if(action.type==='remember')ok=agent.memory.preferences[action.key]===action.value;
  else ok=true;
  return {ok,evidence};
}
