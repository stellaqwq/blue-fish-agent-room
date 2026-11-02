---
name: "小肥鱼的房间"
description: "沿用蓝色夜景卧室的本地 3D 角色操作界面。"
colors:
  bg: "#080f1c"
  panel: "#101c2e"
  surface: "#17263b"
  text: "#edf5ff"
  secondary: "#aec4de"
  accent: "#8cd9e8"
  line: "#2a3d55"
  error: "#ffc6bd"
  field: "#0b1626"
  hover-surface: "#22384f"
  hover-line: "#688ca6"
  selected-surface: "#264454"
  selected-text: "#c9f5fb"
  accent-ink: "#0b2634"
typography:
  headline:
    fontFamily: "'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0.025em"
  title:
    fontFamily: "'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.6
  body:
    fontFamily: "'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: "'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  control: "8px"
  field: "7px"
  soft: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  field: "10px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-default-hover:
    backgroundColor: "{colors.hover-surface}"
  button-default-selected:
    backgroundColor: "{colors.selected-surface}"
    textColor: "{colors.selected-text}"
  button-transport:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "4px"
  button-send:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "6px"
    size: "32px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    padding: "0"
  camera-control:
    backgroundColor: "#101c2eeb"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "5px 11px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "10px"
  command-composer:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.field}"
    padding: "10px 50px 10px 10px"
  autonomy:
    backgroundColor: "#2d4057"
    rounded: "{rounded.soft}"
    height: "20px"
    width: "34px"
  speech:
    backgroundColor: "#101c2ef2"
    textColor: "{colors.text}"
    rounded: "{rounded.soft}"
    padding: "15px 18px"
  settings-disclosure:
    textColor: "{colors.secondary}"
    padding: "14px 0 0"
---

# Design System: 小肥鱼的房间

## Overview

**Creative North Star: "蓝色夜晚，慢慢来。"**

以用户已有的蓝色夜景卧室和实际 VRM 角色为视觉依据。三维场景占据主要空间，操作区以窄幅深蓝侧栏承接动作、指令、状态与连接设置。界面语气安静、直接，帮助用户观察角色和操作房间。

这是当前本地 demo 的可复用视觉约定，范围是已实现的操作界面。字体服务于中文小字号控件；不另设品牌展示字体，不把本地体验包装成营销页面。

**Key Characteristics:**
- 场景优先，控制区域保持紧凑。
- 深蓝分层，淡色文字，少量海水蓝强调。
- 状态、动作与输入使用直白的中文。
- 设置就地展开，日志与实际错误清楚可见。

## Colors

蓝色夜景延伸到界面，面板与字段靠明度差和细边界区分。颜色值以前置 tokens 为准。

### Primary

- **海水蓝**（`accent`）：当前模式、选中边框、状态点、发送按钮与键盘焦点。用于可操作状态，不铺满面板。
- **深海墨**（`accent-ink`）：海水蓝发送按钮上的图标。

### Neutral

- **夜幕底色**（`bg`）：页面和三维舞台的背景。
- **安静深蓝**（`panel`）：侧栏；同色透明版本用于画面上的按钮和话语浮层。
- **抬升蓝面**（`surface`）：常规动作按钮。
- **冷白文字**（`text`）：标题、正文与控件文字。
- **雾蓝文字**（`secondary`）：说明、分区标题、次要操作与记录。
- **蓝灰边界**（`line`）：表单描边、分隔线和默认按钮边框。
- **暗蓝字段**（`field`）：输入框与多行指令框。
- **悬停蓝面 / 悬停蓝灰**（`hover-surface`、`hover-line`）：常规按钮悬停背景与边框。
- **选中蓝面 / 选中浅蓝文字**（`selected-surface`、`selected-text`）：按下状态，例如当前相机视角与暂停。

错误使用独立的**浅珊瑚色**（`error`），用于日志、连接结果与活动状态点；同样保留具体错误文字。

**The Quiet Accent Rule.** 海水蓝承担状态、发送和焦点提示；三维房间仍是画面的主要色彩来源。

## Typography

全部文字沿用前置 tokens 中的中文系统无衬线字体栈。没有独立展示字体，也没有强制等宽字体。

### Hierarchy

- **Headline**：舞台标题使用 `headline`；手机缩小为（19px），移除字距。
- **Title**：角色名称使用 `title`；手机使用（20px）。
- **Body**：全局基准使用 `body`。
- **Label**：动作按钮、指令标签和自主活动标题主要使用 `label`。分区标题为（13px / 500），使用次要文字色；相机、连接与设置控件多为（12px）。
- **Caption**：说明、记录与底部操作提示使用 `caption` 一带的小字号。话语正文为（13px / 1.7）；时间与作者说明可用（10px），时间与性能数字启用 tabular numerals。

**The Readable Controls Rule.** 中文控件保留系统字体和明确标签，不能为了视觉风格将操作信息换成装饰字体或仅靠图标。

## Layout

桌面采用全高双列，左侧是可伸缩舞台，右侧控制栏宽（330px）。整体高度为（100dvh），舞台裁切内部内容，侧栏独立滚动。常规侧栏内边距为（26px 24px 20px），按钮网格两列，间距（8px）。主要分区以约（24px）的节奏分隔；输入与解释文字更紧凑。

宽度达到（1600px）时侧栏增至（360px），内边距增至（30px 28px）。宽度不超过（1050px）时侧栏为（300px），内边距为（22px 18px），相机切换移到标题下方。

