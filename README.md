```markdown
# Docker Registry Proxy for Tencent EdgeOne

这是一个专为腾讯云 EdgeOne Edge Functions 设计的 Docker Registry 代理服务。它可以帮助加速 Docker 镜像的拉取，特别适合在中国大陆地区使用。

## 功能特性

- **Docker Hub 代理**：提供 Docker Hub 官方镜像仓库的代理访问
- **完整的 Registry API v2 支持**：支持所有 Docker Registry API v2 操作
- **自动认证处理**：自动处理 Docker 认证流程和重定向
- **CORS 支持**：完整的跨域资源共享支持
- **无状态设计**：代理服务本身不存储任何数据
- **边缘计算**：基于腾讯云 EdgeOne 的全球边缘节点

## 部署步骤

### 1. 准备文件

确保你的项目包含以下文件：
```
├── index.js          # 主要的代理逻辑
├── package.json      # 项目配置
└── edgeone.json      # EdgeOne 配置文件
```

### 2. 部署到 EdgeOne

1. 登录 [腾讯云 EdgeOne 控制台](https://console.cloud.tencent.com/edgeone)
2. 选择你的站点，进入 "Edge Functions" 页面
3. 创建新的 Edge Function
4. 上传项目文件或直接粘贴代码
5. 配置触发规则，建议设置为 `/*` 匹配所有路径
6. 保存并发布

### 3. 配置域名

1. 在 EdgeOne 控制台绑定你的自定义域名
2. 确保域名已正确解析到 EdgeOne
3. 配置 HTTPS 证书（推荐）

## 使用方法

部署完成后，你可以通过以下两种方式使用代理：

### 方式一：配置 Docker 镜像源（推荐）

编辑 Docker 守护进程配置文件 `/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": ["https://your-domain.com"]
}
```

然后重启 Docker 服务：

```bash
sudo systemctl restart docker
```

### 方式二：直接拉取镜像

在镜像名称前添加你的代理域名：

```bash
# 拉取官方镜像
docker pull your-domain.com/library/ubuntu:latest
docker pull your-domain.com/library/nginx:alpine
docker pull your-domain.com/library/node:18

# 拉取用户镜像
docker pull your-domain.com/username/imagename:tag

# 验证服务状态
curl https://your-domain.com/v2/
```

## 配置说明

### edgeone.json
```json
{
  "functions": {
    "entryPoint": "index.js"
  }
}
```

### package.json
```json
{
  "name": "docker-registry-proxy",
  "version": "1.0.0",
  "description": "EdgeOne Edge Functions Docker Registry Proxy",
  "main": "index.js",
  "type": "module",
  "license": "MIT"
}
```

## 工作原理

1. **请求拦截**：Edge Function 拦截所有发往代理域名的请求
2. **路径解析**：解析请求路径，识别 Docker Registry API 调用
3. **请求转发**：将请求转发到 Docker Hub 官方注册表 (`registry-1.docker.io`)
4. **认证处理**：自动处理 Docker 认证流程，包括 `Www-Authenticate` 头的重写
5. **响应代理**：将上游响应返回给 Docker 客户端，同时添加必要的 CORS 头

## 支持的操作

- ✅ 镜像拉取 (`docker pull`)
- ✅ 镜像推送 (`docker push`) - 需要认证
- ✅ 镜像清单查询
- ✅ 镜像层下载
- ✅ 认证流程
- ✅ 重定向处理

## 故障排除

### 常见问题

1. **无法访问服务**
   - 检查域名是否正确解析
   - 确认 EdgeOne 函数已正确部署
   - 查看 EdgeOne 控制台的日志

2. **Docker 拉取失败**
   - 确认 Docker 守护进程配置正确
   - 检查网络连接
   - 尝试直接访问代理 URL

3. **认证问题**
   - 确保使用 HTTPS 协议
   - 检查 Docker 客户端版本兼容性

### 调试方法

```bash
# 测试代理服务是否正常
curl -I https://your-domain.com/

# 测试 Docker Registry API
curl https://your-domain.com/v2/

# 查看镜像清单
curl -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
     https://your-domain.com/v2/library/ubuntu/manifests/latest
```

## 性能优化

- **边缘缓存**：EdgeOne 自动在全球边缘节点缓存响应
- **智能路由**：请求自动路由到最近的边缘节点
- **压缩传输**：自动启用 Gzip 压缩减少传输时间

## 安全考虑

- 建议使用 HTTPS 协议
- 可以配置访问控制规则限制使用范围
- 定期检查 EdgeOne 访问日志

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。

## 相关链接

- [腾讯云 EdgeOne 文档](https://cloud.tencent.com/document/product/1552)
- [Docker Registry API 文档](https://docs.docker.com/registry/spec/api/)
- [Docker 官方镜像列表](https://hub.docker.com/search?q=&type=image&image_filter=official)
