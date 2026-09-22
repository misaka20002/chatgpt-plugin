# AnythingLLM 知识库指南（部署 / 锅巴配置 / 使用）

> 适用版本：chatgpt-plugin 2.8.x
> 文档说明：本文合并了原《AnythingLLM 部署成功指南》与《AnythingLLM 使用指南》，一份文档覆盖 **部署服务 → 初始化知识库 → 锅巴配置 → 使用与排障**。

AnythingLLM 是一个可私有化部署的 RAG（检索增强生成）知识库系统。接入本插件后，Bot 会先在你的文档库里检索相关内容，再结合检索结果回答，实现「基于自有资料的问答」。

## 目录

- [一、功能简介](#一功能简介)
- [二、快速开始](#二快速开始)
  - [第一步：部署 AnythingLLM 服务](#第一步部署-anythingllm-服务)
  - [第二步：初始化 AnythingLLM](#第二步初始化-anythingllm)
  - [第三步：在锅巴中配置插件](#第三步在锅巴中配置插件)
  - [第四步：测试集成](#第四步测试集成)
- [三、锅巴配置详解（逐项怎么填）](#三锅巴配置详解逐项怎么填)
- [四、等价 config.json 配置](#四等价-configjson-配置)
- [五、使用方式与场景](#五使用方式与场景)
- [六、常用 Docker 命令与数据备份](#六常用-docker-命令与数据备份)
- [七、故障排查](#七故障排查)
- [八、性能优化与使用建议](#八性能优化与使用建议)
- [九、注意事项](#九注意事项)
- [十、相关资源](#十相关资源)

---

## 一、功能简介

接入后，Bot 会获得两个工具（仅在**智能模式**开启时可用）：

| 工具名 | 作用 |
| --- | --- |
| `anythingllm_query` | 在指定工作区中检索知识库内容，回答专业问题、查文档、查 FAQ |
| `anythingllm_workspace` | 列出全部工作区、查看某个工作区的详情与文档数量 |

核心特性：

- ✅ 支持多种文档格式（PDF、TXT、MD、DOCX、CSV、XLSX 等）
- ✅ 向量化检索，快速定位相关片段
- ✅ 多工作区管理，不同主题互相隔离
- ✅ 可附带引用来源（文档名），答案可追溯
- ✅ 内置查询缓存，重复问题不再重复打接口
- ✅ 全部本地/内网部署，资料不出自己的服务器

---

## 二、快速开始

### 第一步：部署 AnythingLLM 服务

#### 方式 1：Docker 一键部署（推荐）

```bash
# 1. 拉取镜像
docker pull mintplexlabs/anythingllm:latest

# 2. 启动服务
docker run -d \
  --name anythingllm \
  --restart unless-stopped \
  -p 3001:3001 \
  -v /opt/anythingllm/storage:/app/server/storage \
  -e STORAGE_DIR="/app/server/storage" \
  -e EMBEDDING_ENGINE="native" \
  -e VECTOR_DB="lancedb" \
  -e DISABLE_TELEMETRY="true" \
  mintplexlabs/anythingllm:latest

# 3. 查看日志确认启动成功
docker logs -f anythingllm

# 4. 浏览器访问 http://<你的服务器IP>:3001
```

部署完成后可用以下命令确认状态：

```bash
docker ps | grep anythingllm
# 期望看到状态为 healthy、端口映射形如 0.0.0.0:3001->3001/tcp
```

#### 方式 2：Docker Compose（长期维护推荐）

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  anythingllm:
    image: mintplexlabs/anythingllm:latest
    container_name: anythingllm
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - ./storage:/app/server/storage
    environment:
      - STORAGE_DIR=/app/server/storage
      - SERVER_PORT=3001
      - EMBEDDING_ENGINE=native
      - VECTOR_DB=lancedb
      - DISABLE_TELEMETRY=true
```

```bash
docker-compose up -d
```

> 数据持久化在宿主机的存储目录（上面示例为 `/opt/anythingllm/storage` 或 `./storage`）。**只要不动这个目录，删容器重建数据都不丢。**

#### 访问地址怎么选

| 场景 | 地址形式 | 说明 |
| --- | --- | --- |
| 与本插件同一台机器 | `http://localhost:3001` | 最简单，无网络开销 |
| 插件与知识库不同机器 | `http://<局域网IP>:3001` | 推荐，填局域网地址即可 |
| 需要公网访问 | `http://<公网IP>:3001` | 需自行处理防火墙与安全，**不建议直接裸暴露** |

⚠️ 外网访问不通时，先检查服务器防火墙 / 安全组是否放行了 3001 端口。

---

### 第二步：初始化 AnythingLLM

浏览器打开 `http://<你的服务地址>:3001`，按顺序完成：

1. **创建管理员账号**
   - 设置用户名（例如 `admin`）与强密码，点击 `Continue`。

2. **选择 LLM 提供商（可跳过）**
   - **建议跳过（Skip）**：本插件在 `query` 模式下使用你自己的 AI 模型生成回答，不需要 AnythingLLM 内置 LLM。
   - 若你打算使用 `chat` 模式（见[查询模式](#5-查询模式anythingllm_mode)），则**必须**在这里配置好 LLM，否则 chat 模式无法生成回答。

3. **选择 Embedding 模型（重要）**
   - 推荐：**`AnythingLLM Embedder`**（内置免费，开箱可用）
   - 有更高要求时可选：`nomic-embed-text` 等
   - ⚠️ 中文资料建议优先确认模型对中文的支持情况，选定后**不建议随意更换**（换模型会导致已有向量失效，需要重新嵌入文档）。

4. **选择向量数据库**
   - 推荐：**`LanceDB`**（零额外配置），点击 `Continue`。

5. 点击 `Finish Setup` 完成初始化。

6. **生成 API Key** ⭐
   - 左下角齿轮图标 `Settings` → 左侧菜单 `API Keys` → `Generate New API Key`
   - **立即复制保存**：API Key 只显示一次，关闭后无法再查看
   - 格式形如：`ANLM-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

7. **创建工作区** ⭐
   - 左侧 `New Workspace` → 填写名称（例如 `通用知识库`）
   - **slug（英文标识符）会自动生成**，例如 `general-knowledge`
   - ⚠️ **记住这个 slug**，它就是后面锅巴里「默认工作区」要填的内容（区分大小写）

8. **上传文档**
   - 进入工作区 → 右上角 `Upload` / `+ Add Document` → 选择文件上传
   - 上传后自动向量化，状态从 `Processing` 变为 `Ready` 才算可用

支持的文件格式：`.txt` `.md` `.pdf` `.docx` `.doc` `.csv` `.xlsx` `.json` `.js` `.py` `.html` 等。

文档处理耗时参考：

| 文档大小 | 处理时间 |
| --- | --- |
| < 1MB | 几秒 |
| 1–10MB | 10–30 秒 |
| 10–50MB | 1–3 分钟 |
| > 50MB | 可能很久，建议拆分 |

---

### 第三步：在锅巴中配置插件

1. 在 QQ 中发送 `#锅巴`
2. 进入 **ChatGPT-Plugin** 配置页
3. 向下滚动，找到分隔符 **「AnythingLLM 知识库」**
4. 按下表填写（字段详细含义见[第三章](#三锅巴配置详解逐项怎么填)）
5. 点击 **保存配置**
6. **重启 Yunzai** 使配置生效

```bash
cd /root/TRSS-Yunzai
pnpm restart
```

> 为什么必须重启：插件在启动时把 `config/config.json` 读进内存，`Config` 之后读的都是内存副本，因此锅巴保存后需要重启才会生效。

#### 照抄版：一份可直接用的填写示例

| 配置项 | 填什么 |
| --- | --- |
| 启用 AnythingLLM 知识库 | ✅ 开启 |
| AnythingLLM 服务地址 | `http://127.0.0.1:3001`（同机）或 `http://192.168.1.100:3001`（跨机） |
| API 密钥 | 第二步生成并复制的 `ANLM-...` |
| 默认工作区 | `general-knowledge`（第二步记住的 slug） |
| 查询模式 | `query - 仅检索（推荐）` |
| 显示引用来源 | ✅ 开启 |
| 请求超时时间 | `30000`（默认） |
| 最大重试次数 | `3`（默认） |
| 启用查询缓存 | ✅ 开启 |
| 缓存有效期 | `300000`（默认，5 分钟） |

**还差一步**：到锅巴里的 **「智能模式 开关」**（`smartMode`）确认已开启。这两个工具属于智能模式的工具集，智能模式没开时 Bot 不会调用知识库。

---

### 第四步：测试集成

重启完成后，在 QQ 中 @Bot 提问（需开启智能模式）：

```
用户：@Bot 什么是 Docker？
Bot：Docker 是一个开源的容器化平台...

     📚 参考来源：
     1. Docker入门教程.pdf
```

也可以先让 Bot 列一下工作区，确认配置通不通：

```
用户：@Bot 列出知识库有哪些工作区
```

---

## 三、锅巴配置详解（逐项怎么填）

页面位置：`#锅巴` → **ChatGPT-Plugin** → 分隔符 **「AnythingLLM 知识库」**。

字段总览：

| # | 界面标签 | config 字段 | 控件 | 默认值 | 取值范围 / 格式 |
| --- | --- | --- | --- | --- | --- |
| 1 | 启用 AnythingLLM 知识库 | `anythingllm_enable` | Switch | 关闭 | 开 / 关 |
| 2 | AnythingLLM 服务地址 | `anythingllm_baseUrl` | Input | `http://localhost:3001` | 完整 URL，含协议与端口 |
| 3 | API 密钥 | `anythingllm_apiKey` | InputPassword | 空 | `ANLM-` 开头的字符串 |
| 4 | 默认工作区 | `anythingllm_defaultWorkspace` | Input | `general-knowledge` | 工作区 slug（区分大小写） |
| 5 | 查询模式 | `anythingllm_mode` | Select | `query` | `query` / `chat` |
| 6 | 显示引用来源 | `anythingllm_includeSources` | Switch | 开启 | 开 / 关 |
| 7 | 请求超时时间 | `anythingllm_timeout` | InputNumber | `30000` | 5000–120000（毫秒） |
| 8 | 最大重试次数 | `anythingllm_maxRetries` | InputNumber | `3` | 0–5 |
| 9 | 启用查询缓存 | `anythingllm_cacheEnable` | Switch | 开启 | 开 / 关 |
| 10 | 缓存有效期 | `anythingllm_cacheTTL` | InputNumber | `300000` | 60000–3600000（毫秒） |

### 1. 启用 AnythingLLM 知识库（`anythingllm_enable`）

- **怎么填**：填完下面所有项后开启。
- **作用**：控制 `anythingllm_query` 与 `anythingllm_workspace` 两个工具是否注册给模型。关闭时 Bot 完全不会调用知识库。
- **注意**：
  - 修改后**需重启生效**。
  - 开启只是「允许调用」，真正生效还需智能模式开启 + API 密钥已填。
  - 密钥没填时工具仍会注册，但调用时会直接返回「API Key 未配置」提示，不会发起请求。

### 2. AnythingLLM 服务地址（`anythingllm_baseUrl`）

- **怎么填**：
  - 插件与 AnythingLLM 在**同一台机器** → `http://localhost:3001`
  - 在**不同机器** → `http://<知识库所在机器的局域网IP>:3001`
- **格式要求**：必须带协议，例如 `http://`；端口必须显式写出（默认 `3001`）；**不要以 `/` 结尾，也不要带上 `/api` 路径**，插件会自己拼接 `/api/v1/...`。
- **填错的表现**：Bot 回复「知识库查询失败：无法连接到 AnythingLLM 服务，请检查服务是否正常运行」。
- **小技巧**：填完后可在服务器上先验证连通性：
  ```bash
  curl http://127.0.0.1:3001/api/health
  ```

### 3. API 密钥（`anythingllm_apiKey`）

- **怎么填**：粘贴 AnythingLLM 里 `Settings → API Keys → Generate New API Key` 生成的密钥，形如 `ANLM-xxxxxxxx...`。
- **注意**：
  - 只显示一次，**没保存就得重新生成**。
  - 粘贴时**不要有多余空格或换行**（这是「API Key 无效」最常见的原因）。
  - 它是 `InputPassword`，界面上会打点显示，属正常现象。
  - ⚠️ **不要提交到 Git、不要发到群里**。建议定期轮换。

### 4. 默认工作区（`anythingllm_defaultWorkspace`）

- **怎么填**：填**工作区 slug**，不是显示名称。
  - 界面里名字叫「通用知识库」，slug 通常自动生成为 `general-knowledge` → **填 `general-knowledge`**。
  - 在 AnythingLLM 工作区列表里可以看到每个工作区的 slug。
- **作用**：当模型调用工具时没有指定 `workspace` 参数，就用这里的值；也是「工作区不存在」报错时被提及的那个值。
- **注意**：
  - **区分大小写**，务必与 AnythingLLM 中一致。
  - 这个工作区必须**已经存在且已上传文档**，否则查询会返回「工作区不存在」或「未找到相关信息」。
  - 想用多个知识库？保持这里填最常用的那个，其余工作区可以让模型在提问时自动指定（例如「查询原神工作区里钟离的信息」）。

### 5. 查询模式（`anythingllm_mode`）

| 取值 | 行为 | 推荐场景 |
| --- | --- | --- |
| **`query`（仅检索）** ✅ 推荐 | 只返回检索到的相关文档片段，由**你自己的 AI 模型**（OpenAI / Gemini / Claude 等）组织成回答 | 你已经在用能力较强的对话模型，回答更自然、更可控 |
| `chat`（带上下文对话） | 由 **AnythingLLM 内置的 LLM** 生成完整回答后返回 | 需要在 AnythingLLM 里另行配置 LLM provider，否则会失败 |

- **怎么填**：没有特殊需求就保持默认的 `query`。
- **注意**：`chat` 模式依赖 AnythingLLM 侧的 LLM 配置，初始化时若跳过了 LLM 提供商，请勿选择该模式。

### 6. 显示引用来源（`anythingllm_includeSources`）

- **怎么填**：建议开启。
- **作用**：开启后，检索到内容时会在回复末尾追加引用文档名，并按文档名去重：
  ```
  📚 参考来源：
  1. 原神角色图鉴.pdf
  ```
- **注意**：来源来自接口返回的 `sources` 字段；若当前模式/该次查询没有返回来源，则不会追加这一段，这不是故障。

### 7. 请求超时时间（`anythingllm_timeout`）

- **怎么填**：默认 `30000`（30 秒）通常够用。
  - 内网且知识库负载低：`10000`–`15000` 也够
  - 跨公网 / 文档量大：`30000`–`60000`
- **取值范围**：`5000`–`120000` 毫秒，步进 `1000`。
- **注意**：这是**单次请求**的超时。失败重试会让实际等待时间成倍增长（见下一项）。
- **首次查询偏慢是正常的**：需要加载模型，可能 5–10 秒；之后通常 1–3 秒。

### 8. 最大重试次数（`anythingllm_maxRetries`）

- **怎么填**：默认 `3`，保持默认即可。
- **取值范围**：`0`–`5`。
- **作用**：请求失败（超时、网络错误、5xx）时最多额外重试几次，采用指数退避（约 1s → 2s → 4s，单次上限 10s）。
- **注意**：
  - **4xx（如密钥错误、工作区不存在）不会重试**，会立即返回错误——这是刻意设计，避免把明显错误的请求打多次。
  - 设成 `N` 意味着最多发起 `N+1` 次请求，最坏等待 ≈ `超时时间 × (N+1)` + 退避时间，别把超时和重试都调得很大。
  - ⚠️ 已知行为：实现里用了 `||` 兜底默认值，因此**填 `0` 时不会真正关闭重试，实际仍按 3 次执行**。

### 9. 启用查询缓存（`anythingllm_cacheEnable`）

- **怎么填**：建议开启。
- **作用**：相同查询在工作区维度上命中缓存时直接返回，不再请求接口，省时也省 AnythingLLM 的算力。
- **注意**：
  - 缓存是**内存缓存**，重启 Yunzai 后清空。
  - 缓存键为 `工作区slug:查询内容`，所以换工作区问同样的问题不会串味。
  - 缓存条目超过 100 条时会挤掉最早写入的一条。
  - **更新了文档内容后**，旧答案可能仍在缓存期内 —— 想立刻看到新内容，等缓存过期（或重启）再问。

### 10. 缓存有效期（`anythingllm_cacheTTL`）

- **怎么填**：默认 `300000`（5 分钟）即可。
- **取值范围**：`60000`–`3600000` 毫秒，步进 `60000`。
- **怎么调**：
  - 资料更新频繁 → 调小（如 `60000`，1 分钟）
  - 问题高度重复（群内 FAQ） → 可调大（如 `1800000`，30 分钟）
- **注意**：该值仅在「启用查询缓存」开启时有效。

### 配置生效检查清单

依次确认，四项缺一不可：

1. ✅ 锅巴里 `启用 AnythingLLM 知识库` 已开启，且**已重启**
2. ✅ 锅巴里 `智能模式 开关` 已开启
3. ✅ `API 密钥` 已填且无多余空格
4. ✅ `默认工作区` 的 slug 与 AnythingLLM 中完全一致，且该工作区已有 `Ready` 状态的文档

---

## 四、等价 config.json 配置

不使用锅巴时，也可直接编辑 `plugins/chatgpt-plugin/config/config.json`（该文件为运行时生成，**请勿提交到 Git**）。锅巴保存时只写入与默认值不同的项，因此这里的示例是最小写法：

```json
{
  "anythingllm_enable": true,
  "anythingllm_baseUrl": "http://192.168.1.100:3001",
  "anythingllm_apiKey": "ANLM-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "anythingllm_defaultWorkspace": "general-knowledge",
  "anythingllm_mode": "query",
  "anythingllm_includeSources": true,
  "anythingllm_timeout": 30000,
  "anythingllm_maxRetries": 3,
  "anythingllm_cacheEnable": true,
  "anythingllm_cacheTTL": 300000
}
```

各字段默认值：`enable=false`、`baseUrl=http://localhost:3001`、`apiKey=''`、`defaultWorkspace=general-knowledge`、`mode=query`、`includeSources=true`、`timeout=30000`、`maxRetries=3`、`cacheEnable=true`、`cacheTTL=300000`。

改动后仍需重启 Yunzai。

---

## 五、使用方式与场景

### 使用方式

开启智能模式后，直接自然提问即可，Bot 会自行决定是否查知识库：

```
用户：@Bot Docker 容器如何设置环境变量？
用户：@Bot 钟离推荐什么圣遗物？
用户：@Bot 公司的报销流程是什么？
```

需要指定其他工作区时说明白即可：

```
用户：@Bot 查询原神工作区中钟离的信息
```

查询可用工作区：

```
用户：@Bot 列出知识库的所有工作区
用户：@Bot 看看 tech-docs 工作区有多少文档
```

### 典型场景

| 场景 | 工作区示例 | 放什么资料 |
| --- | --- | --- |
| 专业知识问答 | `tech-docs` | 技术手册、部署文档、API 说明 |
| 游戏攻略助手 | `genshin-impact` | 角色图鉴、攻略、配队资料 |
| 企业知识库 | `company-policy` | 规章制度、产品文档、FAQ |
| 学习助手 | `course-materials` | 课件、笔记、习题解析 |

### 多工作区规划

```yaml
工作区规划示例：
- general-knowledge    # 通用知识
- tech-docs            # 技术文档
- genshin-impact       # 原神攻略
- company-policy       # 企业制度
- course-materials     # 课程资料
```

不同主题建不同工作区，检索更准、也更好维护。

---

## 六、常用 Docker 命令与数据备份

### 服务管理

```bash
# 查看容器状态
docker ps | grep anythingllm

# 查看日志（最新 50 行 / 实时）
docker logs anythingllm --tail 50
docker logs -f anythingllm

# 重启 / 停止 / 启动
docker restart anythingllm
docker stop anythingllm
docker start anythingllm

# 查看资源占用
docker stats anythingllm
```

### 删除并重建容器（改端口、改环境变量时）

```bash
# 数据保存在 /opt/anythingllm/storage，删容器不会丢数据
docker stop anythingllm
docker rm anythingllm

docker run -d \
  --name anythingllm \
  --restart unless-stopped \
  -p 3001:3001 \
  -v /opt/anythingllm/storage:/app/server/storage \
  -e STORAGE_DIR="/app/server/storage" \
  -e EMBEDDING_ENGINE="native" \
  -e VECTOR_DB="lancedb" \
  -e DISABLE_TELEMETRY="true" \
  mintplexlabs/anythingllm:latest
```

### 备份与恢复

```bash
# 备份（建议快照前先停止写入，避免备份到半写状态）
tar -czf anythingllm-backup-$(date +%Y%m%d).tar.gz /opt/anythingllm/storage
ls -lh anythingllm-backup-*.tar.gz

# 恢复
docker stop anythingllm
tar -xzf anythingllm-backup-YYYYMMDD.tar.gz -C /   # 会覆盖现有数据
docker start anythingllm
```

---

## 七、故障排查

### 排查总顺序

1. AnythingLLM 容器是否在运行、Web 界面能否打开
2. 插件所在机器能否访问 `服务地址/api/health`
3. 锅巴里的地址 / 密钥 / 工作区 slug 是否与 AnythingLLM 一致
4. 是否已重启 Yunzai、智能模式是否开启
5. 看日志：`tail -f /root/TRSS-Yunzai/logs/command.log`（同时可看 `docker logs anythingllm`）

---

### 问题 1：Web 界面打不开

**症状**：浏览器访问 `http://<服务器IP>:3001` 无响应。

**排查**：

```bash
docker ps | grep anythingllm                 # 1. 容器是否在跑
netstat -tlnp | grep 3001                    # 2. 端口是否监听
docker logs anythingllm --tail 50            # 3. 容器日志
```

**常见原因**：

- 容器未启动 → `docker start anythingllm`
- 防火墙/安全组未放行 3001 → 放行或改用内网
- 端口被占用 → 删容器重建，改用 `-p 3002:3001`（**同时记得更新锅巴里的服务地址**）

---

### 问题 2：报「无法连接到 AnythingLLM 服务」

**症状**：

```
知识库查询失败：无法连接到 AnythingLLM 服务，请检查服务是否正常运行
```

**排查**：

```bash
# 1. 换到插件所在机器执行，确认能否连通
curl http://<服务地址>:3001/api/health

# 2. 校验地址本身
#    协议、端口是否写全？结尾是否多了 "/" 或 "/api"？
```

**常见原因**：

- 地址写成了 `localhost`，但插件与知识库不在同一台机器 → 改成局域网 IP
- 容器没跑 / 端口不通 / 反向代理路径不对
- 填了 `https://` 但服务实际是 http

---

### 问题 3：报「API Key 无效或未授权」

**症状**：

```
知识库查询失败：API Key 无效或未授权，请检查配置
```

**解决**：

1. 确认 API Key 复制完整、**前后无空格或换行**
2. 在 AnythingLLM 中重新生成一个新的 API Key
3. 更新锅巴配置后**重启 Yunzai**
4. 手工验证：
   ```bash
   curl -H "Authorization: Bearer ANLM-xxxxx" http://<服务地址>:3001/api/v1/workspaces
   ```

---

### 问题 4：报「工作区不存在」

**症状**：

```
知识库查询失败：工作区 "xxx" 不存在，请检查配置
```

**解决**：

1. 登录 AnythingLLM，确认工作区确实存在
2. 核对 **slug**（英文标识符，**区分大小写**），而不是显示名称
3. 更新锅巴「默认工作区」并**重启 Yunzai**

---

### 问题 5：查询无结果

**症状**：

```
知识库中未找到与 "xxx" 相关的信息
```

**可能原因与解决**：

1. 工作区里没有相关文档 → 上传资料
2. 文档还在 `Processing` → 等状态变成 `Ready` 再问
3. 关键词不匹配 → 换个更贴近文档原文的问法
4. 选错工作区 → 提问时显式指定工作区

---

### 问题 6：查询超时

**症状**：

```
知识库查询失败：请求超时，请稍后重试或增加超时时间
```

**解决**：

1. 适当调大「请求超时时间」（如 `60000`；上限 120000）
2. 检查网络质量与 AnythingLLM 服务器负载（`docker stats anythingllm`）
3. 首次查询需要加载模型，耐心等一次，后续会快很多

---

### 问题 7：文档上传后一直 Processing

**可能原因**：文档过大（>50MB）、服务器性能不足、Embedding 模型不可用或已更换。

**排查**：

```bash
docker stats anythingllm
docker logs anythingllm --tail 100 | grep -i error
```

**解决**：拆分大文档；确认 Embedding 模型可用（更换过 Embedding 模型会导致旧向量失效，需重新嵌入）。

---

### 问题 8：改了配置但没生效

**排查清单**：

- 锅巴是否点了**保存配置**
- 是否**重启了 Yunzai**（配置在启动时读入内存）
- 「智能模式 开关」是否开启（未开启时 Bot 不会调用任何工具）
- 当前对话是否走了配置对应的模型/模式（工具依赖智能模式链路）

---

## 八、性能优化与使用建议

### 文档管理

- **分类管理**：不同主题建不同工作区（`general-knowledge` / `tech-docs` / `game-guides` …）
- **命名清晰**：`Docker容器化部署指南.pdf` ✅ 优于 `文档1.pdf` ❌（引用来源里会显示文档名，好名字才好认）
- **格式优先**：PDF / Markdown 效果通常好于扫描件
- **定期维护**：及时上传新文档、删除过期内容，单个工作区建议 < 500 个文档、单文件 < 50MB

### 性能

- **启用查询缓存**：重复问题直接命中缓存（默认 5 分钟）
- **超时按需调整**：内网 10–15 秒足够，跨公网 30–60 秒
- **控制文档体量**：删掉无关内容，能明显提升检索质量

---

## 九、注意事项

### 服务器资源

```yaml
最低配置：
  CPU: 2 核
  内存: 4GB
  硬盘: 20GB

推荐配置：
  CPU: 4 核+
  内存: 8GB+
  硬盘: 50GB+（根据文档量）
```

### 安全

- ⚠️ **不要将 API Key 泄露或提交到 Git**，建议定期轮换
- 建议**仅内网访问**知识库，不要直接暴露到公网；确需外网时至少加上 HTTPS 与访问密码
- 定期备份存储目录

### 网络与时延

- 插件所在机器必须能访问 AnythingLLM 的服务地址
- 首次查询需要加载模型，5–10 秒属正常；后续通常 1–3 秒
- 跨公网部署时，注意超时与重试的组合不要设得过于激进

---

## 十、相关资源

- **AnythingLLM 官网**：https://anythingllm.com
- **GitHub 仓库**：https://github.com/Mintplex-Labs/anything-llm
- **官方文档**：https://docs.anythingllm.com
- **API 文档**：https://docs.anythingllm.com/developer/api
- **插件仓库 / Issue**：https://github.com/misaka20002/chatgpt-plugin/issues
- **交流群**：群 1 `285744328`，群 2 `1022982073`
