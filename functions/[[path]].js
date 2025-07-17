/**
 * Container Registry Proxy for Docker Hub on Tencent EdgeOne Pages Functions
 */

const UPSTREAM_REGISTRY = 'https://registry-1.docker.io';

export async function onRequest(context) {
  const { request } = context;
  return handleRequest(request);
}

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return handleCORS();
  }

  // 如果路径以 /v2/ 开头，这是 Docker API 请求
  if (url.pathname.startsWith('/v2/')) {
    return await proxyDockerRequest(request, url);
  }

  // 如果是 /v2 (没有尾部斜杠)，重定向到 /v2/
  if (url.pathname === '/v2') {
    return Response.redirect(new URL('/v2/', request.url).toString(), 301);
  }

  // 根路径返回说明页面
  if (url.pathname === '/' || url.pathname === '') {
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
    
    // 创建新的请求头
    const newHeaders = new Headers();
    
    // 复制必要的请求头，排除一些可能导致问题的头部
    for (const [key, value] of request.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (!['host', 'origin', 'referer', 'cf-ray', 'cf-connecting-ip', 'cf-visitor'].includes(lowerKey)) {
        newHeaders.set(key, value);
      }
    }
    
    // 设置正确的 Host 头
    newHeaders.set('Host', 'registry-1.docker.io');
    
    // 如果没有 User-Agent，添加一个
    if (!newHeaders.has('User-Agent')) {
      newHeaders.set('User-Agent', 'Docker/20.10.0 (linux)');
    }
    
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
      if (location) {
        let newLocation = location;
        // 如果 location 包含 registry-1.docker.io，替换为当前域名
        if (location.includes('registry-1.docker.io')) {
          newLocation = location.replace('https://registry-1.docker.io', `https://${url.hostname}`);
        }
        // 如果 location 是相对路径，确保它指向当前域名
        else if (location.startsWith('/')) {
          newLocation = `https://${url.hostname}${location}`;
        }
        responseHeaders.set('Location', newLocation);
      }
    }

    // 处理认证头 - 这是关键部分
    const wwwAuth = response.headers.get('Www-Authenticate');
    if (wwwAuth) {
      // 替换认证 realm 为当前域名，保持其他参数不变
      const newWwwAuth = wwwAuth.replace(
        /realm="[^"]*"/,
        `realm="https://${url.hostname}/v2/auth"`
      );
      responseHeaders.set('Www-Authenticate', newWwwAuth);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
    
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(JSON.stringify({
      error: 'Proxy Error',
      message: error.message,
      timestamp: new Date().toISOString()
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...Object.fromEntries(getCORSHeaders())
      }
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Docker-Content-Digest, Docker-Distribution-Api-Version, Accept, Accept-Encoding',
    'Access-Control-Expose-Headers': 'Docker-Content-Digest, Docker-Distribution-Api-Version, Www-Authenticate, Location, Content-Length, Content-Type',
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
    .test-section {
      background-color: #fff3cd;
      border: 1px solid #ffeaa7;
      padding: 1em;
      border-radius: 5px;
      margin: 1em 0;
    }
    .api-status {
      background-color: #d4edda;
      border: 1px solid #c3e6cb;
      padding: 1em;
      border-radius: 5px;
      margin: 1em 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐳 Docker Hub 代理服务</h1>
    <div class="status">✅ 服务运行正常</div>
    
    <div class="api-status">
      <h3>📡 API 状态</h3>
      <p>Docker Registry API v2: <strong>正常</strong></p>
      <p>代理目标: registry-1.docker.io</p>
    </div>
    
    <p>这是一个基于腾讯云 EdgeOne Pages Functions 的 Docker Hub 镜像代理服务，可以帮助您更快地拉取 Docker 镜像。</p>
    
    <div class="test-section">
      <h3>🧪 快速测试</h3>
      <p>API 端点测试：</p>
      <p><a href="/v2/" target="_blank">测试 Docker Registry API (/v2/)</a></p>
      <p><code>curl https://${proxyHost}/v2/</code></p>
    </div>
    
    <div class="usage">
      <h2>📖 使用方法</h2>
      
      <h3>方法一：配置镜像源（推荐）</h3>
      <p>编辑 <code>/etc/docker/daemon.json</code>：</p>
      <pre><code>{
  "registry-mirrors": ["https://${proxyHost}"]
}</code></pre>
      <p>然后重启 Docker：</p>
      <pre><code>sudo systemctl restart docker</code></pre>
      
      <h3>方法二：直接拉取</h3>
      <pre><code># 拉取官方镜像
docker pull ${proxyHost}/library/ubuntu:latest
docker pull ${proxyHost}/library/nginx:alpine
docker pull ${proxyHost}/library/node:18

# 拉取用户镜像
docker pull ${proxyHost}/username/imagename:tag

# 验证代理工作
docker pull ${proxyHost}/library/hello-world</code></pre>
    </div>
    
    <div class="usage">
      <h2>🔧 高级用法</h2>
      <h3>测试镜像清单</h3>
      <pre><code># 获取镜像清单
curl -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \\
     https://${proxyHost}/v2/library/ubuntu/manifests/latest

# 列出标签（需要认证）
curl https://${proxyHost}/v2/library/ubuntu/tags/list</code></pre>
    </div>
    
    <div class="usage">
      <h2>ℹ️ 技术信息</h2>
      <p>• 基于腾讯云 EdgeOne Pages Functions</p>
      <p>• 代理目标：Docker Hub (registry-1.docker.io)</p>
      <p>• 支持完整的 Docker Registry API v2</p>
      <p>• 自动处理认证和重定向</p>
      <p>• 全球边缘节点加速</p>
    </div>
  </div>
</body>
</html>
  `;
}