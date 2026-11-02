# 联动 QQ Agent、DeepSeek Harness 和其他 Agent

房间负责呈现 Agent 的实际工作状态。模型、历史、工具授权和命令执行继续由接入的 Agent 负责。

房间内部现已统一技能调度：QQ/Harness 消息投影、手动按钮和房间模型都调用同一套躺卧、起身、手机拿放与电脑坐姿技能。外部任务会暂时挂起房间原目标，结束并安全收尾后恢复；重复状态不会反复打断。`GET /api/skills` 提供条件、完成信号、失败码、中断约定与 JSON Schema；实际状态、近期事件及未完成任务会进入房间模型的下一轮观察。详见 [SKILLS.md](SKILLS.md)。

| 真实状态 | 房间中的表现 |
| --- | --- |
| 空闲 | 上床后侧躺休息 |
| 收到新任务、正在回复 | 伸手拿起床上原有的手机，侧躺看手机 |
| 普通聊天完成 | 显示公开回复，将手机放回床上 |
| 调用命令、浏览器或电脑工具 | 先放下手机，再坐到靠电脑的床脚转角，面向桌上的电脑 |
| 电脑任务结束或取消 | 停留片刻，回到侧躺休息 |

这是程序化骨骼、手臂 IK 和姿势过渡的演示，不是学习到的通用动作模型。快速回复会有短暂的动画延迟，让拿起和放下动作完整可见。头发使用床面弹簧碰撞平面，尾部增加运行时变形骨骼；没有保存或修改原始 VRM。手机是场景里原有的同一个模型，不会生成第二部手机。姿势为当前角色和床铺校准，其他模型需要重新调节。

## QQ 项目：直接使用

1. 在房间目录双击 **重启房间.cmd**，然后重启 `C:\path\to\qq-ai-bot-web`，加载新增后端接口。
2. 打开 QQ 项目管理页面，进入 Agent 的网页试聊，在输入框上方点击 **3D 房间**。
3. 新开的房间会跟随这个网页试聊会话。在原项目发消息，或在房间输入框发消息，都会交给同一个 QQ Agent 处理。
4. 房间的 **床边** 相机方便观察姿势；“床上姿势”中的三个按钮可独立预览。点击手动动作会断开联动并从床上起身。

房间服务从 QQ 项目的本地 `.env` 读取管理端口和 `ADMIN_ACCESS_TOKEN`，只在服务端使用。浏览器不接收该密钥。默认项目路径已指向本机目录；更换目录或端口时，在房间 `.env` 中配置：

```dotenv
ROOM_QQ_PROJECT=C:/path/to/qq-ai-bot-web
# 可选：覆盖项目中的端口，只允许本机地址
# ROOM_QQ_BASE_URL=http://127.0.0.1:5700
```

投影接口只查询当前 `web:<UUID>` 会话的任务状态、工具名称和完成后的公开回复，不包含工具参数、结果、私密推理或其他会话。网页试聊原有的时间、记忆等工具权限没有扩展；它不会因为房间联动就获得命令执行能力。需要操作电脑时，让原 Agent 自身提供并授权相应工具。房间只跟随实际调用记录，不能仅凭消息里写“运行命令”就执行命令。

## DeepSeek Harness

已提供 JavaScript 事件观察插件和 overlay，按官方 `session/event` 接口接收真实事件。插件不阻塞 Agent 执行；房间未启动时会跳过发送并限频提示。

1. 启动房间服务。
2. 将 [`adapters/deepseek-room.patch.yml`](adapters/deepseek-room.patch.yml) 作为 Harness overlay 加载。例如已安装 CLI 时：

```powershell
dsh web --patch C:/path/to/blue-fish-agent-room/adapters/deepseek-room.patch.yml
```

   如果从 Harness 源码启动，使用项目支持的 `pnpm dsh web --patch <上述路径>`。其他插件及模型配置仍由你原本的 Harness 配置提供。
3. 打开 [Harness 联动房间](http://127.0.0.1:4177/?source=external&session=deepseek-room)，在 Harness 中发起任务。

默认只绑定插件看到的第一个实时 Harness 会话，忽略历史重放；多会话时在 overlay 的 `sessionId` 中填写要观察的会话 ID，然后重载插件。`roomSession` 必须和房间地址中的 `session` 一致。密钥从房间 `.local/bridge-token.txt` 自动读取，不需要粘贴到前端。

映射：`turn/start` → 拿手机；`tool/call` → 按真实工具名判断电脑任务；`assistant/message` → 只保留公开文本块；`turn/end` → 完成、取消或失败。未转发工具参数、工具结果或 reasoning 块。适配器已用官方事件信封做契约测试，本机尚未运行真实 Harness 实例。

官方参考：[事件系统](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/events)、[插件启动与 overlay](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)。

## 其他 Agent：HTTP 事件接口

向 `http://127.0.0.1:4177/api/bridge/events` 发送 JSON，并用 `Authorization: Bearer <本地 .local/bridge-token.txt 的内容>` 鉴权。每个任务使用独立 `runId`，同一房间使用固定 `session`：

```javascript
import {readFile} from 'node:fs/promises';
const token=(await readFile('C:/path/to/blue-fish-agent-room/.local/bridge-token.txt','utf8')).trim();
async function roomEvent(runId,type,extra={}) {
  await fetch('http://127.0.0.1:4177/api/bridge/events',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify({session:'my-agent',runId,type,...extra})
  });
}
// 将这些调用放在 Agent 自身的生命周期回调中。
await roomEvent('task-001','message_received');
// 只有真实开始调用工具时发送：
await roomEvent('task-001','tool_started',{tool:'exec_command',activity:'computer'});
await roomEvent('task-001','tool_completed',{tool:'exec_command'});
await roomEvent('task-001','reply_complete',{text:'公开回复'});
```

房间打开 `http://127.0.0.1:4177/?source=external&session=my-agent`。也可发送 `response_started`、`run_complete`、`run_failed`、`run_cancelled`。工具名不在内置识别范围时，真实电脑工具可显式携带 `activity:'computer'`。事件入口只改变表现状态，不运行其携带的任何命令或代码。结束后的重复/迟到事件不会重新唤醒同一任务；崩溃后未结束的外部任务五分钟自动失效。适配器应在 Agent 侧做非阻塞发送和超时处理。

## 验证范围

浏览器集成测试使用 QQ 项目的真实后端、隔离数据目录和模拟模型，覆盖房间输入及原项目聊天入口、手机拿放、真实工具 trace 切换、外部事件鉴权、返回休息与手机屏幕无横向溢出。命令 fixture 实际执行 `node -p 1+1` 得到 `2`，仅在测试实例注入工具；没有改动生产网页工具权限，也未发送 QQ 消息。真实用户模型、真实 Harness 进程和其他 Agent 的具体工具尚需各自在本地配置。
