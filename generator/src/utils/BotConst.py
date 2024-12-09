# !/usr/bin/env python

# Copyright 2021 VMware, Inc.  All rights reserved. -- VMware Confidential

'''
Module docstring.
BotConst.py
'''

import os
import base64
from dotenv import load_dotenv
ProjectPath = os.path.abspath(__file__).split("/generator")[0]
load_dotenv(dotenv_path=os.path.join(ProjectPath, 'server', '.env'))

SLACK_API = "https://slack.com/api/"

SLACK_POST_API = SLACK_API + "chat.postMessage"
SLACK_LOOKUP_API = SLACK_API + "users.lookupByEmail?email=%s@vmware.com"

# bugzilla API
BUGZILLA_DETAIL_URL = "https://bugzilla-vcf.lvn.broadcom.net/show_bug.cgi?id="

# bugzilla bug detail API
BUGZILLA_BASE = "https://bugzilla-rest.lvn.broadcom.net/rest/v1/bug/"

BUGZILLA_BY_ASSIGNEE = "https://bugzilla-rest.lvn.broadcom.net/rest/v1/bug/query?lastChangeDays=15&assignee="

# service account 'svc-vsan-er' is used to login perforce system
PERFORCE_ACCOUNT = os.environ.get('P4USER')
PERFORCE_PASSWORD = os.environ.get('P4PASSWORD')
# service account 'svc.vsan-er' is used to login bugzilla
SERVICE_ACCOUNT = os.environ.get('SERVICE_ACCOUNT')
SERVICE_PASSWORD = os.environ.get('SERVICE_PASSWORD')

# summary string limit length
SUMMARY_MAX_LENGTH = 60

# jira personal access token from svc-vsan-er
# request on page https://vmw-jira.broadcom.net/secure/ViewProfile.jspa
JIRA_ACCESS_TOKEN = "Bearer MDYzMTc0MzQ2Nzk2OmefkMSq92VjO7wU+qpZjZmbGirt"
# confluence page personal token
# request on page https://vmw-confluence.broadcom.net/plugins/personalaccesstokens/usertokens.action
CONFLUENCE_ACCESS_TOKEN = 'Bearer NzU1NTgwNzY1NjU2Oia8sey1Ji+lYgX5wSKjf0yQZUga'

# content type
CONTENT_TYPE_JSON_UTF = "application/json;charset=utf-8"
CONTENT_TYPE_URLENCODE = "application/x-www-form-urlencoded"
CONTENT_TYPE_JSON = "application/json"

# used in perforce review check report
# perforce describe url
PERFORCE_DESCRIBE_URL = "https://swarm-vmw.devops.broadcom.net/perforce_1666/changes/{0}"
# review board request url
REVIEWBOARD_URL = "https://reviewboard.lvn.broadcom.net/r/"
# vsancore describe url
JIRA_BROWSE_URL = "https://vmw-jira.broadcom.com/browse/{0}"
