# ✅ AnythingLLM 部署成功！

## 🎉 部署状态

✅ **容器状态**: `healthy` (运行正常)  
✅ **容器名称**: `anythingllm`  
✅ **容器 ID**: `c3507d4746af`  
✅ **端口映射**: `0.0.0.0:3001->3001/tcp`  
✅ **数据目录**: `/opt/anythingllm/storage`  
✅ **自动重启**: 已启用（`unless-stopped`）

---

## 🌐 访问地址

### 方式 1：本机访问
```
http://localhost:3001
```

### 方式 2：局域网访问（推荐）
```
http://192.168.4.238:3001
```

### 方式 3：外网访问（如果有公网 IP）
```
http://你的公网IP:3001
```

⚠️ **注意**：如果外网无法访问，可能需要在防火墙中开放 3001 端口

---

## 📝 下一步操作（按顺序）

### 步骤 1：首次访问和设置账号 ⭐

1. **打开浏览器**，访问：`http://192.168.4.238:3001`

2. **创建管理员账号**
   - 设置用户名（例如：admin）
   - 设置密码（建议使用强密码）
   - 点击 "Continue"

3. **选择 LLM 提供商（可选）**
   - 这一步可以跳过（Skip）
   - 如果跳过，后续只能使用检索功能，不能在 AnythingLLM 内生成回答
   - **推荐跳过**，因为我们的插件会使用自己的 AI 模型生成回答

4. **选择 Embedding 模型（重要！）** ⭐
   - 选择：**`AnythingLLM Embedder`**（推荐，免费内置）
   - 或者：**`nomic-embed-text`**（如果有更高要求）
   - 点击 "Continue"

5. **选择向量数据库**
   - 选择：**`LanceDB`**（推荐，无需配置）
   - 点击 "Continue"

6. **完成设置**
   - 点击 "Finish Setup"

### 步骤 2：创建工作区 ⭐

1. **点击左侧栏的 "New Workspace"** 按钮

2. **填写工作区信息**
   - **名称**：`通用知识库`（或其他你喜欢的名字）
   - **Slug**（英文标识符）：会自动生成，例如 `general-knowledge`
     - ⚠️ **记住这个 slug**，后面配置插件时需要用到
   - **描述**（可选）：例如 "存储通用知识和常见问题"

3. **保存工作区**

### 步骤 3：上传测试文档 ⭐

1. **进入刚创建的工作区**
   - 点击工作区名称进入

2. **上传文档**
   - 点击右上角的 **"Upload"** 或 **"+ Add Document"** 按钮
   - 选择你的文档文件（支持格式见下方）
   - 点击上传

3. **等待处理完成**
   - 文档上传后会自动进行处理和向量化
   - 处理时间取决于文档大小：
     - 小文档（<1MB）：几秒到几十秒
     - 大文档（1-10MB）：1-3 分钟
   - 等待状态从 "Processing" 变为 "Ready"

4. **支持的文件格式**
   - 📄 文本文档：`.txt`, `.md`
   - 📄 PDF：`.pdf`
   - 📄 Word：`.docx`, `.doc`
   - 📊 表格：`.csv`, `.xlsx`
   - 💻 代码：`.json`, `.js`, `.py` 等
   - 🌐 网页：`.html`

### 步骤 4：生成 API Key ⭐

1. **进入设置页面**
   - 点击左侧栏底部的 **齿轮图标（Settings）**

2. **进入 API Keys 页面**
   - 在左侧菜单中找到 **"API Keys"**
   - 点击进入

3. **生成新的 API Key**
   - 点击 **"Generate New API Key"** 按钮
   - **立即复制并保存 API Key**
   - ⚠️ **重要**：API Key 只会显示一次，关闭后无法再查看！

4. **API Key 格式示例**
   ```
   ANLM-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### 步骤 5：测试知识库查询（可选）

在 AnythingLLM 界面中测试：

1. **进入你的工作区**
2. **在聊天框中输入问题**，例如：
   - "这个文档讲的是什么？"
   - "总结一下主要内容"
3. **查看是否能返回相关内容**

---

## ⚙️ 配置 ChatGPT 插件

### 步骤 1：打开锅巴配置

在 QQ 中发送：
```
#锅巴
```

### 步骤 2：进入 ChatGPT-Plugin 配置

1. 在锅巴界面中找到 **ChatGPT-Plugin**
2. 点击进入配置页面

### 步骤 3：找到 AnythingLLM 配置区域

向下滚动，找到 **"AnythingLLM 知识库"** 分隔符

### 步骤 4：填写配置

| 配置项 | 填写内容 | 说明 |
|--------|---------|------|
| **启用 AnythingLLM 知识库** | ✅ 开启 | 打开功能开关 |
| **AnythingLLM 服务地址** | `http://192.168.4.238:3001` | 使用局域网地址 |
| **API 密钥** | `ANLM-xxxxx...` | 粘贴步骤 4 中复制的 API Key |
| **默认工作区** | `general-knowledge` | 填写步骤 2 中的工作区 slug |
| **查询模式** | `query - 仅检索` | 推荐选择此项 |
| **显示引用来源** | ✅ 开启 | 显示文档来源 |
| **请求超时时间** | `30000` | 保持默认即可 |
| **最大重试次数** | `3` | 保持默认即可 |
| **启用查询缓存** | ✅ 开启 | 提升性能 |
| **缓存有效期** | `300000` | 保持默认（5分钟） |

