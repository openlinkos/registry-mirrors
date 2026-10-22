<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://openlinkos.com/brand/linkos-mirrors/github/readme-dark.svg">
    <img alt="LinkOS Mirrors" src="https://openlinkos.com/brand/linkos-mirrors/github/readme-light.svg" height="48">
  </picture>
</p>

# LinkOS Mirrors

免费的公共容器镜像加速服务，由 [OpenLinkOS](https://openlinkos.com) 公益运营；本仓库同时是它的开源部署配置，你也可以用它自建一套。

服务状态：[uptime.linkos.org](https://uptime.linkos.org)

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

本仓库就是线上服务所用的配置，会在本地缓存镜像。磁盘小、想快速搭一套，或者前面已有 CDN 时，也可以用零磁盘版 [registry-mirrors-caddy](https://github.com/openlinkos/registry-mirrors-caddy)：只有一个 Caddy，内置自动 HTTPS，每次拉取都回源。

本仓库的组成：

- 每个上游一个 [CNCF Distribution](https://distribution.github.io/distribution/) 拉取缓存（`registry:3.1.2`，pull-through cache），**各自使用独立的存储目录** `./data/<上游>`，缓存 168 小时后过期。
- 前面是一个 `registry-gate`（nginx），只放行拉取请求（GET、HEAD），拒绝任何写入，并关闭会列出全部已缓存仓库的 `/v2/_catalog`。
- 宿主机端口 5001–5005 依次对应 Docker Hub、gcr.io、ghcr.io、registry.k8s.io、quay.io。

```bash
git clone https://github.com/openlinkos/registry-mirrors.git
cd registry-mirrors
docker compose up -d
docker pull localhost:5001/library/hello-world   # 测试
scripts/smoke.sh                                 # 自检：五个上游各拉一个镜像并与上游比对摘要，检查只放行拉取、存储互相隔离
```

对外提供服务时，请在前面加一层负责 TLS 的反向代理或 CDN，并把每个域名转发到对应的端口。默认匿名回源：Docker Hub 对匿名拉取有频率限制（按出口 IP 计算），已缓存的镜像不会重复消耗限额。

### 安全说明

- **不要让多个上游共用一个存储目录。** Distribution 的拉取缓存在上游请求失败时，会退回本地已有的同名标签；共用存储时，一个上游的请求可能拿到另一个上游的镜像。
- **不要在同一个存储上运行可写的 registry。** 否则任何能推送的人都能把镜像放进缓存的回退路径，分发给拉取的用户。
- **关闭 `/v2/_catalog`。** 它会列出所有用户拉取过的仓库。
- 2026-10 之前的版本存在上述问题（共用存储、带无认证的本地 registry 和管理界面），自建过的用户请更新到当前配置。

## 使用须知

- 本服务免费、公益运营，**不保证可用性和速度**，可能随时调整、限流或停止。生产环境请自行评估，或自建一套。
- 镜像内容来自各上游仓库，版权和责任归原作者；使用时请遵守上游的服务条款（如 Docker Hub、GitHub、Quay 的条款）。
- 不得利用本服务分发违法或侵权内容。对滥用行为，我们会限流或屏蔽。
- 问题反馈和违规举报：[提交 issue](https://github.com/openlinkos/registry-mirrors/issues)，或发送邮件至 admin@linkos.io。
- 服务会记录访问日志（IP、请求的镜像、时间），仅用于运维和防止滥用。

## 许可

配置与文档以 [Apache License 2.0](LICENSE) 发布。LinkOS 与 OpenLinkOS 的名称和标志不在该许可范围内，使用规范见 [openlinkos.com/zh/brand](https://openlinkos.com/zh/brand)。
