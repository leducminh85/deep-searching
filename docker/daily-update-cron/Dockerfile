FROM alpine:3.20

RUN apk add --no-cache curl tzdata

COPY crontab /etc/crontabs/root
COPY run-daily-update.sh /cron/run-daily-update.sh

RUN chmod 0644 /etc/crontabs/root \
    && chmod +x /cron/run-daily-update.sh

CMD ["crond", "-f", "-l", "8"]
