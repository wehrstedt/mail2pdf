#!/bin/bash

envsubst < "src/crontab" > "src/crontab-new"
mv src/crontab-new src/crontab

echo "Running mailer once..."
node /home/node/app/src/mailer.js

echo "Start cron with schedule $CRON_SCHEDULE"
/usr/sbin/crond -f -l 0 -c /home/node/app/src/crontab -L /var/log/cron.log
