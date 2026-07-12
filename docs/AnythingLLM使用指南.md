# AnythingLLM 知识库集成使用指南

## 📚 功能简介

AnythingLLM 是一个私有化的 RAG（检索增强生成）知识库系统，集成后可以让你的 AI 从文档库中检索相关知识来回答问题。

### 核心特性
- ✅ 支持多种文档格式（PDF、TXT、MD、DOCX、CSV 等）
- ✅ 向量化检索，快速找到相关内容
- ✅ 多工作区管理，不同主题独立存储
- ✅ 自动引用来源，可追溯答案出处
- ✅ 查询缓存，提升响应速度

---

## 🚀 快速开始

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
  mintplexlabs/anythingllm:latest

# 3. 查看日志确认启动成功
docker logs -f anythingllm

# 4. 浏览器访问
# 打开 http://your-server-ip:3001
```

#### 方式 2：Docker Compose（生产环境推荐）

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

启动：
```bash
docker-compose up -d
```

### 第二步：初始化 AnythingLLM

1. **访问管理界面**
   - 打开浏览器访问：`http://your-server-ip:3001`

2. **首次设置**
   - 创建管理员账号
   - 选择 Embedding 模型：推荐 `nomic-embed-text`（支持中文）
   - 选择向量数据库：推荐 `LanceDB`（无需额外配置）

3. **生成 API Key**
   - 登录后进入：Settings → API Keys
   - 点击 "Generate New API Key"
   - 复制并保存 API Key（后续配置需要）

4. **创建工作区**
   - 点击左侧 "New Workspace"
   - 输入工作区名称，例如：`通用知识库`
   - 工作区 slug（英文标识符）会自动生成，例如：`general-knowledge`
   - 保存工作区

5. **上传文档**
   - 进入刚创建的工作区
   - 点击 "Upload Documents"
   - 选择文档上传（支持 PDF、TXT、MD、DOCX 等）
   - 等待文档处理完成（会自动向量化）

### 第三步：配置 ChatGPT 插件

1. **打开锅巴配置**
   - 发送：`#锅巴`
   - 进入 ChatGPT-Plugin 配置页面

2. **找到 AnythingLLM 配置区域**
   - 向下滚动找到 "AnythingLLM 知识库" 分隔符

3. **填写配置项**

   | 配置项 | 说明 | 示例值 |
   |--------|------|--------|
   | 启用 AnythingLLM 知识库 | 开启功能 | ✅ 开启 |
   | AnythingLLM 服务地址 | 服务完整地址 | `http://localhost:3001` |
   | API 密钥 | 在 AnythingLLM 中生成的 API Key | `ANLM-xxxxx...` |
   | 默认工作区 | 默认使用的工作区 slug | `general-knowledge` |
   | 查询模式 | 推荐选择 `query` | `query - 仅检索` |
   | 显示引用来源 | 是否显示文档来源 | ✅ 开启 |

4. **保存并重启**
   - 点击 "保存配置"
   - 重启 Yunzai：`pnpm restart`

### 第四步：测试功能

发送测试消息（需要 @ 机器人或使用触发前缀）：

```
用户：我想了解一下原神中钟离的元素战技
Bot：根据知识库内容...
     📚 参考来源：
     1. 原神角色图鉴.pdf
```

---

## ⚙️ 配置详解

### 查询模式选择

| 模式 | 说明 | 推荐场景 |
|------|------|----------|
| **query（仅检索）** | 只返回相关文档片段，由你的 AI 模型（OpenAI/Gemini 等）生成回答 | ✅ 推荐：AI 模型能力强，回答更灵活 |
| **chat（带上下文对话）** | 由 AnythingLLM 内置 LLM 生成完整回答 | 需要在 AnythingLLM 中配置 LLM 才能使用 |

### 缓存配置

- **启用查询缓存**：开启后相同查询会使用缓存结果
- **缓存有效期**：默认 5 分钟（300000 毫秒）
- **适用场景**：高频重复查询，减少 API 调用

---

## 📖 使用场景

### 1. 专业知识问答

**场景**：回答专业领域问题

**步骤**：
1. 创建专业领域工作区（如 `tech-docs`）
2. 上传相关技术文档
3. AI 会自动从文档中检索答案

**示例**：
```
用户：Docker 容器如何设置环境变量？
Bot：根据技术文档，Docker 容器可以通过以下方式设置环境变量...
     📚 参考来源：
     1. Docker 使用手册.pdf
```

### 2. 游戏攻略助手

**场景**：原神、星铁等游戏攻略查询

**步骤**：
1. 创建游戏专属工作区（如 `genshin-impact`）
2. 上传角色资料、攻略文档
3. AI 成为游戏知识专家

**示例**：
```
用户：钟离推荐什么圣遗物？
Bot：根据攻略资料，钟离推荐...
```

### 3. 企业知识库

**场景**：公司内部知识管理

