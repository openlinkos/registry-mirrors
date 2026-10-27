#!/usr/bin/env bash
# 冒烟测试：检查每个上游都能正确拉取，并且入口只放行拉取。两种用法：
#   按端口：以 http 模式部署后（MODE=http docker compose up -d）在本机运行
#     scripts/smoke.sh [主机，默认 localhost]；端口与 .env 一致，可用 PORT_DOCKER 等环境变量覆盖。
#   按域名：tls 模式，或 vhost 模式放在 CDN 之后，经 HTTPS 访问 docker、gcr、ghcr、k8s、quay.<域名>
#     SMOKE_DOMAIN=example.com scripts/smoke.sh
# 开了需要登录的入口时，再给 AUTH_USER、AUTH_PASS 一起检查：按端口时用 15001、15005（可用 AUTH_PORT_DOCKER、
# AUTH_PORT_QUAY 覆盖），按域名时用 SMOKE_AUTH_DOMAIN。
set -euo pipefail

HOST="${1:-localhost}"
fail=0

ok() { printf '  通过  %s\n' "$1"; }
bad() { printf '  失败  %s\n' "$1"; fail=1; }

# 每个上游的入口地址和 docker pull 用的前缀，顺序：Docker Hub、gcr.io、ghcr.io、registry.k8s.io、quay.io
BASES=()
NAMES=()
if [ -n "${SMOKE_DOMAIN:-}" ]; then
  for sub in docker gcr ghcr k8s quay; do
    BASES+=("https://$sub.$SMOKE_DOMAIN")
    NAMES+=("$sub.$SMOKE_DOMAIN")
  done
else
  for port in "${PORT_DOCKER:-5001}" "${PORT_GCR:-5002}" "${PORT_GHCR:-5003}" "${PORT_K8S:-5004}" "${PORT_QUAY:-5005}"; do
    BASES+=("http://$HOST:$port")
    NAMES+=("$HOST:$port")
  done
fi

# 打印 docker pull 输出里的 Digest 行
pull_digest() {
  docker pull "$1" | sed -n 's/^Digest: //p'
}

wait_ready() {
  for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$1/v2/")" = 200 ]; then return 0; fi
    sleep 2
  done
  return 1
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
accept='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'

# 上游序号、经镜像站拉取的名称、直接从上游拉取的名称
CASES=(
  "0 library/hello-world:latest docker.io/library/hello-world:latest"
  "1 distroless/static:nonroot gcr.io/distroless/static:nonroot"
  "2 containerd/busybox:1.36 ghcr.io/containerd/busybox:1.36"
  "3 pause:3.10 registry.k8s.io/pause:3.10"
  "4 coreos/etcd:v3.5.0 quay.io/coreos/etcd:v3.5.0"
)

echo "拉取并比对摘要"
for c in "${CASES[@]}"; do
  read -r i name upstream <<<"$c"
  if ! wait_ready "${BASES[i]}"; then bad "${NAMES[i]}：/v2/ 没有就绪"; continue; fi
  mirrored="$(pull_digest "${NAMES[i]}/$name" || true)"
  direct="$(pull_digest "$upstream" || true)"
  if [ -n "$mirrored" ] && [ "$mirrored" = "$direct" ]; then
    ok "${NAMES[i]} $name $mirrored"
  else
    bad "${NAMES[i]} $name：镜像站 '${mirrored:-无}'，上游 '${direct:-无}'"
  fi
done

echo "入口规则"
for i in "${!BASES[@]}"; do
  base="${BASES[i]}" n="${NAMES[i]}"
  s="$(status -X POST "$base/v2/smoke/blobs/uploads/")"
  [ "$s" = 405 ] && ok "$n POST 返回 405" || bad "$n POST 返回 $s，应为 405"
  s="$(status -X PUT "$base/v2/smoke/manifests/latest")"
  [ "$s" = 405 ] && ok "$n PUT 返回 405" || bad "$n PUT 返回 $s，应为 405"
  s="$(status -X DELETE "$base/v2/smoke/manifests/latest")"
  [ "$s" = 405 ] && ok "$n DELETE 返回 405" || bad "$n DELETE 返回 $s，应为 405"
  for path in /v2/_catalog /v2/_zot/ext/search /metrics; do
    s="$(status "$base$path")"
    [ "$s" = 404 ] && ok "$n $path 返回 404" || bad "$n $path 返回 $s，应为 404"
  done
  if curl -s -D - -o /dev/null "$base/v2/" | grep -qi '^www-authenticate'; then
    bad "$n /v2/ 带了认证质询，客户端会去要令牌"
  else
    ok "$n /v2/ 不要求认证"
  fi
