# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
BotConst.py
'''

import base64

SLACK_API = "https://slack.com/api/"

SLACK_POST_API = SLACK_API + "chat.postMessage"
SLACK_LOOKUP_API = SLACK_API + "users.lookupByEmail?email=%s@vmware.com"

# bugzilla API
BUGZILLA_DETAIL_URL = "https://bugzilla.eng.vmware.com/show_bug.cgi?id="

# bugzilla bug detail API
BUGZILLA_BASE = "https://bugzilla-rest.eng.vmware.com/rest/v1/bug/"

BUGZILLA_BY_ASSIGNEE = "https://bugzilla-rest.eng.vmware.com/rest/v1/bug/query?lastChangeDays=15&assignee="

# bugzilla login account
BUGZILLA_ACCOUNT = "svc.vsan-er"
BUGZILLA_PASSWORD = base64.b64decode("RkM3TEQuWXF5NnFzOTI0LkBALg==").decode('utf-8')

# perforce login account
SERVICE_ACCOUNT = "svc.vsan-er"
SERVICE_PASSWORD = base64.b64decode("RkM3TEQuWXF5NnFzOTI0LkBALg==").decode('utf-8')

# content type
CONTENT_TYPE_JSON_UTF = "application/json;charset=utf-8"
CONTENT_TYPE_URLENCODE = "application/x-www-form-urlencoded"
CONTENT_TYPE_JSON = "application/json"

# team via consts
# team via is responsible for the url shorten tool
VIA_API = "https://via-api.vmware.com/via-console/app-api/v1/vialink"

# used in perforce review check report
# perforce describe url
PERFORCE_DESCRIBE_URL = "https://p4swarm.eng.vmware.com/perforce_1666/changes/{0}"
# review board request url
REVIEWBOARD_REQUEST_URL = "https://reviewboard.eng.vmware.com/r/{0}/"
# vsancore describe url
VSANCORE_DESCRIBE_URL = "https://jira.eng.vmware.com/browse/{0}"
# restful API: post message to a given channel id
POST_MESSAGE_API_BY_CHANNEL = "https://slackbot.vela.decc.vmware.com/api/v1/channel/{0}/messages"
# restful API: post message to a given user name
POST_MESSAGE_API_BY_USER = "https://slackbot.vela.decc.vmware.com/api/v1/user/{0}/messages"
# bearer token on vSANSlackbot APP for posting message
POST_MESSAGE_BEAR_TOKEN = "Bearer d89f55072b9d4fbda1e38a66c83adaad"
# vsan-slackbot-monitor channel id
VSAN_SLACKBOT_MONITOR_CHANNELID = "C03JWGX5GJW"
