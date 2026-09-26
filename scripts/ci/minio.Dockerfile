# CI-only source build; never publish or substitute for production images.
# The upstream release used Go 1.21.6 (go.mod requires Go 1.19 or later).
FROM golang:1.21.6-bookworm@sha256:3efef61ff1d99c8a90845100e2a7e934b4a5d11b639075dc605ff53c141044fc AS build

ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-mod=readonly GOMAXPROCS=2
WORKDIR /src/minio

# Keep the tag and full commit together: fail closed if the upstream tag moves.
# No configurable build args can silently substitute a different source/version.
RUN git init . \
    && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth=1 origin refs/tags/RELEASE.2024-01-18T22-51-28Z:refs/tags/RELEASE.2024-01-18T22-51-28Z \
    && test "$(git rev-parse 'RELEASE.2024-01-18T22-51-28Z^{commit}')" = 19387cafab76133c2e7642de4aac8c81b9f4f8c7 \
    && git checkout --detach 19387cafab76133c2e7642de4aac8c81b9f4f8c7 \
    && test "$(git rev-parse HEAD)" = 19387cafab76133c2e7642de4aac8c81b9f4f8c7

# Match upstream's static build tags and release metadata generator. The release
# timestamp is explicit: the commit timestamp is not the published release time.
RUN go mod download \
    && go mod verify \
    && minio_ldflags="$(MINIO_RELEASE=RELEASE go run buildscripts/gen-ldflags.go 2024-01-18T22:51:28Z)" \
    && go build -p 2 -tags kqueue -trimpath -ldflags "$minio_ldflags" -o /out/minio . \
    && git diff --exit-code -- go.mod go.sum \
    && /out/minio --version > /out/version.txt \
    && cat /out/version.txt \
    && grep -F 'minio version RELEASE.2024-01-18T22-51-28Z (commit-id=19387cafab76133c2e7642de4aac8c81b9f4f8c7)' /out/version.txt \
    && mkdir -p /out/data /out/tmp \
    && chmod 1777 /out/tmp \
    && chown 10001:10001 /out/data

FROM scratch
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="19387cafab76133c2e7642de4aac8c81b9f4f8c7" \
      org.opencontainers.image.version="RELEASE.2024-01-18T22-51-28Z" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.description="OneERP disposable CI-only build from verified upstream MinIO source"
COPY --from=build /out/minio /usr/bin/minio
COPY --from=build --chown=10001:10001 /out/data /data
COPY --from=build /out/tmp /tmp
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /src/minio/LICENSE /src/minio/NOTICE /src/minio/CREDITS /licenses/
USER 10001:10001
EXPOSE 9000
# A numeric scratch user has no home/passwd entry; provide writable config paths.
ENTRYPOINT ["/usr/bin/minio", "--config-dir", "/tmp/minio-config", "--certs-dir", "/tmp/minio-certs"]
CMD ["server", "/data"]
