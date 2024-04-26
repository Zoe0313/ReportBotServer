# Slackbot Server Dockerfile
FROM nikolaik/python-nodejs:python3.8-nodejs14

RUN apt-get install tzdata
RUN cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
ENV TZ=Asia/Shanghai

# upgrade python, install python lib
RUN python -m pip install --upgrade pip
RUN pip install requests
RUN pip install certifi
RUN pip install urllib3
RUN pip install bs4
RUN pip install datetime
RUN pip install filelock
RUN pip install httplib2
RUN pip install oauth2client
RUN pip install --upgrade google-api-python-client
RUN pip install --upgrade google-auth
RUN pip install python-dateutil
RUN pip install lxml
RUN pip install pandas
RUN pip install rbtools
RUN pip install python-dotenv

RUN apt-get update
RUN apt-get install -y vim

# set perforce environment
ENV P4PORT ssl:perforce.eng.vmware.com:1666

WORKDIR slackbot

COPY . .

# Non-root application running on VDP cluster.
# Add uid and gid.
RUN useradd -u 10001 svc.vsan-er
RUN groupadd -g 10002 mts
RUN usermod -d /slackbot svc.vsan-er
RUN usermod -g mts svc.vsan-er
RUN chown svc.vsan-er:mts -R /slackbot
USER svc.vsan-er

WORKDIR server

RUN npm install && cp .env.product .env

CMD [ "npm", "run", "start:prod" ]
