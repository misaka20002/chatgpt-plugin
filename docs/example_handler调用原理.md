# `example_handler.js` 调用原理

## 功能定位

[`apps/example_handler.js`](../apps/example_handler.js) 是一个 ChatGPT 回复后处理器示例。

它不负责生成 ChatGPT 回复，也不能通过返回值替换最终回复文本。它的主要用途是在模型回复生成后执行额外操作，例如：

- 调用文字转语音接口并额外发送语音；
- 记录回复日志或审计数据；
- 将回复同步到其他服务；
- 根据回复内容额外发送消息。

整体调用过程如下：

```text
TRSS-Yunzai 启动
  ↓
加载 chatgpt-plugin/index.js
  ↓
动态导入 apps/example_handler.js
  ↓
实例化 ChatGPTResponsePostHandler
  ↓
注册 chatgpt.response.post 处理器
  ↓
用户触发 ChatGPT 对话
  ↓
模型生成回复并完成内部文本后处理
  ↓
触发 chatgpt.response.post
  ↓
调用 postHandler(e, options, reject)
```

## 一、应用文件的加载

`chatgpt-plugin/index.js` 会扫描 `apps` 目录下所有以 `.js` 结尾的文件：

```js
const files = fs.readdirSync('./plugins/chatgpt-plugin/apps')
  .filter(file => file.endsWith('.js'))
```

随后动态导入每个文件：

```js
ret.push(import(`./apps/${file}`))
```

因此，只要 `example_handler.js` 位于 `apps` 目录并正确导出插件类，就会被插件入口自动发现，不需要在其他文件中手动引用。

当前示例直接继承全局变量 `plugin`：

```js
export class ChatGPTResponsePostHandler extends plugin {
```

这是因为 TRSS-Yunzai 的插件加载器设置了：

```js
global.plugin = plugin
```

为了让依赖关系更明确，也可以像其他应用文件一样显式导入：

```js
import plugin from '../../../lib/plugins/plugin.js'
```

## 二、后处理器的注册

`ChatGPTResponsePostHandler` 构造函数调用父类并传入 Handler 配置：

```js
super({
  name: 'chatgpt文本回复后处理器',
  priority: -100,
  namespace: 'chatgpt-plugin',
  handler: [{
    key: 'chatgpt.response.post',
    fn: 'postHandler'
  }]
})
```

各字段含义如下：

| 字段 | 作用 |
| --- | --- |
| `name` | 插件实例名称，主要用于日志展示 |
| `priority` | 执行优先级，设计上数字越小越先执行 |
| `namespace` | Handler 注册命名空间，用于区分和管理处理器 |
| `handler[].key` | 监听的 Handler 事件名称 |
| `handler[].fn` | 事件触发时调用的实例方法名 |

TRSS-Yunzai 加载并实例化这个类后，会把配置交给全局 Handler，注册关系可以近似理解为：

```text
事件名称：chatgpt.response.post
执行对象：ChatGPTResponsePostHandler 实例
执行方法：postHandler
```

这里的 `key` 必须与调用方使用的 `chatgpt.response.post` 完全一致，否则处理器不会被触发。

## 三、触发时机

真正的调用位置在 `apps/chat.js` 中。

模型返回数据后，插件先提取回复文本：

```js
let response = typeof chatMessage?.text === 'string'
  ? chatMessage.text.replace('\n\n\n', '\n')
  : ''
```

然后执行插件内部的 `postProcessors`，这些处理器可以真正修改 `response` 和 `thinking`：

```js
for (let processor of postProcessors) {
  let output = await processor.processInner({
    text: response,
    thinking_text: thinking
  })

  response = output.text
  thinking = output.thinking_text
}
```

内部文本处理完成后，程序检查是否存在 `chatgpt.response.post`：

```js
if (handler.has('chatgpt.response.post')) {
  handler.call('chatgpt.response.post', this.e, {
    content: response,
    thinking,
    use,
    prompt
  }, true).catch(err => {
    logger.error('后处理器出错', err)
  })
}
```

这次调用的四个参数分别是：

1. `chatgpt.response.post`：需要触发的 Handler key；
2. `this.e`：当前消息事件对象；
3. 参数对象：本次回复、思考内容、模型渠道和用户提示词；
4. `true`：执行该 key 下的全部处理器。

## 四、`postHandler` 参数

处理函数定义如下：

```js
async postHandler(e, options, reject) {
```

### `e`：消息事件对象

`e` 是当前聊天消息对应的事件对象，常用内容包括：

```js
e.user_id
e.group_id
e.isGroup
e.msg
e.sender
e.reply(...)
```

处理器可以通过它额外回复消息：

```js
await e.reply('后处理器发送的额外消息')
```

### `options`：回复上下文

调用方传入的数据结构为：