done

# 各上游互相隔离：用别的上游的入口请求 Docker Hub 的镜像，不能拿到它（Docker Hub 的已在上面缓存过）
echo "上游隔离"
for i in 1 2 3 4; do
  s="$(status -H "Accept: $accept" "${BASES[i]}/v2/library/hello-world/manifests/latest")"
  case "$s" in
    2*) bad "${NAMES[i]} 返回了 Docker Hub 的 library/hello-world（$s）" ;;
    *) ok "${NAMES[i]} 请求 library/hello-world 返回 $s" ;;
  esac
done

echo "用法页与探活"
for i in "${!BASES[@]}"; do
  ct="$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "${BASES[i]}/")"
  case "$ct" in
    "200 text/html"*) ok "${NAMES[i]} / 返回用法页" ;;
    *) bad "${NAMES[i]} / 返回 '$ct'，应为 200 text/html" ;;
  esac
  s="$(status "${BASES[i]}/healthz")"
  [ "$s" = 200 ] && ok "${NAMES[i]} /healthz 返回 200" || bad "${NAMES[i]} /healthz 返回 $s，应为 200"
done
s="$(status "${BASES[0]}/robots.txt")"
[ "$s" = 200 ] && ok "/robots.txt 返回 200" || bad "/robots.txt 返回 $s，应为 200"
ct="$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "${BASES[0]}/assets/ui.css")"
case "$ct" in
  "200 text/css"*) ok "/assets/ui.css 返回样式" ;;
  *) bad "/assets/ui.css 返回 '$ct'，应为 200 text/css" ;;
esac
csp="$(curl -s -o /dev/null -D - "${BASES[0]}/" | tr -d '\r' | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p')"
case "$csp" in
  *"script-src 'self'"*) ok "用法页带 CSP" ;;
  *) bad "用法页没有 CSP（'${csp:-无}'）" ;;
esac

# zot 内部的仓库带着上游前缀（docker.io/...），tags/list 的分页链接要改回客户端看到的路径
echo "分页链接"
status -I -H "Accept: $accept" "${BASES[0]}/v2/library/hello-world/manifests/linux" >/dev/null
link="$(curl -s -D - -o /dev/null "${BASES[0]}/v2/library/hello-world/tags/list?n=1" | sed -n 's/^[Ll]ink: //p' | tr -d '\r')"
case "$link" in
  "</v2/library/hello-world/tags/list?"*) ok "Link: $link" ;;
  *) bad "Link 应以 </v2/library/hello-world/ 开头，实际 '${link:-无}'" ;;
esac

# 需要登录的入口：给了 AUTH_USER、AUTH_PASS 才检查
if [ -n "${AUTH_USER:-}" ] && [ -n "${AUTH_PASS:-}" ]; then
  echo "需要登录的入口"
  if [ -n "${SMOKE_AUTH_DOMAIN:-}" ]; then
    auth=("https://docker.$SMOKE_AUTH_DOMAIN library/hello-world latest" "https://quay.$SMOKE_AUTH_DOMAIN coreos/etcd v3.5.0")
  else
    auth=("http://$HOST:${AUTH_PORT_DOCKER:-15001} library/hello-world latest" "http://$HOST:${AUTH_PORT_QUAY:-15005} coreos/etcd v3.5.0")
  fi
  for c in "${auth[@]}"; do
    read -r base repo ref <<<"$c"
    if curl -s -D - -o /dev/null "$base/v2/" | grep -qi '^www-authenticate: basic'; then
      ok "$base 不带口令返回 Basic 质询"
    else
      bad "$base 不带口令没有返回 Basic 质询"
    fi
    s="$(status -u "$AUTH_USER:wrong-$AUTH_PASS" "$base/v2/")"
    [ "$s" = 401 ] && ok "$base 口令错误返回 401" || bad "$base 口令错误返回 $s，应为 401"
    s="$(status -u "$AUTH_USER:$AUTH_PASS" -H "Accept: $accept" "$base/v2/$repo/manifests/$ref")"
    [ "$s" = 200 ] && ok "$base 带口令拉取 $repo:$ref 返回 200" || bad "$base 带口令拉取 $repo:$ref 返回 $s，应为 200"
  done
fi

if [ "$fail" = 0 ]; then echo "全部通过"; else echo "有检查失败"; fi
exit "$fail"
