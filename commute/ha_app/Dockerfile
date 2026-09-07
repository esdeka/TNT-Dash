# Local Home Assistant OS app. No externally supplied BUILD_FROM is required.
FROM ghcr.io/home-assistant/base:latest
RUN apk add --no-cache python3 py3-pip nodejs tzdata ca-certificates
ARG BUILD_VERSION=1.4.1
LABEL io.hass.version="${BUILD_VERSION}" io.hass.type="app" io.hass.arch="aarch64|amd64"
WORKDIR /app
COPY app/ /app/
RUN python3 -m venv /opt/commute-python && /opt/commute-python/bin/pip install --no-cache-dir -r requirements.txt
COPY run.py /run-commute.py
ENV PATH="/opt/commute-python/bin:${PATH}" PYTHONUNBUFFERED=1 TZ=Europe/Brussels \
    COMMUTE_STATE_DIR=/data/runtime COMMUTE_GTFS_CACHE=/data/gtfs-cache
CMD ["python3", "/run-commute.py"]