```js
{
  content: response,
  thinking,
  use,
  prompt
}
```

| 字段 | 含义 |
| --- | --- |
| `content` | 模型回复经过内部后处理后的文本 |
| `thinking` | 模型返回的思考内容，可能为空 |
| `use` | 本次对话使用的模型渠道或模式 |
| `prompt` | 用户本次发送的提示词 |

当前示例只解构了三个字段：

```js
const { content, use, prompt } = options
```

如果需要思考内容，可以改为：

```js
const { content, thinking, use, prompt } = options
```

### `reject`：拒绝当前处理

`reject` 是 Handler 提供的回调，可以表示当前处理器不接受本次事件，并可附带日志信息：

```js
if (!content) {
  reject('回复内容为空')
  return
}
```

本次调用设置了 `allHandler = true`，所以调用 `reject()` 不会阻止同一 key 下的其他处理器继续执行。

## 五、异步执行与返回值

调用方使用的是：

```js
handler.call(...).catch(...)
```

而不是：

```js
response = await handler.call(...)
```

这带来两个重要结果。

### 1. 返回值不会修改回复

即使处理器返回新的字符串：

```js
async postHandler() {
  return '新的回复内容'
}
```

调用方也不会使用这个返回值，原来的 `response` 不会被替换。

如果需要真正修改即将发送的回复文本，应使用前面的 `postProcessors` 等文本处理机制，而不是这个事件型后处理器。

### 2. 主流程不会等待处理器完成

调用方没有对 `handler.call()` 使用 `await`，所以后处理器相对于后续回复流程是异步执行的：

- ChatGPT 主回复不需要等待后处理器完成；
- 后处理器可以独立调用外部接口；
- 后处理器异常会被 `.catch()` 捕获并记录；
- 不应该依赖它在主回复发送前完成。

因此，它非常适合执行“附加动作”，但不适合参与主回复内容的同步计算。

## 六、文字转语音示例的原理

文件中注释掉的示例流程是：

```text
取得 content
  ↓
调用外部 TTS API
  ↓
接收 MP3 Blob
  ↓
转换为 ArrayBuffer
  ↓
转换为 Node.js Buffer
  ↓
通过 e.reply(segment.record(...)) 发送语音
```

核心代码类似：

```js
const response = await fetch('语音合成接口', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    text: content,
    format: 'mp3'
  })
})

const audio = await response.blob()
const buffer = await audio.arrayBuffer()
await e.reply(segment.record(Buffer.from(buffer)))
```

这条语音是后处理器额外发送的消息，不会取代插件原本的文字回复。

## 七、简单扩展示例

下面的处理器会记录调用信息，并在回复包含指定内容时额外发送提示：

```js
async postHandler(e, options, reject) {
  const { content, use, prompt } = options

  if (!content) {
    reject('没有可处理的回复内容')
    return
  }

  logger.info({
    userId: e.user_id,
    groupId: e.group_id,
    use,
    prompt,
    responseLength: content.length
  })

  if (content.includes('重要提醒')) {
    await e.reply('检测到重要提醒内容')
  }
}
```

执行过程为：

1. ChatGPT 完成回答；
2. `chat.js` 触发 `chatgpt.response.post`；
3. `postHandler` 记录本次请求；
4. 满足条件时额外发送一条消息；
5. ChatGPT 原本的回复内容不受影响。

## 八、多处理器与优先级注意事项

### 命名空间

Handler 注册新处理器时，会先删除“相同 namespace 和相同 key”的旧处理器。

如果多个文件都监听 `chatgpt.response.post` 并且都写成：

```js
namespace: 'chatgpt-plugin'
```

它们可能互相覆盖。希望多个处理器同时存在时，应使用不同且稳定的命名空间，例如：

```js
namespace: 'chatgpt-plugin.tts'
```

```js
namespace: 'chatgpt-plugin.audit'
```

### 优先级

Handler 设计上按照 `priority` 从小到大执行。

当前 TRSS-Yunzai 加载器注册 Handler 时传递的字段名是 `property`，而 Handler 本身读取的是 `priority`，因此当前核心代码中这里的 `priority: -100` 可能会回退为 Handler 默认值 `500`。

只有一个 `chatgpt.response.post` 处理器时，这个问题不会影响实际功能；存在多个处理器并依赖执行顺序时，需要同时核对当前 TRSS-Yunzai 核心版本的 Handler 注册实现。

## 总结

`example_handler.js` 可以理解为订阅了一个内部事件：

```text
事件：chatgpt.response.post
触发条件：ChatGPT 已取得并完成内部后处理的回复
输入：消息事件、回复内容、思考内容、模型渠道、用户提示词
输出：返回值被忽略
适合：额外回复、TTS、日志、审计、外部通知
不适合：修改主回复文本、阻塞主回复流程
```
