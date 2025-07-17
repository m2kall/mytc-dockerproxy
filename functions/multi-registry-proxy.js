/**
 * Multi-Registry Container Registry Proxy for Tencent EdgeOne Pages Functions
 *
 * Supports:
 * - Docker Hub (default)
 * - Google Container Registry (gcr.io, k8s.gcr.io)
 * - Quay.io
 * - GitHub Container Registry (ghcr.io)
 */

// --- Configuration ---

// Add or remove registries here
const PROXY_MAP = {
  // "hostname": "https://hostname"
  "gcr.io": "https://gcr.io",
  "k8s.gcr.io": "https://k8s.gcr.io",
  "quay.io": "https://quay.io",
  "ghcr.io": "https://ghcr.io",
};

const DOCKER_HUB_REGISTRY = "https://registry-1.docker.io";
const DOCKER_HUB_HOST = "registry-1.docker.io";

// Map of service hostnames to their authentication realms
const AUTH_REALMS = {
  "registry.docker.io": "https://auth.docker.io/token",
  "gcr.io": "https://gcr.io/v2/token",
  "k8s.gcr.io": "https://k8s.gcr.io/v2/token",
  "quay.io": "https://quay.io/v2/auth",
  "ghcr.io": "https://ghcr.io/token",
};

// --- Entry Point ---

export async function onRequest(context) {
  const { request } = context;
  return handleRequest(request);
}

// --- Request Routing ---

async function handleRequest(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return handleCORS();
  }

  if (url.pathname.startsWith("/v2/auth")) {
    return handleAuth(request);
  }

  if (url.pathname.startsWith("/v2/")) {
    return proxyRequest(request, url);
  }

  if (url.pathname === "/v2") {
    return Response.redirect(new URL("/v2/", request.url).toString(), 301);
  }

  if (url.pathname === "/" || url.pathname === "") {
    return new Response(createLandingPage(url), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  return new Response("Not Found", {
    status: 404,
    headers: getCORSHeaders(),
  });
}

// --- Authentication Handler ---

async function handleAuth(request) {
  const url = new URL(request.url);
  const service = url.searchParams.get("service");
  const scope = url.searchParams.get("scope");

  if (!service) {
    return new Response("Missing 'service' parameter in auth request", {
      status: 400,
    });
  }

  const upstreamAuthUrl = AUTH_REALMS[service];

  if (!upstreamAuthUrl) {
    return new Response(`Unsupported auth service: ${service}`, {
      status: 400,
    });
  }

  const authUrl = new URL(upstreamAuthUrl);
  if (scope) authUrl.searchParams.set("scope", scope);
  if (service) authUrl.searchParams.set("service", service);

  // Forward the auth request to the real auth server
  const authRequest = new Request(authUrl.toString(), {
    headers: request.headers, // Pass through headers like Authorization
  });

  return fetch(authRequest);
}

// --- Main Proxy Logic ---

async function proxyRequest(request, url) {
  try {
    const { upstreamUrl, upstreamHost } = getUpstreamInfo(url.pathname);

    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.set("Host", upstreamHost);
    proxyHeaders.set("User-Agent", "Docker/20.10.0 (linux)");

    const proxyRequest = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers: proxyHeaders,
      body:
        request.method !== "GET" && request.method !== "HEAD"
          ? request.body
          : null,
    });

    const response = await fetch(proxyRequest);
    const responseHeaders = new Headers(response.headers);

    // Add CORS headers
    const corsHeaders = getCORSHeaders();
    for (const [key, value] of corsHeaders.entries()) {
      responseHeaders.set(key, value);
    }

    // Rewrite Location header to point to our proxy
    const location = response.headers.get("Location");
    if (location) {
      const newLocation = location.replace(
        `https://${upstreamHost}`,
        `https://${url.hostname}`
      );
      responseHeaders.set("Location", newLocation);
    }

    // Robustly rewrite the Www-Authenticate header
    const wwwAuth = response.headers.get("Www-Authenticate");
    if (wwwAuth) {
      const authType = wwwAuth.split(" ")[0]; // "Bearer"
      const params = {};
      const paramRegex = /([a-zA-Z_]+)="([^"]*)"/g;
      let match;
      while ((match = paramRegex.exec(wwwAuth)) !== null) {
        params[match[1]] = match[2];
      }

      if (params.realm) {
        params.realm = `https://${url.hostname}/v2/auth`;
        const newParams = Object.entries(params)
          .map(([key, value]) => `${key}="${value}"`)
          .join(",");
        const newWwwAuth = `${authType} ${newParams}`;
        responseHeaders.set("Www-Authenticate", newWwwAuth);
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return new Response(
      JSON.stringify({
        error: "Proxy Error",
        message: error.message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...Object.fromEntries(getCORSHeaders()),
        },
      }
    );
  }
}

// --- Helper Functions ---

