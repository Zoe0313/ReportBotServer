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
BUGZILLA_ACCOUNT = ""
BUGZILLA_PASSWORD = base64.b64decode("").decode('utf-8')

# perforce login account
SERVICE_ACCOUNT = "svc.vsan-er"
SERVICE_PASSWORD = base64.b64decode("cDhNLjhUeiFAUzQhODYuUUNvcw==").decode('utf-8')

# content type
CONTENT_TYPE_JSON_UTF = "application/json;charset=utf-8"
CONTENT_TYPE_URLENCODE = "application/x-www-form-urlencoded"
CONTENT_TYPE_JSON = "application/json"

# team via consts
# team via is responsible for the url shorten tool
VIA_API = "https://via-api.vmware.com/via-console/app-api/v1/vialink"

