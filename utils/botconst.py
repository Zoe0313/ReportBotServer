import base64

SLACK_API = "https://slack.com/api/"

SLACK_POST_API = SLACK_API + "chat.postMessage"
SLACK_LOOKUP_API = SLACK_API + "users.lookupByEmail?email=%s@vmware.com"
SLACK_IMOPEN_API = SLACK_API + "im.open"

SLACK_XOXB_TOKEN = "xoxb-2154537752-833403957187-yPWkRumT1Ayc3jq76H4TsviU"

# bugzilla API
BUGZILLA_BASE = "https://bugzilla.eng.vmware.com/show_bug.cgi?id="

# bugzilla bug detail API
BUGZILLA_DETAIL_URL = "https://bugzilla-rest.eng.vmware.com/rest/v1/bug/"

SERVICE_ACCOUNT = "svc.vsan-er"
SERVICE_PASSWORD = base64.b64decode("RkM3TEQuWXF5NnFzOTI0LkBALg==").decode('utf-8')

# content type
CONTENT_TYPE_JSON_UTF = "application/json;charset=utf-8"
CONTENT_TYPE_URLENCODE = "application/x-www-form-urlencoded"
CONTENT_TYPE_JSON = "application/json"

# team via consts
# team via is responsible for the url shorten tool
VIA_API = "https://via-api.vmware.com/via-console/app-api/v1/vialink"

# channel id
# vSAN manager channel
VSAN_70U3_CHANNEL = "G01KKSLTR1T"

# vSAN channel-bot
VSAN_SHANGHAI_BOT_CHANNEL = "G9NSYC9K7"

# slackbot-monitor channel
MONITOR_CHANNEL = "C026LRRM7T4"

# slackbot-service channel
TEST_CHANNEL = "C020QKAGMSQ"

TEST_YSIXUAN_CHANNEL = "C020CL1F00P"

TEST_DDA_CHANNEL = "GQV757T6K"

TEST_CHJING_CHANNEL = "G012BLW9C6R"
