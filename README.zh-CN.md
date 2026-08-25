# Harmony Audio Book 🎹

[English Version](README.md) | **简体中文**

> 将音乐理论教材转化为可阅读、可播放、可交互的学习材料。

Harmony Audio Book 是一个基于浏览器的音乐理论教材阅读器。它解析项目内置的教材 HTML，识别正文中明确写出的和声进行，并把教材中的谱例图片与和弦符号连接到统一的采样钢琴播放引擎。

## 项目特点

### 和声进行识别

阅读器可以从教材正文中识别明确的字母和弦串与罗马数字进行，例如：

```text
C—F—C
Dm7—G7—Cmaj7
C—Fm—C
Bø—C
```

当前和弦解析器支持常见的大、小三和弦，六和弦，七和弦，九和弦，减和弦，半减和弦，增和弦，挂留和弦，附加音和弦，斜线和弦，升降号写法以及罗马数字写法。解析时会保留教材中的显示符号，同时生成统一的内部和弦数据与 MIDI 音高。正文和声进行会在播放前使用确定性的最近声部连接。

### 谱例发现与识别

谱例发现层会扫描教材 HTML 中可能的乐谱资源，包括普通图片、懒加载图片、`picture`/`figure` 容器、图片链接、内联 SVG，以及附近的谱例语义上下文。它会区分已经找到的谱图、引用前文谱例的文字，以及尚未找到资源的谱例提及。

对于符合条件的五线谱图片，可以使用现有 HOMR 流程处理：

```text
教材 HTML → 谱例候选发现 → HOMR → MusicXML → MIDI/音符事件 → 阅读器播放
```

HOMR 并不是通用的所有记谱法转谱工具。简谱和纯节奏教学图可能需要单独的转谱流程，系统不会为了生成播放器而凭空猜测音高。

### 统一的真实钢琴播放

正文和声进行与 HOMR 音符事件共用浏览器端的 `PianoEngine`，并使用 `smplr` 的 `SplendidGrandPiano` 采样音源：

```text
正文和弦或谱例事件
          ↓
       音符事件
          ↓
      PianoEngine
          ↓
 SplendidGrandPiano 采样
          ↓
      Web Audio 输出
```

引擎会复用同一个 `AudioContext` 和钢琴实例，处理移动浏览器的挂起状态，显示首次音色加载状态，保留谱例事件时序，并在切换播放或阅读器卸载时停止已安排的音符与计时器。

## 技术架构

```text
                  教材 HTML
                  /       \
                 /         \
           和声识别器    谱例识别器
                |             |
          和弦/级数解析       HOMR
                |             |
          声部连接 MIDI     MusicXML/MIDI
                 \          /
                  \        /
                   音符事件
                       |
                  PianoEngine
                       |
                    音频输出
```

主要模块：

- `app/page.tsx`：阅读器、章节导航和播放控制。
- `lib/harmony/`：和弦解析、和声进行识别与声部连接。
- `lib/audio/piano-engine.ts`：共享钢琴音源的生命周期和播放调度。
- `scripts/score_discovery.py`：基于 DOM 的谱例候选发现。
- `scripts/build_full_score_library.py`：谱图下载、HOMR 处理和清单导出。
- `public/score-audio/manifest.json`：浏览器播放所需的谱例事件与下载链接。

## 技术栈

- 兼容 Next.js 的 React 应用，以及 Vinext/Vite 构建工具
- TypeScript
- Web Audio API
- [`smplr`](https://github.com/danigb/smplr) 与 `SplendidGrandPiano`
- MusicXML 与 MIDI
- [HOMR](https://github.com/Quackone/homr_gui)，用于支持的五线谱图片
- 用于抽取和审计的 Node.js 与 Python 工具

## 本地运行

要求：Node.js 22 或更高版本。只有在准备谱例发现或运行 HOMR 脚本时才需要 Python。

```bash
npm install
npm run dev
```

构建生产版本：

```bash
npm run build
```

运行和弦解析回归测试：

```bash
npm run test:progressions
```

阅读器会从 `public/books/` 加载教材，从 `public/score-audio/` 加载谱例数据。

## Roadmap / 后续计划

- 改进谱例候选审核和全书覆盖率报告。
- 增加专门的简谱转 MIDI 流程。
- 扩展带调性上下文的和声抽取与追踪。
- 向更适合教学的 SATB 自动声部连接发展。
- 增加更多乐器音色和教材集合。

这些内容属于计划中的方向；当前阅读器不应被理解为完整的自动转谱或自动和声分析系统。

## 贡献

欢迎在以下方向贡献：

- 音乐理论与和声解析；
- 谱例发现与音乐信息检索；
- HOMR/MusicXML 后处理；
- Web Audio 与采样器稳定性；
- 无障碍音乐教育界面。

请保持生成的谱例资源与清单可复现，并为解析器或播放逻辑的修改附上针对性测试。

## License

项目目前尚未选择许可证。

## 项目愿景

> 音乐理论不应该只能被阅读，也应该能够被听见。