function getUpstreamInfo(pathname) {
  let path = pathname.replace(/^\/v2\//, "");
  const parts = path.split("/");
  const potentialRegistry = parts[0];

  // If the first path component looks like a hostname, use it as the upstream
  if (PROXY_MAP[potentialRegistry]) {
    const upstreamHost = potentialRegistry;
    const upstreamRegistry = PROXY_MAP[upstreamHost];
    const imagePath = parts.slice(1).join("/");
    const upstreamUrl = new URL(`/v2/${imagePath}`, upstreamRegistry);
    return { upstreamUrl, upstreamHost };
  }

  // Default to Docker Hub
  const upstreamHost = DOCKER_HUB_HOST;
  const upstreamRegistry = DOCKER_HUB_REGISTRY;

  // For official Docker Hub images, prepend 'library/' if missing
  const manifestIndex = parts.indexOf("manifests");
  const blobsIndex = parts.indexOf("blobs");
  const tagsIndex = parts.indexOf("tags");

  let imageNameParts;
  if (manifestIndex !== -1) imageNameParts = parts.slice(0, manifestIndex);
  else if (blobsIndex !== -1) imageNameParts = parts.slice(0, blobsIndex);
  else if (tagsIndex !== -1) imageNameParts = parts.slice(0, tagsIndex);
  else imageNameParts = [];

  if (imageNameParts.length === 1 && imageNameParts[0]) {
    path = `library/${path}`;
  }

  const upstreamUrl = new URL(`/v2/${path}`, upstreamRegistry);
  return { upstreamUrl, upstreamHost };
}

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(),
  });
}

function getCORSHeaders() {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Docker-Content-Digest, Docker-Distribution-Api-Version, Accept, Accept-Encoding",
    "Access-Control-Expose-Headers":
      "Docker-Content-Digest, Docker-Distribution-Api-Version, Www-Authenticate, Location, Content-Length, Content-Type",
    "Access-Control-Max-Age": "86400",
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
  <title>多仓库容器镜像代理</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; padding: 2em; max-width: 800px; margin: auto; background-color: #f5f5f5; }
    .container { background: white; padding: 2em; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { text-align: center; color: #2c3e50; margin-bottom: 1em; }
    code { background-color: #f8f9fa; padding: 0.2em 0.4em; border-radius: 3px; font-family: 'Monaco', 'Consolas', monospace; color: #e74c3c; }
    .usage { background-color: #f8f9fa; border-left: 4px solid #3498db; padding: 1em 1.5em; margin: 1em 0; }
    pre { background-color: #2c3e50; color: #ecf0f1; padding: 1em; border-radius: 5px; overflow-x: auto; }
    .status { text-align: center; color: #27ae60; font-weight: bold; margin-bottom: 1em; }
    .supported { background-color: #e7f3fe; border-left: 4px solid #2980b9; padding: 1em 1.5em; margin: 1em 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 多仓库容器镜像代理</h1>
    <div class="status">✅ 服务运行正常</div>
    
    <p>这是一个基于腾讯云 EdgeOne Pages Functions 的多仓库容器镜像代理服务。</p>
    
    <div class="supported">
      <h3>📦 支持的仓库</h3>
      <ul>
        <li>Docker Hub (默认)</li>
        <li>Google Container Registry (<code>gcr.io</code>, <code>k8s.gcr.io</code>)</li>
        <li>Quay.io (<code>quay.io</code>)</li>
        <li>GitHub Container Registry (<code>ghcr.io</code>)</li>
      </ul>
    </div>

    <div class="usage">
      <h2>📖 使用方法</h2>
      
      <h3>方法一：配置镜像源（仅对 Docker Hub 有效）</h3>
      <p>编辑 <code>/etc/docker/daemon.json</code>：</p>
      <pre><code>{
  "registry-mirrors": ["https://${proxyHost}"]
}</code></pre>
      <p>然后重启 Docker：<code>sudo systemctl restart docker</code></p>
      
      <h3>方法二：按需拉取（推荐）</h3>
      <p>在镜像名称前加上代理地址和仓库地址（如果不是 Docker Hub）。</p>
      
      <h4>Docker Hub</h4>
      <pre><code># 拉取官方镜像 (library/ubuntu)
docker pull ${proxyHost}/ubuntu:latest</code></pre>

      <h4>Google Container Registry (gcr.io)</h4>
      <pre><code># gcr.io/google-containers/busybox
docker pull ${proxyHost}/gcr.io/google-containers/busybox</code></pre>

      <h4>Quay.io</h4>
      <pre><code># quay.io/coreos/etcd
docker pull ${proxyHost}/quay.io/coreos/etcd</code></pre>

      <h4>GitHub Container Registry (ghcr.io)</h4>
      <pre><code># ghcr.io/home-assistant/home-assistant
docker pull ${proxyHost}/ghcr.io/home-assistant/home-assistant:stable</code></pre>
    </div>
    
    <div class="usage">
      <h2>ℹ️ 技术信息</h2>
      <p>• 自动处理上游认证和重定向</p>
      <p>• 支持完整的 Docker Registry API v2</p>
    </div>
  </div>
</body>
</html>
  `;
}
