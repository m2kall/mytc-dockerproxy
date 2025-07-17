/**
 * Container Registry Proxy for Docker Hub on Tencent EdgeOne
 * Handles /v2/ API requests for Docker registry
 */

const UPSTREAM_REGISTRY = 'https://registry-1.docker.io';

// EdgeOne 使用 export default 而不是 addEventListener
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request);
  }
};

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return handleCORS();
  }

  // 如果路径以 /v2/ 开头，这是 Docker API 请求，进行代理
  if (url.pathname.startsWith('/v2/')) {
    return await proxyDockerRequest(request, url);
  }

  // 根路径返回说明页面
  if (url.pathname === '/') {
    return new Response(createLandingPage(url), {
      headers: { 
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      },
    });
  }

  // 其他路径返回 404
  return new Response('Not Found', { 
    status: 404,
    headers: getCORSHeaders()
  });
}

async function proxyDockerRequest(request, url) {
  try {
    // 构建上游请求 URL
    const upstreamUrl = new URL(url.pathname + url.search, UPSTREAM_REGISTRY);
    
    // 创建新的请求头，移除一些可能导致问题的头部
    const newHeaders = new Headers();
    
    // 复制必要的请求头
    for (const [key, value] of request.headers.entries()) {
      // 跳过一些可能导致问题的头部
      if (!['host', 'origin', 'referer'].includes(key.toLowerCase())) {
        newHeaders.set(key, value);
      }
    }
    
    // 设置正确的 Host 头
    newHeaders.set('Host', 'registry-1.docker.io');
    
    // 创建代理请求
    const proxyRequest = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
    });

    // 发送请求到上游服务器
    const response = await fetch(proxyRequest);
    
    // 创建响应头
    const responseHeaders = new Headers();
    
    // 复制响应头
    for (const [key, value] of response.headers.entries()) {
      responseHeaders.set(key, value);
    }
    
    // 添加 CORS 头
    const corsHeaders = getCORSHeaders();
    for (const [key, value] of corsHeaders.entries()) {
      responseHeaders.set(key, value);
    }
    
    // 处理重定向响应中的 Location 头
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location && location.includes('registry-1.docker.io')) {
        const newLocation = location.replace('https://registry-1.docker.io', '');
        responseHeaders.set('Location', newLocation);
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
    
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response('Proxy Error: ' + error.message, { 
      status: 500,
      headers: getCORSHeaders()
    });
  }
}

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(),
  });
}

function getCORSHeaders() {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Docker-Content-Digest, Docker-Distribution-Api-Version',
    'Access-Control-Expose-Headers': 'Docker-Content-Digest, Docker-Distribution-Api-Version, Www-Authenticate, Location',
    'Access-Control-Max-Age': '86400',
  });
}

function createLandingPage(url) {
  const proxyHost = url.hostname;
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Docker Hub 代理服务</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      line-height: 1.6; 
      padding: 2em; 
      max-width: 800px; 
      margin: auto; 
      background-color: #f5f5f5;
    }
    .container {
      background: white;
      padding: 2em;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 { 
      text-align: center; 
      color: #2c3e50;
      margin-bottom: 1em;
    }
    code { 
      background-color: #f8f9fa; 
      padding: 0.2em 0.4em; 
      border-radius: 3px; 
      font-family: 'Monaco', 'Consolas', monospace;
      color: #e74c3c;
    }
    .usage { 
      background-color: #f8f9fa; 
      border-left: 4px solid #3498db;
      padding: 1em 1.5em; 
      margin: 1em 0;
    }
    pre {
      background-color: #2c3e50;
      color: #ecf0f1;
      padding: 1em;
      border-radius: 5px;
      overflow-x: auto;
    }
    .status {
      text-align: center;
      color: #27ae60;
      font-weight: bold;
      margin-bottom: 1em;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐳 Docker Hub 代理服务</h1>
    <div class="status">✅ 服务运行正常</div>
    
    <p>这是一个 Docker Hub 镜像代理服务，可以帮助您更快地拉取 Docker 镜像。</p>
    
    <div class="usage">
      <h2>📖 使用方法</h2>
      <p>在 Docker 镜像名称前添加代理地址 <code>${proxyHost}</code></p>
      
      <h3>示例：</h3>
      <pre><code># 拉取 Ubuntu 镜像
docker pull ${proxyHost}/library/ubuntu:latest

# 拉取 Nginx 镜像  
docker pull ${proxyHost}/library/nginx:alpine

# 拉取用户镜像
docker pull ${proxyHost}/username/imagename:tag</code></pre>
      
      <h3>🔧 配置 Docker 守护进程（可选）</h3>
      <p>您也可以配置 Docker 守护进程使用此代理：</p>
      <pre><code># 编辑 /etc/docker/daemon.json
{
  "registry-mirrors": ["https://${proxyHost}"]
}</code></pre>
    </div>
    
    <div class="usage">
      <h2>ℹ️ 说明</h2>
      <p>• 此服务代理 Docker Hub 官方镜像仓库</p>
      <p>• 支持所有 Docker Registry API v2 操作</p>
      <p>• 自动处理认证和重定向</p>
      <p>• 提供 CORS 支持</p>
    </div>
  </div>
</body>
</html>
  `;
}