**步骤**：
1. 创建企业知识库工作区
2. 上传规章制度、产品文档、FAQ 等
3. AI 成为智能客服

### 4. 学习助手

**场景**：课程资料查询

**步骤**：
1. 创建学科工作区（如 `math-courses`）
2. 上传课件、笔记
3. AI 辅助学习答疑

---

## 🛠️ 高级使用

### 多工作区管理

**创建多个工作区**以隔离不同主题：

```yaml
工作区规划示例：
- general-knowledge    # 通用知识
- genshin-impact       # 原神攻略
- tech-docs           # 技术文档
- company-policy      # 企业制度
- course-materials    # 课程资料
```

**在查询时指定工作区**（工具会自动识别）：
```
用户：查询原神工作区中钟离的信息
Bot：[自动使用 genshin-impact 工作区]
```

### 文档管理建议

1. **文档命名规范**
   - 使用有意义的文件名
   - 例如：`原神-钟离-角色攻略.pdf`

2. **定期更新**
   - 及时上传新文档
   - 删除过时内容

3. **文档格式**
   - 优先使用 PDF、Markdown
   - 确保文档内容结构清晰

4. **文档大小**
   - 单个文件建议不超过 50MB
   - 大文件可能影响处理速度

---

## ⚠️ 注意事项

### 1. 服务器资源要求

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

### 2. 首次查询较慢

- 首次查询需要加载模型，可能需要 5-10 秒
- 后续查询会快很多（通常 1-3 秒）

### 3. API Key 安全

- ⚠️ 不要将 API Key 泄露或提交到 Git
- 定期轮换 API Key
- 仅在受信任环境使用

### 4. 网络要求

- Yunzai 服务器需要能访问 AnythingLLM 服务
- 建议内网部署，提高安全性和速度
- 如果使用外网访问，建议配置 HTTPS + 密码

### 5. 文档处理时间

| 文档大小 | 处理时间 |
|---------|---------|
| < 1MB   | 几秒钟 |
| 1-10MB  | 10-30 秒 |
| 10-50MB | 1-3 分钟 |
| > 50MB  | 可能较长，建议拆分 |

---

## 🐛 故障排查

### 问题 1：无法连接到 AnythingLLM 服务

**症状**：
```
知识库查询失败：无法连接到 AnythingLLM 服务，请检查服务是否正常运行
```

**排查步骤**：
```bash
# 1. 检查服务是否运行
docker ps | grep anythingllm

# 2. 检查端口是否开放
curl http://localhost:3001/api/health

# 3. 查看日志
docker logs anythingllm

# 4. 检查防火墙
# 确保 3001 端口可访问
```

### 问题 2：API Key 无效

**症状**：
```
知识库查询失败：API Key 无效或未授权，请检查配置
```

**解决方案**：
1. 确认 API Key 是否正确复制（无多余空格）
2. 在 AnythingLLM 中重新生成 API Key
3. 更新锅巴配置中的 API Key
4. 重启 Yunzai

### 问题 3：工作区不存在

**症状**：
```
知识库查询失败：工作区 "xxx" 不存在，请检查配置
```

**解决方案**：
1. 登录 AnythingLLM 管理界面
2. 检查工作区 slug 是否正确（区分大小写）
3. 更新锅巴配置中的默认工作区
4. 重启 Yunzai

### 问题 4：查询无结果

**症状**：
```
知识库中未找到与 "xxx" 相关的信息
```

**可能原因**：
1. 工作区中没有相关文档
2. 文档尚未处理完成
3. 查询关键词不准确

**解决方案**：
1. 上传相关文档到工作区
2. 等待文档处理完成（查看 AnythingLLM 界面）
3. 换个关键词重新提问

### 问题 5：查询超时

**症状**：
```
知识库查询失败：请求超时，请稍后重试或增加超时时间
```

**解决方案**：
1. 在锅巴配置中增加超时时间（如 60000ms）
2. 检查网络连接
3. 检查 AnythingLLM 服务器负载

---

## 📊 性能优化

### 1. 启用查询缓存

- 相同查询直接返回缓存结果
- 适用于高频重复查询
- 默认缓存 5 分钟

### 2. 调整超时时间

- 根据网络状况调整
- 内网部署：10-15 秒足够
- 外网访问：30-60 秒

### 3. 文档优化

- 删除无关内容
- 保持文档数量合理（单个工作区 < 500 个文档）
- 定期清理过期文档

---

## 🔗 相关资源

- **AnythingLLM 官网**：https://anythingllm.com
- **GitHub 仓库**：https://github.com/Mintplex-Labs/anything-llm
- **官方文档**：https://docs.anythingllm.com
- **API 文档**：https://docs.anythingllm.com/developer/api

---

## 💬 技术支持

如有问题，欢迎加入交流群：
- 群 1：285744328
- 群 2：1022982073

或在 GitHub 提交 Issue：
https://github.com/misaka20002/chatgpt-plugin/issues
