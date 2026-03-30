FROM python:3.11-slim-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
    apt-get update; \
    for i in 1 2 3 4 5; do \
      if apt-get install -y --no-install-recommends --fix-missing \
        tesseract-ocr \
        tesseract-ocr-chi-sim \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender1 \
        libgl1 \
        libgomp1; then \
        break; \
      fi; \
      apt-get install -f -y || true; \
      if [ "$i" -eq 5 ]; then \
        exit 1; \
      fi; \
      apt-get update; \
      sleep 5; \
    done; \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
