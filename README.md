# PS 批量置入 PNG 到 PSD

**[在线介绍页](https://jaymik1947.github.io/ps-place-png/)** · **[下载 jsx](https://github.com/jaymik1947/ps-place-png/blob/main/menu-script/place-png-into-psd.jsx)**

把渲染出来的 PNG 自动合成进同名 PSD，省掉手工拖图层。

面向 3D 渲染 / 电商出图的工作流：渲染软件输出 `mat`（材质层）和 `obj`（物体层）两套 PNG，以及一张底图 PSD。这个工具按文件名把它们配对，把 PNG 作为普通像素图层叠进 PSD，收进一个隐藏的 `aov` 组，然后覆盖保存。

## 处理前后

**处理前** —— 三个文件夹，文件名一一对应：

```
工作目录/
├── mat_2/    未标题_11200x1200.png    ← 材质层
├── obj_1/    未标题_11200x1200.png    ← 物体层
└── rgba/     未标题_11200x1200.psd    ← 底图
```

**处理后** —— PSD 里自动变成：

```
aov              ← 图层组，默认隐藏
  obj            ← 物体层
  mat            ← 材质层
背景              ← 唯一可见的图层
```

打开 PSD 只看得到背景，需要看 AOV 层时点开 `aov` 组即可。

## 两个版本

| 版本 | 入口 | 特点 |
|---|---|---|
| 菜单脚本版 | `文件 → 脚本 → 批量置入PNG到PSD` | 零依赖，双击即用，弹出确认框后全自动跑完 |
| CEP 面板版 | `窗口 → 扩展（旧版）→ 批量置入 PNG` | 常驻侧边栏，有文件列表、逐项勾选、实时进度条、处理完打印最终图层结构 |

核心逻辑完全一致，CEP 面板版直接调用同一份 ExtendScript 逻辑，只是多了个前端壳。

## 安装

### 菜单脚本版

1. 下载 [`menu-script/place-png-into-psd.jsx`](menu-script/place-png-into-psd.jsx)
2. **必须转成 GBK 编码**，否则中文版 PS 里弹窗中文会乱码：

```powershell
# Windows PowerShell，在同目录执行
[IO.File]::WriteAllText('批量置入PNG到PSD.jsx', [IO.File]::ReadAllText('place-png-into-psd.jsx','utf8'), [Text.Encoding]::GetEncoding(936))
```

3. 放进 PS 的脚本目录（需要管理员权限）：

```
C:\Program Files\Adobe\Adobe Photoshop 20xx\Presets\Scripts\
```

4. 重启 Photoshop，菜单里就会出现 `文件 → 脚本 → 批量置入PNG到PSD`

不想动 `Program Files` 的话，也可以每次用 `文件 → 脚本 → 浏览…` 手动选中 jsx。

### CEP 面板版

1. 把 `cep-panel` 整个文件夹复制到：

```
C:\Users\<你的用户名>\AppData\Roaming\Adobe\CEP\extensions\ps-place-png\
```

2. 确认已开启未签名扩展支持（注册表，`CSXS.11` ~ `CSXS.14` 都设一遍最保险）：

```
HKEY_CURRENT_USER\Software\Adobe\CSXS.12
  PlayerDebugMode = "1"   (字符串值)
```

3. 完全退出 Photoshop 再打开
4. `窗口 → 扩展（旧版）→ 批量置入 PNG`

## 目录结构

```
.
├── menu-script/
│   └── place-png-into-psd.jsx     菜单脚本版，ExtendScript，UTF-8 源文件
├── cep-panel/
│   ├── CSXS/
│   │   └── manifest.xml           CEP 扩展清单
│   └── host/
│       ├── index.html             面板结构
│       ├── css/style.css          面板样式（跟随 PS 亮/暗主题）
│       ├── js/main.js             面板前端：列表、勾选、进度、调度
│       └── jsx/host.jsx           面板后端：全部 Photoshop 操作
└── docs/
    └── index.html                 项目介绍页
```

**改代码前先看这里**：

- 想改处理逻辑（配对规则、图层顺序、Alpha 处理）→ 改 `menu-script/place-png-into-psd.jsx` 和 `cep-panel/host/jsx/host.jsx`，**两个文件都要改**，它们是同一套逻辑的两份拷贝。
- 想改面板交互（按钮、列表、样式）→ 只改 `cep-panel/host/js/main.js` 和 `style.css`，不涉及 PS 操作。
- `cep-panel/host/jsx/host.jsx` 里带 `PPS_` 前缀的函数是对前端暴露的接口，其余 `pps` 前缀是内部实现。

## 配置项

两份 jsx 顶部都有配置区：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `MAT_DIR` / `PPS.MAT_DIR` | `mat_2` | 材质层所在子文件夹名 |
| `OBJ_DIR` / `PPS.OBJ_DIR` | `obj_1` | 物体层所在子文件夹名 |
| `PSD_DIR` / `PPS.PSD_DIR` | `rgba` | 目标 PSD 所在子文件夹名 |
| `MAT_LAYER` / `PPS.MAT_LAYER` | `mat` | 置入后材质层的图层名 |
| `OBJ_LAYER` / `PPS.OBJ_LAYER` | `obj` | 置入后物体层的图层名 |
| `AOV_GROUP` / `PPS.AOV_GROUP` | `aov` | 两者被收进的图层组名（该组会隐藏） |
| `ALPHA_NAME` / `PPS.ALPHA_NAME` | `alpha` | 要应用的通道名，找不到就跳过 |
| `APPLY_ALPHA` | `true` | 是否启用 Alpha 通道处理（仅菜单版有此开关） |
| `ALPHA_MODE` | `"mask"` | 菜单版：`mask` 生成蒙版 / `delete` 直接抠除 |
| `ALPHA_INVERT` | `false` | Alpha 极性相反时设为 `true` |
| `SAVE` | `true` | 是否覆盖保存原 PSD |
| `REMOVE_EXISTING` | `true` | 置入前删掉已有的同名图层，保证可重复运行 |
| `CLEAN_OTHER_LAYERS` | `true` | 删掉背景层和 aov 组以外的所有图层（面板版有对应勾选框） |
| `TEST_FIRST_ONLY` | `false` | 只处理第一个可配对文件，用于调试 |

> `APPLY_ALPHA`、`CLEAN_OTHER_LAYERS` 在 CEP 面板版是界面上的勾选框，不用改代码。

## 核心逻辑

1. **配对** — 扫描 `PSD_DIR` 下所有 `.psd`，取文件名去掉扩展名、转小写作为 key，去 `MAT_DIR` 和 `OBJ_DIR` 里找同名图片（png/tif/jpg 都接受，png 优先）。
2. **打开 PSD** — `app.open()`，切到前台，先 `deselect()` 清掉可能残留的选区。
3. **清旧图层** — 先整体删掉上一轮的 `aov` 组（连带组内旧图层），再扫散落在别处的同名 `mat` / `obj`。
4. **清理多余图层**（可选，默认开）— 删掉背景层和 `aov` 组以外的所有顶层图层。应对旧图层被改过名（如 `yjq_032000x2000`）导致按名删除失效的情况。
5. **应用 Alpha** — 扫 `doc.channels`，找名为 `Alpha`（或 `Alpha 1` 这类默认名）的通道。找到就载入为选区，给背景层生成图层蒙版；找不到就跳过。背景层是锁定的，先 `isBackgroundLayer = false` 解锁才能带透明。
6. **置入 PNG** — 打开 PNG → 检查位深/色彩模式是否与 PSD 一致 → `duplicate(destDoc)` 复制 → 重命名 → 按 `bounds` 把左上角归零。
7. **收进 aov 组** — `layerSets.add()` 建组 → 两个图层 `move(group, INSIDE)` → `obj` 移到 `mat` 之上 → `group.visible = false`。
8. **保存** — `doc.save()` 覆盖原文件，然后 `close(DONOTSAVECHANGES)` 关闭。

任一步失败则该 PSD 整体不保存，原文件保持完好。

## 踩坑记录

这些是实际调试中撞出来的，改代码前务必读一遍，能省几个小时。

### ExtendScript

**1. `layer.duplicate()` 不能传第二个参数**

```javascript
// 错：报「请求的动作要求目标文档是最前面的文档」或「您只能从最前面的文档复制图层」
srcLayer.duplicate(destDoc, ElementPlacement.PLACEATBEGINNING);

// 对：源文档在前台，省略 insertionLocation，图层自动落到目标文档堆栈顶部
app.activeDocument = srcDoc;
srcLayer.duplicate(destDoc);
```

Photoshop 文档写得很清楚：art layer 的 `insertionLocation` 只接受 `PLACEBEFORE` / `PLACEAFTER`。传 `PLACEATBEGINNING` 会触发额外的前台文档校验，然后陷入「先要求目标前台、再要求源前台」的死循环。

**2. 脚本文件必须存 GBK**

ExtendScript 在中文 Windows 上按系统 codepage（CP936）解析脚本文件。存成 UTF-8 的话，所有中文提示在 PS 里都是乱码。源码保持 UTF-8 便于编辑，交付前用 `iconv` 或 PowerShell 转 GBK。

**3. 静默失败是最贵的 bug**

早期版本在「载入通道后检查选区是否为空」这一步，`doc.selection.bounds` 取不到就当成空选区直接 `return false`。结果是背景层被解锁了、蒙版没生成、也不报错，排查了很久。

**校验代码永远不要静默放弃关键步骤**——取不到值要么按「有」继续，要么抛明确错误。

### CEP

**4. `evalScript` 传不了非 ASCII**

面板（Chromium）和 ExtendScript 引擎之间是跨进程调用，中文传过去必乱码。约定：**边界上只传 ASCII**。

- 路径 / 文件名 → URL 编码后传，前端 `decodeURIComponent` 还原
- 要处理的文件 → 前端只传数组下标，`File` 对象缓存在 jsx 全局（`PPS_cache.items`）

ExtendScript 没有 `encodeURIComponent`，`host.jsx` 里手写了一套 UTF-8 百分号编解码，含 4 字节代理对分支。

**5. 改了 `ScriptPath` 指向的 jsx 必须重启 PS**

只关掉面板再打开不够——`host.jsx` 在 PS 启动时就注入 ExtendScript 引擎了，不重启的话引擎里跑的还是旧函数。

### 语言与 API 陷阱（血泪）

**6. `final` 是 ES3 保留字，不能当属性名**

```javascript
// 错：整个 jsx 解析失败，所有函数都不存在
return { alpha: true, final: list };

// 对
return { alpha: true, layerNames: list };
```

ExtendScript 基于 ES3，`final` 在 FutureReservedWord 列表里。对象字面量用它会直接语法错误。

**最坑的是 `node --check` 检测不出来**——它按 ES2020 解析，`final` 早已不是保留字。同类的还有 `class`、`enum`、`public`、`static`、`super`、`import`、`export`、`float`、`int` 等 30 个词。

改完 jsx 跑一遍这个：

```bash
grep -nE "\b(abstract|boolean|byte|char|class|const|debugger|double|enum|export|extends|final|float|goto|implements|import|int|interface|long|native|package|private|protected|public|short|static|super|synchronized|throws|transient|volatile)\b" host.jsx
```

**症状对照**：面板报 `EvalScript error.` 且没有任何细节，一律先怀疑 jsx 整体加载失败（语法错误），而不是业务逻辑出错。业务异常会带具体文字。

**7. `doc.layers` 是活集合，不能边遍历边删**

```javascript
// 错：删完索引漂移，部分目标被跳过
for (var i = doc.layers.length - 1; i >= 0; i--) {
    if (doc.layers[i].name === name) doc.layers[i].remove();
}

// 对：先拍快照，再统一删
var snap = [];
for (var i = 0; i < doc.layers.length; i++) snap.push(doc.layers[i]);
for (var j = snap.length - 1; j >= 0; j--) { ... }
```

`doc.layers`、`doc.artLayers`、`doc.layerSets` 全是活集合。倒序遍历也救不了你——集合长度和索引会实时变化。

**8. `isBackgroundLayer` 是可写状态，不能当稳定判据**

透视：本工具给背景层加蒙版前要执行 `isBackgroundLayer = false` 解锁，**这个改动会存进文件**。下次运行再用 `isBackgroundLayer === true` 判断"哪些图层是背景"，背景层就被当成普通图层删掉了，然后 `mat` 顶上来冒充背景。

正确做法是多判据兜底：

1. 最底层图层（`doc.layers[doc.layers.length - 1]`）无条件保留——背景永远在最底下
2. 名字匹配「背景」/「background」
3. 如果算出"所有图层都该删"，说明判据失效，直接放弃清理

**通用原则：不要拿会被自己代码改变的状态当判据。**

## 用 AI 继续改这个项目

把整个仓库丢给任意支持读代码的 AI，附上下面的背景，它就能接手。

### 给 AI 的上下文

```
这是一个 Photoshop 插件项目，两个版本：
1. menu-script/place-png-into-psd.jsx —— ExtendScript（ES3 语法），菜单脚本
2. cep-panel/ —— CEP 扩展，host/js/main.js 是 Chromium 前端，
   host/jsx/host.jsx 是 ExtendScript 后端，两者通过 evalScript 通信

硬约束：
- ExtendScript 是 ES3，不能用 let/const/箭头函数/模板字符串/JSON 对象
- 同样不能用 ES3 保留字做标识符：final、class、enum、public、static、super 等
  （用了会让整份 jsx 解析失败，面板只显示 "EvalScript error."）
  node --check 检测不出来，改完必须 grep 一遍保留字
- 两份 jsx 是同一套逻辑的两份拷贝，改逻辑必须同步改
- 菜单版交付前必须转 GBK 编码，CEP 版保持 UTF-8
- CEP 的 evalScript 不能传非 ASCII，中文必须走 URL 编码
- 图层跨文档复制用 duplicate(destDoc)，不要传第二个参数
- doc.layers 是活集合，批量删除必须先拍快照再删
- isBackgroundLayer 会被 Alpha 处理改成 false 并存盘，不要拿它当背景层的判据
```

### 常见改动入口

| 想做什么 | 改哪里 |
|---|---|
| 改目录名 / 图层名 / 组名 | 两份 jsx 顶部的配置区 |
| 改配对规则（比如加前缀匹配） | `ppsKey()` / `stripExt()` |
| 改图层顺序 | `ppsGroupIntoAov()` 里的 `move` 调用 |
| 加新的图层类型 | 在 `ppsProcessOne()` 里追加一次 `ppsPlaceAsLayer()` 调用 |
| 改图层清理规则 | `ppsCleanOtherLayers()`（哪些层该保留） |
| 改面板 UI | `host/index.html` + `css/style.css` + `js/main.js` |
| 加导出日志功能 | 在 `js/main.js` 的 `log()` 里追加写文件逻辑 |

## 已知限制

- **只支持 Windows**。路径处理用了反斜杠转正斜杠，macOS 未测试。
- **CEP 面板不支持拖入文件夹**。Adobe 的 HTML 引擎不放行系统拖放，只能用按钮选目录。这是平台限制，不是实现问题。
- **UXP 版本未完成**。做过一版 UXP 面板，但 PS 加载不稳定，已放弃，本仓库不含该代码。
- **Alpha 通道极性需手动确认**。默认按「白色=保留」处理，如果结果反了，把 `ALPHA_INVERT` 设为 `true`。
- **需要 PS 2022（23.0）或更新版本**。

## License

MIT
