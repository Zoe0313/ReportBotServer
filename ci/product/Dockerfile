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
ENV P4PORT ssl:perforce.vcfd.broadcom.net:1666

WORKDIR slackbot

COPY . .

RUN useradd -u 175345366 xl061876
RUN groupadd -g 201 mts
RUN usermod -d /slackbot xl061876
RUN usermod -g mts xl061876
RUN chown xl061876:mts -R /slackbot
USER xl061876

WORKDIR server

RUN npm install && cp .env.product .env

CMD [ "npm", "run", "start:prod" ]
