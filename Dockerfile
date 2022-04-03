FROM node:16-alpine AS build
WORKDIR /home/node/app
COPY package.json package-lock.json /home/node/app/
RUN npm install

FROM build
RUN apk add --no-cache bash gettext
COPY src src

ENV CRON_SCHEDULE */30 * * * *
# ENTRYPOINT [  "ls" ]
ENTRYPOINT [ "/bin/bash", "/home/node/app/src/docker-entrypoint.sh" ]
