# Blue Fish Agent Room · 小肥鱼的房间

本地运行的 Three.js / VRM 3D Agent 房间 Demo。角色可行走、物理跳床、侧躺、拿放手机、坐到电脑旁；模型根据真实场景状态与动作结果逐步规划，支持持续目标、打断恢复与少量本地记忆。

## 运行

需要 Node.js 24 或更新版本，以及支持 WebGL 的桌面浏览器。

1. 运行 npm ci 安装锁定版本的依赖。
2. 将 .env.example 复制为 .env，填写 AVATAR_PATH，指向你有权使用的 VRM 文件。
3. 运行 npm run build，再运行 npm start。
4. 打开 http://127.0.0.1:4177。Windows 也可双击“启动房间.cmd”，通过“关闭房间.cmd”停止。

此源码导出不含角色模型、密钥、本地配置、聊天记录、诊断截图或构建产物。public/assets/room.glb 是房间资源；角色由本机路径只读加载，不上传到模型服务。只有明确启用视觉输入时，虚拟角色相机截图才会发送到你配置的服务。

## 模型与动作

在“模型连接设置”填写 OpenAI 兼容 Chat Completions 接口、实际模型 ID 和 API Key。支持本机回环 HTTP 和公网 HTTPS；DeepSeek 官方 HTTPS 地址兼容代理 Fake-IP。密钥留在当前 Node 服务内存中；需要跨重启保存时由使用者自行填写私有 .env。

统一动作包含 move、look、wave、point、lamp、jump、wait、lie、stand、phone、sit。技能提供执行条件、完成信号、失败码和中断约定，GET /api/skills 可查看协议。技能和记忆细节见 [SKILLS.md](SKILLS.md)。

示例：“先侧躺，拿起手机看，再放回手机，坐到电脑旁。”临时打断后会根据当前状态继续原目标；“停止”取消待办，“继续”可恢复刷新前挂起的目标。

## Agent 联动

支持通用鉴权事件入口、DeepSeek Harness 事件观察插件，以及可配置的 QQ Agent 项目代理。详见 [AGENT-INTEGRATION.md](AGENT-INTEGRATION.md)。QQ 项目是独立可选依赖，不包含在此仓库中；请通过 ROOM_QQ_PROJECT 配置实际路径。Harness overlay 的相对插件路径按房间项目根目录运行解析，需要时改为实际绝对路径。

## 验证与开发

- npm run check：JavaScript 语法检查。
- npm test：动作、几何、HTTP、网络边界、中断和记忆测试；不需要 VRM。
- npm run build：生产构建与 Brotli 静态资源，不生成 sourcemap。
- npm run build:debug：显式生成调试映射。
- scripts/qa*.mjs：本机真实浏览器检查；需自行提供 VRM，默认使用 Windows Edge。QQ 联动检查需另行配置独立项目；--local 模式仅用于明确匹配的本地模型环境。

房间通过 Rapier 胶囊控制器处理跳跃碰撞，骨骼姿势及手机 IK 为当前参考角色校准。换用其他比例的 VRM 通常需要重新校准；未实现完整衣物/头发/尾巴软体碰撞或通用物件抓取。直接房间指令的最终状态校验是有限语法，不是任意自然语言目标的通用语义证明。

## 资源与许可

请使用自有或取得相应许可的模型。第三方依赖及资源说明见 [THIRD-PARTY.md](THIRD-PARTY.md)。此导出没有为全部源码另行指定统一开源许可证。