### 步骤 5：保存并重启

1. **点击页面底部的 "保存配置"**
2. **重启 Yunzai**
   ```bash
   cd /root/TRSS-Yunzai
   pnpm restart
   ```

---

## 🧪 测试集成

重启完成后，在 QQ 中测试：

```
@Bot 什么是 Docker？
```

如果配置成功，Bot 会：
1. 自动调用 `anythingllm_query` 工具
2. 从知识库中检索相关内容
3. 生成回答并附带文档来源

**预期回复示例**：
```
Docker 是一个开源的容器化平台...

📚 参考来源：
1. Docker入门教程.pdf
```

---

## 📊 常用 Docker 命令

### 查看容器状态
```bash
docker ps | grep anythingllm
```

### 查看日志
```bash
# 查看最新 50 行日志
docker logs anythingllm --tail 50

# 实时查看日志
docker logs -f anythingllm
```

### 重启容器
```bash
docker restart anythingllm
```

### 停止容器
```bash
docker stop anythingllm
```

### 启动容器
```bash
docker start anythingllm
```

### 删除容器（慎用！）
```bash
# 停止并删除容器
docker stop anythingllm
docker rm anythingllm

# 数据不会丢失，存储在 /opt/anythingllm/storage
```

### 重新创建容器（如需更改配置）
```bash
# 1. 停止并删除旧容器
docker stop anythingllm
docker rm anythingllm

# 2. 创建新容器（可以修改参数）
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

---

## 📁 数据备份

### 备份知识库数据
```bash
# 创建备份
tar -czf anythingllm-backup-$(date +%Y%m%d).tar.gz /opt/anythingllm/storage

# 备份会保存在当前目录
ls -lh anythingllm-backup-*.tar.gz
```

### 恢复备份
```bash
# 1. 停止容器
docker stop anythingllm

# 2. 解压备份（会覆盖现有数据）
tar -xzf anythingllm-backup-20260615.tar.gz -C /

# 3. 启动容器
docker start anythingllm
```

---

## 🔧 故障排查

### 问题 1：无法访问 Web 界面

**症状**：浏览器打开 `http://192.168.4.238:3001` 无法访问

**排查步骤**：
```bash
# 1. 检查容器是否运行
docker ps | grep anythingllm

# 2. 检查端口是否监听
netstat -tlnp | grep 3001

# 3. 查看容器日志
docker logs anythingllm --tail 50
```

**可能原因**：
- 容器未启动：`docker start anythingllm`
- 防火墙阻止：检查防火墙规则
- 端口被占用：更换端口（删除容器重新创建，使用 `-p 3002:3001`）

### 问题 2：文档上传后一直 Processing

**症状**：文档上传后长时间显示 "Processing"

**可能原因**：
- 文档太大（>50MB）
- 服务器性能不足
- Embedding 模型未正确配置

**解决方案**：
```bash
# 查看容器资源使用
docker stats anythingllm

# 查看日志是否有错误
docker logs anythingllm --tail 100 | grep -i error
```

### 问题 3：插件查询失败

**症状**：Bot 提示 "知识库查询失败"

**排查步骤**：
1. 检查锅巴配置中的服务地址是否正确
2. 检查 API Key 是否正确（无多余空格）
3. 检查工作区 slug 是否正确
4. 查看 Yunzai 日志：`tail -f /root/TRSS-Yunzai/logs/command.log`

**测试连接**：
```bash
# 测试 API 是否可访问（替换成你的 API Key）
curl -H "Authorization: Bearer ANLM-xxxxx" http://192.168.4.238:3001/api/v1/workspaces
```

---

## 💡 使用建议

### 1. 文档管理建议

- **分类管理**：为不同主题创建不同工作区
  - 通用知识：`general-knowledge`
  - 技术文档：`tech-docs`
  - 游戏攻略：`game-guides`
  
- **文档命名**：使用清晰的文件名
  - ✅ 好：`Docker容器化部署指南.pdf`
  - ❌ 差：`文档1.pdf`

- **定期更新**：及时上传新文档，删除过期内容

### 2. 性能优化建议

- 单个工作区文档数量建议 < 500 个
- 单个文档大小建议 < 50MB
- 启用查询缓存（已默认开启）

### 3. 安全建议

- ⚠️ **不要将 API Key 泄露或提交到 Git**
- 建议定期更换 API Key
- 建议仅内网访问（不暴露到公网）
- 定期备份数据

---

## 📚 相关文档

- **使用指南**：`/root/TRSS-Yunzai/plugins/chatgpt-plugin/docs/AnythingLLM使用指南.md`
- **完成报告**：`/root/TRSS-Yunzai/plugins/chatgpt-plugin/docs/AnythingLLM集成完成报告.md`

---

## 🎊 恭喜！

你已经成功部署了 AnythingLLM 知识库系统！

现在可以：
1. ✅ 访问 Web 管理界面
2. ✅ 上传文档到知识库
3. ✅ 配置 ChatGPT 插件
4. ✅ 让 AI 从知识库中检索信息回答问题

---

**部署完成时间**：2026-06-15  
**服务状态**：✅ 运行正常  
**容器 ID**：c3507d4746af  
**访问地址**：http://192.168.4.238:3001
