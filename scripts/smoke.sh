#!/usr/bin/env bash
# 冒烟测试：以 http 模式部署后（MODE=http docker compose up -d）在本机运行，检查每个上游都能正确拉取，
# 并且入口只放行拉取。
# 用法：scripts/smoke.sh [主机，默认 localhost]；端口与 .env 一致，可用 PORT_DOCKER 等环境变量覆盖。
set -euo pipefail

HOST="${1:-localhost}"
P_DOCKER="${PORT_DOCKER:-5001}"
P_GCR="${PORT_GCR:-5002}"
P_GHCR="${PORT_GHCR:-5003}"
P_K8S="${PORT_K8S:-5004}"
P_QUAY="${PORT_QUAY:-5005}"
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

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
accept='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'

# 端口、经镜像站拉取的名称、直接从上游拉取的名称
CASES=(
  "$P_DOCKER library/hello-world:latest docker.io/library/hello-world:latest"
  "$P_GCR distroless/static:nonroot gcr.io/distroless/static:nonroot"
  "$P_GHCR containerd/busybox:1.36 ghcr.io/containerd/busybox:1.36"
  "$P_K8S pause:3.10 registry.k8s.io/pause:3.10"
  "$P_QUAY coreos/etcd:v3.5.0 quay.io/coreos/etcd:v3.5.0"
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
for port in "$P_DOCKER" "$P_GCR" "$P_GHCR" "$P_K8S" "$P_QUAY"; do
  s="$(status -X POST "http://$HOST:$port/v2/smoke/blobs/uploads/")"
  [ "$s" = 405 ] && ok "$port POST 返回 405" || bad "$port POST 返回 $s，应为 405"
  s="$(status -X PUT "http://$HOST:$port/v2/smoke/manifests/latest")"
  [ "$s" = 405 ] && ok "$port PUT 返回 405" || bad "$port PUT 返回 $s，应为 405"
  s="$(status -X DELETE "http://$HOST:$port/v2/smoke/manifests/latest")"
  [ "$s" = 405 ] && ok "$port DELETE 返回 405" || bad "$port DELETE 返回 $s，应为 405"
  for path in /v2/_catalog /v2/_zot/ext/search /metrics; do
    s="$(status "http://$HOST:$port$path")"
    [ "$s" = 404 ] && ok "$port $path 返回 404" || bad "$port $path 返回 $s，应为 404"
  done
  if curl -s -D - -o /dev/null "http://$HOST:$port/v2/" | grep -qi '^www-authenticate'; then
    bad "$port /v2/ 带了认证质询，客户端会去要令牌"
  else
    ok "$port /v2/ 不要求认证"
  fi
done

# 各上游互相隔离：用别的上游的端口请求 Docker Hub 的镜像，不能拿到它（Docker Hub 的已在上面缓存过）
echo "上游隔离"
for port in "$P_GCR" "$P_GHCR" "$P_K8S" "$P_QUAY"; do
  s="$(status -H "Accept: $accept" "http://$HOST:$port/v2/library/hello-world/manifests/latest")"
  case "$s" in
    2*) bad "$port 返回了 Docker Hub 的 library/hello-world（$s）" ;;
    *) ok "$port 请求 library/hello-world 返回 $s" ;;
  esac
done

# zot 内部的仓库带着上游前缀（docker.io/...），tags/list 的分页链接要改回客户端看到的路径
echo "分页链接"
status -I -H "Accept: $accept" "http://$HOST:$P_DOCKER/v2/library/hello-world/manifests/linux" >/dev/null
link="$(curl -s -D - -o /dev/null "http://$HOST:$P_DOCKER/v2/library/hello-world/tags/list?n=1" | sed -n 's/^[Ll]ink: //p')"
case "$link" in
  "</v2/library/hello-world/tags/list?"*) ok "Link: $link" ;;
  *) bad "Link 应以 </v2/library/hello-world/ 开头，实际 '${link:-无}'" ;;
esac

if [ "$fail" = 0 ]; then echo "全部通过"; else echo "有检查失败"; fi
exit "$fail"