宽度不超过（680px）时，舞台与控制区纵向排列，页面自然滚动。舞台高（67dvh），最低（480px）；控制区四周留（24px），动作网格改成三列。相机按钮、当前话语和恢复视角继续覆盖在舞台内，避免把操作挤进三维画面。

当前话语常驻舞台左下区域。默认关闭角色视角小窗；关闭时话语距舞台底部（64px），手机布局仍由这条规则决定。开启后小窗位于左下，话语向上让位：桌面距底部（206px），中等宽度（200px）；手机小窗距底部（152px），话语距底部（54px）。

**The Scene First Rule.** 保持场景为主要区域；新增设置先进入侧栏或就地展开区，不能把场景变成控制面板的背景缩略图。

## Elevation & Depth

以深蓝色调分层和细描边为主。侧栏与按钮不使用投影；舞台上的话语浮层使用柔和暗影，标题和底部提示使用文字阴影以适应三维背景。不要把这种局部可读性处理扩展成全局浮卡片语言。

### Shadow Vocabulary

- **话语暗影**（`0 8px 28px #02071245`）：分离话语与三维场景。
- **标题文字影**（`0 2px 10px #050b17`）：提高舞台标题的可读性。
- **底部文字影**（`0 2px 6px #000`）：保护舞台下方操作提示。

## Shapes

按钮是轻微圆角矩形，使用 `control`；字段使用 `field`，话语与开关外形使用 `soft`。常规描边为（1px），状态点与开关圆点是圆形。角色视角小窗是固定比例画面和标题条的组合，圆角为（9px），内部裁切。装饰形状让位于三维场景。

## Components

### Buttons

常规动作按钮使用抬升蓝面、冷白文字和蓝灰描边，最小高度（40px）。悬停改变背景和边框；按下状态用选中蓝面、海水蓝边框及选中浅蓝文字。按钮的常规状态过渡为（150ms）。

跳床操作复用常规按钮，在动作网格中独占一行（grid-column: 1 / -1），使用海水蓝文字和（#416b7a）边框。标签随位置在“跳上床”与“跳下床”间切换；跳跃期间显示“跳跃中…”并禁用，沿用现有禁用与焦点样式。

暂停、停止和重置使用透明背景的紧凑按钮，最小高度（34px）。连接入口是带下划线的文字按钮。发送是指令框右下角的方形海水蓝按钮，使用向上箭头和明确可访问名称。小型场景按钮、传输按钮和发送按钮按各自紧凑尺寸处理，不能宣称所有控件都达到（40px）。

全部按钮、输入与展开摘要使用海水蓝可见焦点环（2px），偏移（3px）。禁用按钮降低透明度至（0.5），使用等待光标。

### Camera Navigation

三个相邻按钮切换房间、跟随和角色视角。当前项通过 `aria-pressed` 表达；背景保持半透明深蓝，使用海水蓝边框提示选中。桌面最小高度（36px）；手机只缩小文字。角色视角首次进入空闲状态时朝向房内，拖动画面可转身。

### Inputs / Fields

字段使用暗蓝底、蓝灰描边和圆角，光标使用海水蓝。连接字段有显式标签；帮助、连接结果和错误留在字段附近。指令框可垂直调整高度，范围（86–150px），右侧给发送按钮留空间。Enter 提交，Shift+Enter 换行；中文输入法组合输入期间不提交。

### Autonomy Switch

自主活动使用文字标签与解释，右侧是（34 × 20px）的圆角开关。关闭为蓝灰，开启为偏深的海水蓝，圆点平移（14px）；状态通过原生 checkbox 和 switch 语义表达。仅状态变化使用（150ms）的位移动画。

### Speech and Perception

话语浮层含小号海水蓝角色名及正常正文，不使用尖角气泡。桌面宽度最多（350px），手机最多（360px），保持离屏幕边缘的空间。话语内容可换行，并通过 polite live region 更新。

角色视角小窗默认为隐藏，仅通过“画面与调试”开启。桌面宽（224px），中等宽度（204px），手机宽（150px）；画面比例（16:9）。它是操作辅助，不承担默认画面的主要视觉层级。

### Journal and Settings

行动记录使用细分隔线、时间和短句；决策使用海水蓝，目标使用主文字色，错误使用浅珊瑚色。内容过长可换行并滚动。设置使用原生 details/summary 就地展开；模型连接与画面调试为独立的展开区，标题与状态始终可见。

加载采用深蓝遮罩、简短状态和转圈指示器。减少动态偏好下关闭 CSS 状态过渡与加载转圈；三维动作仍由角色运行状态驱动，不宣称已停止角色动作。

## Do's and Don'ts

### Do:
- **Do** 延续用户已有蓝色卧室和真实角色的视觉方向，让场景保持主导。
- **Do** 复用深蓝表面、轻圆角、细描边和海水蓝焦点，新增操作沿用已有密度。
- **Do** 显示当前控制模式、实际执行状态、连接反馈和具体错误。
- **Do** 保留中文控件标签、键盘焦点、角色作者署名与就地展开的设置。

### Don't:
- **Don't** 将本地房间体验改成营销首屏或添加营销文案。
- **Don't** 默认打开角色视角小窗，或用调试信息遮住主要场景。
- **Don't** 为按钮、侧栏和设置添加通用浮卡片投影或品牌展示字体。
- **Don't** 用颜色单独传达错误，也不要把“已配置”写成已验证连接成功。
