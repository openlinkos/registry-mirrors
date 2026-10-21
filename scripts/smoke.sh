#!/usr/bin/env bash
# 冒烟测试：部署后（docker compose up -d）在本机运行，检查每个上游都能正确拉取，并且入口只放行拉取。
# 用法：scripts/smoke.sh [主机，默认 localhost]
set -euo pipefail

HOST="${1:-localhost}"
fail=0

ok() { printf '  通过  %s\n' "$1"; }
bad() { printf '  失败  %s\n' "$1"; fail=1; }

# 打印 docker pull 输出里的 Digest 行
pull_digest() {
  docker pull "$1" | sed -n 's/^Digest: //p'
}

wait_ready() {
  for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://$HOST:$1/v2/")" = 200 ]; then return 0; fi
    sleep 2
  done
  return 1
}

# 端口、经镜像站拉取的名称、直接从上游拉取的名称
CASES=(
  "5001 library/hello-world:latest docker.io/library/hello-world:latest"
  "5002 distroless/static:nonroot gcr.io/distroless/static:nonroot"
  "5003 containerd/busybox:1.36 ghcr.io/containerd/busybox:1.36"
  "5004 pause:3.10 registry.k8s.io/pause:3.10"
  "5005 coreos/etcd:v3.5.0 quay.io/coreos/etcd:v3.5.0"
)

echo "拉取并比对摘要"
for c in "${CASES[@]}"; do
  read -r port name upstream <<<"$c"
  if ! wait_ready "$port"; then bad "$port：/v2/ 没有就绪"; continue; fi
  mirrored="$(pull_digest "$HOST:$port/$name" || true)"
  direct="$(pull_digest "$upstream" || true)"
  if [ -n "$mirrored" ] && [ "$mirrored" = "$direct" ]; then
    ok "$port $name $mirrored"
  else
    bad "$port $name：镜像站 '${mirrored:-无}'，上游 '${direct:-无}'"
  fi
done

echo "入口规则"
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
for port in 5001 5002 5003 5004 5005; do
  s="$(status -X POST "http://$HOST:$port/v2/smoke/blobs/uploads/")"
  [ "$s" = 405 ] && ok "$port POST 返回 405" || bad "$port POST 返回 $s，应为 405"
  s="$(status -X DELETE "http://$HOST:$port/v2/smoke/manifests/latest")"
  [ "$s" = 405 ] && ok "$port DELETE 返回 405" || bad "$port DELETE 返回 $s，应为 405"
  s="$(status "http://$HOST:$port/v2/_catalog")"
  [ "$s" = 404 ] && ok "$port /v2/_catalog 返回 404" || bad "$port /v2/_catalog 返回 $s，应为 404"
done

# 各上游的存储互相独立：用别的上游的端口请求 Docker Hub 的镜像，不能拿到它（Docker Hub 的已在上面缓存过）
echo "存储隔离"
accept='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'
for port in 5002 5003 5004 5005; do
  s="$(status -H "Accept: $accept" "http://$HOST:$port/v2/library/hello-world/manifests/latest")"
  case "$s" in
    2*) bad "$port 返回了 Docker Hub 的 library/hello-world（$s）" ;;
    *) ok "$port 请求 library/hello-world 返回 $s" ;;
  esac
done

if [ "$fail" = 0 ]; then echo "全部通过"; else echo "有检查失败"; fi
exit "$fail"
