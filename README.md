<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://openlinkos.com/brand/linkos-mirrors/github/readme-dark.svg">
    <img alt="LinkOS Mirrors" src="https://openlinkos.com/brand/linkos-mirrors/github/readme-light.svg" height="48">
  </picture>
</p>

# LinkOS Registry Mirrors
LinkOS 公益运营的镜像仓库加速服务。



## 服务列表

当前 LinkOS 提供下面列表中的容器镜像加速服务：

| 镜像 Mirror 地址          | 镜像说明                              | 使用示例                                                     |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| https://docker.linkos.org | docker.io - Docker Hub 镜像加速       | docker pull docker.linkos.org/library/mysql:5.7              |
| https://gcr.linkos.org    | gcr.io - Google 镜像加速              | docker pull gcr.linkos.org/kubebuilder/kube-rbac-proxy:v0.13.1 |
| https://ghcr.linkos.org   | ghcr.io - GitHub 镜像加速             | docker pull ghcr.linkos.org/nikiforovall/dotnet-script:latest |
| https://quay.linkos.org   | quay.io - RedHat Quay 镜像加速        | docker pull quay.linkos.org/coreos/etcd:v3.4.11              |
| https://k8s.linkos.org    | registry.k8s.io - Kubernetes 镜像加速 | docker pull k8s.linkos.org/kube-apiserver:v1.26.9            |



## 快速使用

以 Docker Hub 镜像加速为例，用户当前需要下载使用存储在 Docker Hub 上的 mysql:5.7 镜像：

1. 拉取加速镜像：

   ```bash
   docker pull docker.linkos.org/library/mysql:5.7
   ```

2. 重新打标签：

   ```bash
   docker tag docker.linkos.org/library/mysql:5.7 mysql:5.7
   ```

3. 删除加速镜像：

   ```bash
   docker rmi docker.linkos.org/library/mysql:5.7
   ```



## 镜像加速

### docker hub 镜像加速

```bash
常规镜像代理
官方命令：docker pull username/image:tag
代理命令：docker pull docker.linkos.org/username/image:tag

根镜像代理
官方命令：docker pull mysql:5.7
代理命令：docker pull docker.linkos.org/library/mysql:5.7
```



### gcr 镜像加速

```bash
常规镜像代理
官方命令：docker pull gcr.io/username/image:tag
代理命令：docker pull gcr.linkos.org/username/image:tag
```



### ghcr 镜像加速

```bash
常规镜像代理
官方命令：docker pull ghcr.io/username/image:tag
代理命令：docker pull ghcr.linkos.org/username/image:tag
```



### quay 镜像加速

```bash
常规镜像代理
官方命令：docker pull quay.io/username/image:tag
代理命令：docker pull quay.linkos.org/username/image:tag
```



### kubernetes 镜像加速

```bash
常规镜像代理
官方命令：docker pull k8s.gcr.io/username/image:tag
官方命令：docker pull registry.k8s.io/username/image:tag
代理命令：docker pull k8s.linkos.org/username/image:tag

根镜像代理
官方命令：docker pull k8s.gcr.io/image:tag
官方命令：docker pull registry.k8s.io/image:tag
代理命令：docker pull k8s.linkos.org/image:tag
```
