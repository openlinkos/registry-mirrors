<p>
  <img alt="LinkOS Mirrors" src="https://openlinkos.com/brand/linkos-mirrors/github/readme.svg" height="56">
</p>

# LinkOS Mirrors

免费的公共容器镜像加速服务，由 [LinkOS 团队](https://linkos.io) 运营；本仓库同时是它的开源部署配置，你也可以用它自建一套。

服务主页：[linkos.org](https://linkos.org/zh/mirrors) · 服务状态：[uptime.linkos.org](https://uptime.linkos.org)

## 服务列表

| 加速地址 | 上游 | 示例 |
| --- | --- | --- |
| `docker.linkos.org` | Docker Hub（docker.io） | `docker pull docker.linkos.org/library/mysql:5.7` |
| `gcr.linkos.org` | gcr.io | `docker pull gcr.linkos.org/distroless/static:nonroot` |
| `ghcr.linkos.org` | ghcr.io | `docker pull ghcr.linkos.org/containerd/busybox:1.36` |
| `quay.linkos.org` | quay.io | `docker pull quay.linkos.org/coreos/etcd:v3.5.0` |
| `k8s.linkos.org` | registry.k8s.io | `docker pull k8s.linkos.org/pause:3.10` |

规则很简单：把镜像地址里的上游域名换成对应的加速地址。Docker Hub 的官方镜像（如 `mysql`、`nginx`）要写成 `library/<名称>`。`k8s.gcr.io` 已于 2023 年冻结，Kubernetes 镜像请使用 `registry.k8s.io`，对应 `k8s.linkos.org`。

## 快速使用

以 Docker Hub 上的 `mysql:5.7` 为例：

```bash
docker pull docker.linkos.org/library/mysql:5.7       # 通过加速地址拉取
docker tag docker.linkos.org/library/mysql:5.7 mysql:5.7
docker rmi docker.linkos.org/library/mysql:5.7        # 删除加速地址的标签，镜像本身保留
```

其他上游同理：

```bash
docker pull ghcr.linkos.org/<用户>/<镜像>:<标签>        # 对应 ghcr.io/<用户>/<镜像>:<标签>
docker pull quay.linkos.org/<用户>/<镜像>:<标签>        # 对应 quay.io/<用户>/<镜像>:<标签>
docker pull gcr.linkos.org/<项目>/<镜像>:<标签>         # 对应 gcr.io/<项目>/<镜像>:<标签>
docker pull k8s.linkos.org/<镜像>:<标签>               # 对应 registry.k8s.io/<镜像>:<标签>
```

## 配置 Docker 镜像加速

在 `/etc/docker/daemon.json` 中加入（已有内容时合并，不要整体覆盖）：

```json
{
  "registry-mirrors": ["https://docker.linkos.org"]
}
```

然后重启 Docker：`sudo systemctl restart docker`。之后 `docker pull mysql:5.7` 会自动经过加速。

注意：Docker 的 `registry-mirrors` **只对 Docker Hub 生效**。ghcr.io、quay.io、gcr.io、registry.k8s.io 的镜像仍需按上面的方式改写地址。containerd、Kubernetes（k3s、kind、kubeadm）和 Podman 的配置说明正在补充。

## 自行部署

本仓库就是线上服务所用的配置，会在本地缓存镜像。磁盘小、想快速搭一套，或者前面已有 CDN 时，也可以用零磁盘版 [registry-mirrors-caddy](https://github.com/openlinkos/registry-mirrors-caddy)：只有一个 Caddy，每次拉取都回源。

本仓库只有两个容器：

- **[zot](https://zotregistry.dev)**（CNCF 项目）：一个进程按需代理五个上游，有人拉取时才去上游取，取到后缓存在 `./data/zot`（可用 `.env` 的 `ZOT_DATA` 改到数据盘）。每个上游的镜像放在自己的前缀下（`docker.io/`、`gcr.io/` 等），互不相通。7 天内没人拉过的镜像自动清理。
- **Caddy**：自动 HTTPS；只放行拉取（GET、HEAD），关闭 `/v2/_catalog`；按访问的域名或端口给请求加上上游前缀，再交给 zot。

客户端的用法和上面「快速使用」完全一样，不需要登录。

需要一台能正常访问上述上游的 Linux 服务器，并装好 Docker 和 Docker Compose。

```bash
git clone https://github.com/openlinkos/registry-mirrors.git
cd registry-mirrors
cp .env.sample .env    # 按下面的说明修改
docker compose up -d
```

### 方式一：直接对外（默认，MODE=tls）

1. 为 `docker`、`gcr`、`ghcr`、`k8s`、`quay` 五个子域名添加 A/AAAA 记录，指向服务器，例如 `docker.example.com`。
2. 在 `.env` 中设置 `DOMAIN=example.com`。
3. 确保 80、443 端口能从公网访问，然后执行 `docker compose up -d`。Caddy 会为每个子域名单独申请证书（HTTP-01 / TLS-ALPN-01），不需要通配符证书，也不需要 DNS 服务商的 API 密钥。
4. 测试：`docker pull docker.example.com/library/hello-world`。

### 方式二：放在 CDN 或反向代理之后，按域名回源（MODE=vhost）

Caddy 只监听一个明文端口 `HTTP_PORT`（默认 8080），按访问的域名区分上游，由前面的 CDN 或反向代理负责 TLS。在 `.env` 中设置：

```bash
MODE=vhost
DOMAIN=example.com     # 五个加速域名 docker、gcr、ghcr、k8s、quay.example.com
HTTP_PORT=8080
```

然后把五个加速域名都回源到这一个端口。注意以下几点：

- 回源时要保留客户端访问的域名（Host 头），本服务据此区分上游；不认识的域名返回 404。
- 需要登录的入口也可以放在同一个端口上（`AUTH_MODE=vhost`，见下文）。
- 想在访问日志里记录真实客户端 IP，请把 CDN 的回源地址段写进 `TRUSTED_PROXIES`。
- 部署好后可以经 CDN 自检：`SMOKE_DOMAIN=example.com scripts/smoke.sh`。

### 方式三：放在 CDN 之后，按端口回源（MODE=http）

CDN 回源时不能保留 Host 头时用这种方式。Caddy 每个上游监听一个明文端口，由前面的 CDN 或反向代理负责 TLS，并把每个加速域名回源到对应端口：

| 端口 | 上游 |
| --- | --- |
| 5001 | Docker Hub |
| 5002 | gcr.io |
| 5003 | ghcr.io |
| 5004 | registry.k8s.io |
| 5005 | quay.io |

- 上游按端口区分，回源时不需要保留 Host 头。
- 想在访问日志里记录真实客户端 IP，请把 CDN 的回源地址段写进 `TRUSTED_PROXIES`。
- 反向代理与本服务在同一台机器上时，可以设置 `BIND=127.0.0.1`，避免这些端口暴露到公网。
- 端口可以用 `PORT_DOCKER`、`PORT_GCR` 等改掉，见 `.env.sample`。

本地试用：

```bash
MODE=http BIND=127.0.0.1 docker compose up -d
docker pull localhost:5001/library/hello-world   # Docker 默认允许以明文访问 localhost
scripts/smoke.sh                                 # 自检：五个上游各拉一个镜像并与上游比对摘要，检查只放行拉取、上游互相隔离
```

### 需要登录的入口（可选）

想让一部分入口只给自己人用（例如走更贵的线路），可以再开一组需要登录的入口。它和公开入口共用同一个 zot 缓存，只是 Caddy 多校验一道 Basic Auth 口令。

```bash
cp caddy/users.caddy.sample caddy/users.caddy
docker compose run --rm caddy caddy hash-password    # 输入口令，得到 bcrypt 哈希
# 在 caddy/users.caddy 里写一行：<用户名> <哈希>；已有 htpasswd 文件时：sed 's/:/ /' htpasswd > caddy/users.caddy
```

然后在 `.env` 中设置 `AUTH_MODE`：

- `AUTH_MODE=tls`：五个域名 `docker`、`gcr`、`ghcr`、`k8s`、`quay.<AUTH_DOMAIN>`，自动申请证书；`AUTH_DOMAIN` 要和 `DOMAIN` 不同。
- `AUTH_MODE=vhost`：和公开入口共用明文端口 `HTTP_PORT`，按 `*.<AUTH_DOMAIN>` 区分，放在 CDN 或反向代理之后。
- `AUTH_MODE=http`：明文端口 15001–15005（依次对应 Docker Hub、gcr.io、ghcr.io、registry.k8s.io、quay.io），放在 CDN 或反向代理之后。
- 只要需要登录的镜像站时，再设 `MODE=off` 关掉公开入口。

客户端先登录，再照常拉取：

```bash
docker login docker.example.net
docker pull docker.example.net/library/hello-world
```

`caddy/users.caddy` 不存在时 Caddy 启动失败；文件为空时所有请求都返回 401。修改用户后执行 `docker compose restart caddy`。

### 从旧版升级

旧版是每个上游一个 CNCF Distribution 容器，加一个 nginx 入口。升级时：

```bash
git pull
cp .env.sample .env    # 线上放在 CDN 后面时设置 MODE=http，端口不变
docker compose up -d --remove-orphans   # 删除旧的 registry-* 容器
```

新版不读旧的缓存，会从空开始重新缓存。确认新版正常后，可以删除旧的 `./data/dockerhub`、`./data/gcr` 等目录。

### 用法页

用浏览器打开任一加速域名（如 `https://docker.example.com/`），会看到用法页：Docker、containerd、k3s / RKE2、Podman / CRI-O 和 Kubernetes 工具的分步配置（加速域名已经填好，可以直接复制）、镜像地址转换、五个加速地址和常见问题。中英文都在页面里，语言跟随浏览器，也可以在右上角切换；配色有自动、浅色、深色三种。

页面在 `web/`，纯静态，由 Caddy 直接提供，不加载任何外部资源；CSP 只允许页面自己的文件，没有内联脚本和样式。样式、字体和标志来自 OpenLinkOS 设计系统 [`@openlinkos/ui`](https://github.com/openlinkos/design)，放在 `web/assets/`，升级时运行 `scripts/vendor-ui.sh <版本>` 再提交。

加速域名默认由当前地址推导：打开 `docker.example.com` 时，五个地址就是 `docker.`、`gcr.`、`ghcr.`、`k8s.`、`quay.example.com`。域名不符合这个规律，或者想改站点名称和品牌、在页脚放上状态页和使用须知等链接时，复制一份配置再修改，修改后刷新页面即可，不用重启：

```bash
cp web/site.json.sample web/site.json
```

| 字段 | 作用 |
| --- | --- |
| `name` | 站点名称，默认 `LinkOS Mirrors` |
| `brand` | 设计系统里的品牌，决定配色和标志：默认 `linkos-mirrors`，也可以是 `linkos`、`openlinkos` 等；写 `none` 用中性外观 |
| `operator` | 运营者，页面上写「由 … 运营」 |
| `domains` | `docker`、`gcr`、`ghcr`、`k8s`、`quay` 五个加速域名，留空的由当前地址推导 |
| `links` | 页脚链接：`status`、`terms`、`privacy`、`abuse`、`source`、`home`。写了 `status` 时，页面上多一节「服务状态」指向它 |

### 日志与监控

- 探活：`GET /healthz`，Caddy 和 zot 都正常时返回 200，可以用于 Upptime 等监控。
- 访问日志：`./logs/access.log`，JSON 格式，每 100 MiB 轮转一次，最多保留 10 个文件、30 天。
- zot 日志：`docker compose logs zot`。
- Caddy 指标：Prometheus 格式，`http://127.0.0.1:9180/metrics`，只在本机监听。管理接口 `localhost:2019` 同样只在本机。
- zot 只在 `127.0.0.1:5100` 监听，供 Caddy 使用，不要对外开放。

### 限制

- **首次拉取大镜像要等较久。** 现在用的 zot v2.1.22 要先把整个镜像（一个平台）从上游取完，才返回给客户端；镜像很大时，客户端或 CDN 可能先超时。超时不影响后台同步，稍后重试就会直接从缓存拉取。zot v2.1.23 起支持边取边发，届时会更新。
- **`tags/list` 只列出已缓存的 tag。** 拉取镜像不受影响。
- **不存在的镜像返回 503**，而不是 404。
- **tag 更新最多晚 5 分钟。** 同一个 tag 5 分钟内不再向上游确认。
- **不按磁盘容量淘汰。** 只按「7 天内没人拉过」清理，请给磁盘留出余量并监控。
- 默认匿名回源：Docker Hub 对匿名拉取有频率限制（按出口 IP 计算），已缓存的镜像不会重复消耗限额；向上游确认 tag 是否更新时只发 HEAD，不计入限额。

### 安全说明

- **只读。** 只放行 GET、HEAD，其他方法返回 405；`/v2/_catalog`（会列出所有用户拉取过的仓库）和 zot 自身的接口返回 404。zot 本身也配置为匿名只读。
- **各上游不会串。** 前缀总是由 Caddy 加上，客户端无法指定别的上游；zot 只在对应上游的前缀下查找。修改 `zot/config.yaml` 时，**每个上游都必须写 `destination`**，漏写的那一条会匹配所有仓库，等于让各上游的镜像互相串。
- **需要登录的入口**由 Caddy 校验口令，客户端的 `Authorization` 头不会转给 zot，也不会转给上游。
- **zot、管理接口和指标只在本机监听。**
- 2026-10 之前的版本存在多个上游共用存储、带无认证的本地 registry 和管理界面的问题，自建过的用户请更新到当前配置。

## 使用须知

完整的[使用须知](https://linkos.org/zh/terms)、[隐私说明](https://linkos.org/zh/privacy)和[举报与投诉](https://linkos.org/zh/abuse)见 linkos.org，要点如下：

- 本服务免费提供、尽力维护，**不保证可用性和速度**，可能随时调整、限流或停止。生产环境请自行评估，或自建一套。
- 镜像内容来自各上游仓库，版权和责任归原作者；使用时请遵守上游的服务条款（如 Docker Hub、GitHub、Quay 的条款）。
- 不得利用本服务分发违法或侵权内容。对滥用行为，我们会限流或屏蔽。
- 问题反馈：[提交 issue](https://github.com/openlinkos/registry-mirrors/issues)，或发送邮件至 admin@linkos.io。
- 违规与侵权举报：发送邮件至 abuse@linkos.io，需要写明的信息见[举报与投诉](https://linkos.org/zh/abuse)。
- 服务会记录访问日志（IP、请求的镜像、时间），仅用于运维和防止滥用。

## 许可

配置与文档以 [Apache License 2.0](LICENSE) 发布。LinkOS 与 OpenLinkOS 的名称和标志不在该许可范围内，使用规范见 [openlinkos.com/zh/brand](https://openlinkos.com/zh/brand)。
