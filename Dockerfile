# This build consumes the already compiled Shell release and a verified QQ DEB.
# It never starts QQ, Shell, or a project test.
FROM debian:bookworm-slim AS qq-distribution
ARG QQ_DEB_SHA256
ARG QQ_DEB_BYTES
COPY qq/qq.deb /tmp/qq.deb
RUN test "$(stat -c %s /tmp/qq.deb)" = "$QQ_DEB_BYTES" \
    && printf '%s  /tmp/qq.deb\n' "$QQ_DEB_SHA256" | sha256sum --check --strict \
    && test "$(dpkg-deb --field /tmp/qq.deb Architecture)" = amd64 \
    && dpkg-deb --extract /tmp/qq.deb /qq-distribution

FROM node:22-bookworm-slim
ARG QQ_VERSION
ARG RELEASE_VERSION
ARG SOURCE_REPOSITORY
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="Cherry-blossoms-cat" \
      org.opencontainers.image.description="Linux amd64 Shell with a pinned Linux QQ runtime" \
      org.opencontainers.image.version="$RELEASE_VERSION" \
      org.opencontainers.image.source="$SOURCE_REPOSITORY" \
      org.opencontainers.image.revision="$SOURCE_REVISION" \
      cat.cherry-blossoms.qq.version="$QQ_VERSION"

# Node is used by linux-prepare.cjs for file preparation. QQ's own Electron runs
# the application. Keep the complete extracted QQ payload, including copyrights.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
       bash ca-certificates dbus-daemon fonts-wqy-zenhei \
       libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 \
       libgtk-3-0 libnss3 libpangocairo-1.0-0 libsecret-1-0 \
       libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
       libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
       tini util-linux xauth xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /work/config /work/plugins /data/home /data/qq-data \
    && chown -R 1000:1000 /work /data \
    && chmod 700 /work /work/config /work/plugins /data /data/home /data/qq-data

COPY --from=qq-distribution /qq-distribution/ /opt/qq-distribution/
RUN test -x /opt/qq-distribution/opt/QQ/qq \
    && test -f /opt/qq-distribution/opt/QQ/resources/app/package.json \
    && test -f /opt/qq-distribution/opt/QQ/resources/app/wrapper.node \
    && ln -s /opt/qq-distribution/opt/QQ /opt/QQ
COPY shell/ /opt/cherry/
COPY docker/qq-client.json docker/QQ-SOURCE.md /usr/share/doc/cherry/
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/cherry-entrypoint

ENV HOME=/data/home \
    XDG_CONFIG_HOME=/data/home/.config \
    XDG_CACHE_HOME=/data/home/.cache \
    XDG_DATA_HOME=/data/home/.local/share \
    IMAGE_QQ_VERSION=$QQ_VERSION \
    NAPCAT_IMAGE_MANAGED=1
USER 1000:1000
WORKDIR /work
EXPOSE 6099
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/cherry-entrypoint"]
