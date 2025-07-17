```markdown
# Docker Registry Proxy for Serverless Platforms

This project provides a serverless function that acts as a Docker Registry proxy. It's designed to be deployed on platforms like Tencent Cloud SCF, AWS Lambda, or Cloudflare Workers. It helps accelerate Docker image pulls by caching layers and manifests.

## Features

- **Registry Mirroring:** Can be used as a `registry-mirror` in your Docker configuration.
- **Multi-Registry Support:** Proxies requests to Docker Hub, GCR, Quay, and other major registries.
- **Automatic Fallback:** Switches to a fallback mirror if the primary registry is unavailable.
- **Configurable:** All major settings can be configured via environment variables.
- **Stateless:** The proxy itself is stateless and does not store any data.

## Deployment

This function is designed for serverless platforms. Here are the general steps to deploy it:

1. **Package the code:** Create a zip archive containing `index.js` and `node_modules` (if you add any dependencies).
2. **Upload to your platform:**
   - **Tencent Cloud SCF:** Create a new function, upload the zip file, and configure the handler to be `index.main_handler`.
   - **AWS Lambda:** Create a new function, upload the zip file, and set the handler to `index.main_handler`.
3. **Set Environment Variables:** Configure the environment variables as described below.
4. **Expose via an API Gateway:** Configure an API Gateway to trigger your function on HTTP requests.

## Configuration

The proxy is configured through environment variables:

- `DOCKER_REGISTRY_MAP`: A JSON string mapping registry hostnames to their upstream proxy URLs. 
  - Default: `{"docker.io":"registry-1.docker.io","gcr.io":"gcr.io","registry.k8s.io":"registry.k8s.io","quay.io":"quay.io","ghcr.io":"ghcr.io","mcr.microsoft.com":"mcr.microsoft.com","public.ecr.aws":"public.ecr.aws","default":"registry-1.docker.io"}`
- `FALLBACK_REGISTRY_MAP`: A JSON string for fallback registries when the primary one fails.
  - Default: `{"registry-1.docker.io":"mirror.gcr.io","gcr.io":"gcrprod-mirror.qiniu.io","default":"mirror.gcr.io"}`
- `DOCKER_HUB_OFFICIAL_IMAGES`: A JSON string array of official Docker Hub image names.
  - Default: `["alpine","busybox", ...]`

## Usage

Once deployed, you can use the proxy in two ways:

### 1. As a Registry Mirror

This is the recommended approach. Configure your Docker daemon by editing `/etc/docker/daemon.json`:

```json
{
  "registry-mirrors": ["https://your-proxy-url.com"]
}
```

Replace `https://your-proxy-url.com` with the URL of your deployed function. Then restart the Docker daemon:

```bash
sudo systemctl restart docker
```

### 2. Direct Pulling

You can also pull images by prefixing the image name with your proxy's URL:

```bash
# Pull an official image from Docker Hub
docker pull your-proxy-url.com/ubuntu

# Pull a user image from Docker Hub
docker pull your-proxy-url.com/username/my-image

# Pull an image from another registry
docker pull your-proxy-url.com/gcr.io/google-containers/busybox
```

## How It Works

1. The function intercepts Docker client requests.
2. It parses the request URL to determine the target registry and image.
3. It forwards the request to the appropriate upstream registry.
4. It handles authentication by forwarding `Www-Authenticate` headers back to the client, correcting the `realm` to point to itself.
5. It caches responses for a configurable duration to speed up subsequent pulls.
```